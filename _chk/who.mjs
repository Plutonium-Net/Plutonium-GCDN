/* The abort reproduced in a headful browser on a later visit. Record every XHR
   (url, status, body length) so the request the runtime dies on is visible. */
import { serve, sleep } from './h.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const { origin, hits } = await serve(ROOT, 8355);

const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
const proc = spawn(CHROME, ['--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
  '--remote-debugging-port=9342', '--user-data-dir=' + profile, '--window-size=1280,800',
  '--window-position=-32000,-32000', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9342/json/list')).json()).find((t) => t.type === 'page'); } catch (e) {}
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map();
const ev = { console: [], exceptions: [] };
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id != null) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } return; }
  const p = msg.params || {};
  if (msg.method === 'Runtime.consoleAPICalled') ev.console.push((p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') ev.exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
  window.__xhrs = [];
  var o = XMLHttpRequest.prototype.open, s = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return o.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('loadend', function () {
      var len = -1;
      try { len = (self.responseText || '').length; } catch (e) {}
      window.__xhrs.push({ url: self.__u.slice(0, 90), status: self.status, len: len });
    });
    return s.apply(this, arguments);
  };
})();` });

for (let visit = 1; visit <= 4; visit++) {
  ev.console.length = 0; ev.exceptions.length = 0;
  await send('Page.navigate', { url: origin + '/games/funny-shooter-2/index.html' });
  await sleep(18000);
  const state = await raw(`(function(){
    var b = document.getElementById('plu-startup-error');
    return JSON.stringify({
      instance: typeof window.unityInstance,
      panel: b ? b.innerText.replace(/\\s+/g,' ') : null,
      refused: window.pluRefused || []
    });
  })()`);
  console.log('--- visit ' + visit);
  console.log('    ' + String(state).slice(0, 900));
  console.log('    refusals in console: ' + ev.console.filter((c) => /refusing/.test(c)).length +
    ' | exceptions: ' + ev.exceptions.length);
}

console.log('\n=== every XHR the page made (last 25)');
for (const x of (await raw('JSON.stringify(window.__xhrs.slice(-25))') || '[]').replace(/^"|"$/g, '').split('},{').join('}\n{').split('\n')) console.log('  ' + x.slice(0, 150));
console.log('\n=== console lines mentioning abort/error/exception');
for (const c of ev.console.filter((c) => /abort|Abort|exception|Exception|failed|error/i.test(c))) console.log('  ' + c.slice(0, 200));
console.log('=== 404s: ' + JSON.stringify(hits.filter((h) => h.status === 404).map((h) => h.url).slice(0, 8)));

ws.close(); proc.kill(); await sleep(300);
await rm(profile, { recursive: true, force: true });
process.exit(0);
