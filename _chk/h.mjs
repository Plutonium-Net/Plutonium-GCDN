/* Scratch: static server + CDP client. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.data': 'application/octet-stream',
  '.mem': 'application/octet-stream', '.unityweb': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.part1': 'application/octet-stream', '.part2': 'application/octet-stream',
  '.part3': 'application/octet-stream'
};

export function serve(root, port, headers = {}) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(root, url);
    try {
      const body = await readFile(file);
      hits.push({ url, status: 200, bytes: body.length });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...headers });
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

export async function browser({ width = 1280, height = 800, port = 9335 } = {}) {
  const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--hide-scrollbars',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    `--window-size=${width},${height}`, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) { /* not up yet */ }
    if (!target) await new Promise((r) => setTimeout(r, 250));
  }
  if (!target) throw new Error('chrome did not expose a page');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 1;
  const pending = new Map();
  const events = { console: [], requests: [], failed: [], exceptions: [], dialogs: [] };

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
    if (msg.method === 'Page.javascriptDialogOpening') {
      events.dialogs.push(p.message);
      ws.send(JSON.stringify({ id: nextId++, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
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
  await send('Log.enable');

  return {
    events, send,
    async goto(url, waitMs = 3000) { await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, waitMs)); },
    async raw(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
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
