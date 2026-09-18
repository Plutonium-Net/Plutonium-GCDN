/* Same reproduction, but wrapping XHR from outside the page's own guard after
   load, so the *original* URL of every request is visible, and printing the
   whole abort stack. */
import { serve, sleep } from './h.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const { origin } = await serve(ROOT, 8356);

const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
const proc = spawn(CHROME, ['--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
  '--remote-debugging-port=9343', '--user-data-dir=' + profile, '--window-size=1280,800',
  '--window-position=-32000,-32000', 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9343/json/list')).json()).find((t) => t.type === 'page'); } catch (e) {}
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id != null) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } return; }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 25000);
});
const raw = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');

await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  window.__xhrs = [];
  var o = XMLHttpRequest.prototype.open, s = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__orig = String(u); this.__m = m; return o.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('loadend', function () {
      window.__xhrs.push({ m: self.__m, url: self.__orig.slice(0, 70), status: self.status });
    });
    return s.apply(this, arguments);
  };
})();` });

for (let visit = 1; visit <= 3; visit++) {
  await send('Page.navigate', { url: origin + '/games/funny-shooter-2/index.html' });
  await sleep(19000);
  const panel = await raw(`(function(){var b=document.getElementById('plu-startup-error');
    return b ? b.innerText.replace(/\\s+/g,' ') : null;})()`);
  console.log('--- visit ' + visit + ': ' + (panel ? 'ABORTED' : 'ok'));
  if (panel) {
    console.log('FULL PANEL:\n' + String(panel).split(' at ').join('\n   at ').slice(0, 3000));
  }
  const xs = await raw('JSON.stringify(window.__xhrs)');
  console.log('XHRs:');
  for (const line of String(xs).replace(/^"|"$/g, '').split('},{').join('}\n{').split('\n')) {
    if (!/framework|loader|wasm|\.part/.test(line)) console.log('   ' + line.slice(0, 140));
  }
}

ws.close(); proc.kill(); await sleep(300);
await rm(profile, { recursive: true, force: true });
process.exit(0);
