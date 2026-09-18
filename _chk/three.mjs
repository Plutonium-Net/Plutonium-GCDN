/* The fixed page, three visits in one headful profile — the sequence that
   aborted twice before. Every blocked request must come back 200. */
import { serve, sleep } from './h.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const { origin } = await serve(ROOT, 8358);

const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
const proc = spawn(CHROME, ['--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
  '--remote-debugging-port=9345', '--user-data-dir=' + profile, '--window-size=1280,800',
  '--window-position=-32000,-32000', 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9345/json/list')).json()).find((t) => t.type === 'page'); } catch (e) {}
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map();
const ev = { requests: [], exceptions: [] };
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id != null) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } return; }
  const p = msg.params || {};
  if (msg.method === 'Network.requestWillBeSent') ev.requests.push(p.request.url);
  if (msg.method === 'Runtime.exceptionThrown') ev.exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
});
const raw = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  window.__xhrs = [];
  var o = XMLHttpRequest.prototype.open, s = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; return o.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('loadend', function () { window.__xhrs.push(self.__m + ' -> ' + self.status); });
    return s.apply(this, arguments);
  };
})();` });

for (let visit = 1; visit <= 3; visit++) {
  await send('Page.navigate', { url: origin + '/games/funny-shooter-2/index.html' });
  await sleep(18000);
  console.log('visit ' + visit + ': ' + await raw(`(function(){
    var b = document.getElementById('plu-startup-error');
    return (b ? 'ABORTED: ' + b.innerText.replace(/\\s+/g,' ').slice(0,140) : 'ok')
      + ' | xhr=' + JSON.stringify(window.__xhrs || [])
      + ' | refused=' + (window.pluRefused || []).length;
  })()`));
}

console.log('off-machine requests: ' + ev.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')).length);
console.log('exceptions: ' + ev.exceptions.length);
ws.close(); proc.kill(); await sleep(300);
await rm(profile, { recursive: true, force: true });
process.exit(0);
