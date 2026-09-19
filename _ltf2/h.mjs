/* Scratch: static server + CDP client. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.swf': 'application/x-shockwave-flash'
};

export function serve(root, port) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    try {
      const body = await readFile(path.join(root, url));
      hits.push({ url, status: 200, bytes: body.length });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(url)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      hits.push({ url, status: 404 });
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found: ' + url);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, hits, origin: `http://127.0.0.1:${port}` }));
  });
}

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export async function browser({ width = 1280, height = 800, port = 9350, headful = false } = {}) {
  const profile = await mkdtemp(path.join(tmpdir(), 'ltf2-'));
  const args = [
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--hide-scrollbars', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, `--window-size=${width},${height}`, 'about:blank'
  ];
  if (!headful) args.unshift('--headless=new', '--disable-gpu');
  else args.push('--window-position=-32000,-32000');
  const proc = spawn(CHROME, args, { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) {}
    if (!target) await new Promise((r) => setTimeout(r, 250));
  }
  if (!target) throw new Error('chrome did not expose a page');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 1;
  const pending = new Map();
  const events = { console: [], requests: [], failed: [], exceptions: [] };

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id != null) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
      return;
    }
    const p = msg.params || {};
    if (msg.method === 'Runtime.consoleAPICalled') events.console.push({ type: p.type, text: (p.args || []).map(textOf).join(' ') });
    if (msg.method === 'Runtime.exceptionThrown') events.exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    if (msg.method === 'Network.requestWillBeSent') events.requests.push({ url: p.request.url, method: p.request.method });
    if (msg.method === 'Network.loadingFailed') events.failed.push({ error: p.errorText, url: p.url });
  };

  function textOf(arg) {
    if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
    return arg.description || arg.type;
  }

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 30000);
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  return {
    events, send,
    async goto(url, waitMs = 3000) { await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, waitMs)); },
    async raw(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      }
    },
    async close() {
      try { ws.close(); } catch (e) {}
      proc.kill();
      await new Promise((r) => setTimeout(r, 300));
      try { await rm(profile, { recursive: true, force: true }); } catch (e) {}
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
