/* Four wrong copies, sabotaged at the server, never in the working tree. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const PORT = 8349;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let mode = 'none';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.unityweb': 'application/octet-stream' };

const server = createServer(async (req, res) => {
  const raw = req.url || '/';
  const url = decodeURIComponent(raw.split('?')[0]);
  const query = new URLSearchParams(raw.split('?')[1] || '');
  if (query.has('sab')) mode = query.get('sab');
  const file = path.join(ROOT, url);
  const name = path.basename(url);
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  };
  try {
    if (mode === 'missing' && name === 'FunnyShooter2_Yandex.framework.js') throw new Error('sabotage');
    if (mode === 'nopart1' && name.endsWith('.part1')) throw new Error('sabotage');
    if (mode === 'container' && name === 'FunnyShooter2_Yandex.framework.js') {
      return send(200, await readFile(path.join(ROOT, 'games/funny-shooter-2/FunnyShooter2_Yandex.framework.js.unityweb')));
    }
    send(200, await readFile(file));
  } catch (e) { send(404, Buffer.from('not found: ' + url)); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const origin = `http://127.0.0.1:${PORT}`;

const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', '--hide-scrollbars',
  '--remote-debugging-port=9337', '--user-data-dir=' + profile, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch('http://127.0.0.1:9337/json/list')).json()).find((t) => t.type === 'page'); } catch (e) {}
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1; const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id != null) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 20000);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
const raw = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;

const PROBE = `(function(){
  var box = document.getElementById('plu-startup-error');
  return (box ? 'PANEL: ' + box.innerText.replace(/\\s+/g,' ') : 'no panel') + ' | instance=' + typeof window.unityInstance;
})()`;

async function scenario(name, waitMs) {
  await send('Page.navigate', { url: origin + '/games/funny-shooter-2/index.html?sab=' + name });
  await sleep(waitMs);
  const state = String(await raw(PROBE));
  console.log('--- ' + name + ' (' + waitMs / 1000 + 's)\n    ' + state.slice(0, 260));
  return state;
}

const none = await scenario('none', 30000);
const missing = await scenario('missing', 8000);
const container = await scenario('container', 8000);
const nopart1 = await scenario('nopart1', 25000);

console.log('\n=== verdicts');
console.log('  none      boots: ' + (none.includes('instance=object') && none.includes('no panel')));
console.log('  missing   names the file: ' + missing.includes('404'));
console.log('  container names the container: ' + container.includes('compressed container'));
console.log('  nopart1   names the part: ' + nopart1.includes('could not be assembled'));

ws.close(); proc.kill(); await sleep(300);
await rm(profile, { recursive: true, force: true });
server.close();
process.exit(0);
