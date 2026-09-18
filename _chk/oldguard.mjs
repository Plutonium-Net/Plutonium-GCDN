/* Serve the current page, but with the guard restored to its old behaviour
   (`abort()` + synthetic error) under a second name, so the old and new guards
   can be compared in the same browser. Nothing in the working tree is touched. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const PORT = 8353;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.unityweb': 'application/octet-stream' };

const page = await readFile(ROOT + '/games/funny-shooter-2/index.html', 'utf8');

/* Put the old guard back: refuse by breaking the request, not by answering it. */
const oldXhr = `      XMLHttpRequest.prototype.open = function (method, url) {
        this.pluBlocked = null;
        if (!allowed(url)) {
          refuse('a request', url);
          this.pluBlocked = emptyBodyUrl();
          return open.apply(this, [method, this.pluBlocked].concat(
            Array.prototype.slice.call(arguments, 2)));
        }
        return open.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        if (this.pluBlocked) {
          /* The URL is already the empty blob: no body is forwarded, and the
             caller gets a well-formed 200 with nothing in it. */
          var url = this.pluBlocked;
          this.addEventListener('loadend', function () { URL.revokeObjectURL(url); });
          return send.call(this);
        }
        return send.apply(this, arguments);
      };`;
const oldXhrReplacement = `      XMLHttpRequest.prototype.open = function (method, url) {
        this.pluBroken = !allowed(url);
        this.pluUrl = url;
        return open.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        if (this.pluBroken) {
          refuse('a request', this.pluUrl);
          try { this.abort(); } catch (e) {}
          this.dispatchEvent(new Event('error'));
          return;
        }
        return send.apply(this, arguments);
      };`;
if (!page.includes(oldXhr)) throw new Error('could not find the new guard block to swap');
const oldPage = page.replace(oldXhr, oldXhrReplacement).replace(
  `          if (!allowed(url)) {
            refuse('a fetch', url);
            return Promise.resolve(new Response(new Blob([], { type: 'application/octet-stream' }),
              { status: 200, statusText: 'OK (local copy: empty answer for ' + url + ')' }));
          }`,
  `          if (!allowed(url)) { refuse('a fetch', url); return Promise.reject(new TypeError('blocked')); }`);

const hits = [];
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, url);
  try {
    if (url.endsWith('/index-old.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(Buffer.from(oldPage, 'utf8'));
    }
    const body = await readFile(file);
    hits.push({ url, status: 200 });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    hits.push({ url, status: 404 });
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const origin = `http://127.0.0.1:${PORT}`;

const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', '--hide-scrollbars',
  '--remote-debugging-port=9340', '--user-data-dir=' + profile, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9340/json/list')).json()).find((t) => t.type === 'page'); } catch (e) {}
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map();
const ev = { console: [], exceptions: [], failed: [] };
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id != null) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } return; }
  const p = msg.params || {};
  if (msg.method === 'Runtime.consoleAPICalled') ev.console.push((p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') ev.exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  if (msg.method === 'Network.loadingFailed') ev.failed.push(p.errorText);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const raw = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result?.value;
};
const state = `(function(){var b=document.getElementById('plu-startup-error');
  return JSON.stringify({instance: typeof window.unityInstance, panel: b ? b.innerText.replace(/\\s+/g,' ').slice(0,120) : null});})()`;

/* Old guard first: does it abort the runtime the way the user saw? */
await send('Page.navigate', { url: origin + '/games/funny-shooter-2/index-old.html' });
for (let i = 0; i < 6; i++) {
  await sleep(5000);
  console.log('old guard ' + (5 * (i + 1)) + 's: ' + await raw(state));
}
console.log('\nold-guard aborts: ' + ev.exceptions.filter((e) => /abort/.test(String(e))).length);
for (const e of ev.exceptions.slice(0, 2)) console.log('  ' + String(e).split('\n').slice(0, 6).join('\n  ').slice(0, 500));
console.log('old-guard refusals: ' + ev.console.filter((c) => /refusing/.test(c)).length);

ev.console.length = 0; ev.exceptions.length = 0;
console.log('\n--- new guard, same browser');
await send('Page.navigate', { url: origin + '/games/funny-shooter-2/index.html' });
for (let i = 0; i < 4; i++) { await sleep(5000); console.log('new guard ' + (5 * (i + 1)) + 's: ' + await raw(state)); }
console.log('new-guard aborts: ' + ev.exceptions.filter((e) => /abort/.test(String(e))).length);

ws.close(); proc.kill(); await sleep(300);
await rm(profile, { recursive: true, force: true });
server.close();
process.exit(0);
