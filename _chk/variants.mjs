/* Three guards, three profiles, three visits each:
     v1 = the current one (blocked -> GET verbatim to an empty blob)
     v2 = blocked -> rewritten to GET on the empty blob (POSTs cannot target blob:)
     v3 = the old one (blocked -> abort() + synthetic error event)
   Visiting the page three times in one profile is what reproduces the abort. */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.unityweb': 'application/octet-stream' };

const page = await readFile(ROOT + '/games/funny-shooter-2/index.html', 'utf8');
const NEW_OPEN = `      XMLHttpRequest.prototype.open = function (method, url) {
        this.pluBlocked = null;
        if (!allowed(url)) {
          refuse('a request', url);
          this.pluBlocked = emptyBodyUrl();
          return open.apply(this, [method, this.pluBlocked].concat(
            Array.prototype.slice.call(arguments, 2)));
        }
        return open.apply(this, arguments);
      };`;
const OLD_OPEN = `      XMLHttpRequest.prototype.open = function (method, url) {
        this.pluBroken = !allowed(url);
        this.pluUrl = url;
        return open.apply(this, arguments);
      };`;
const OLD_SEND = `      XMLHttpRequest.prototype.send = function () {
        if (this.pluBlocked) {
          /* The URL is already the empty blob: no body is forwarded, and the
             caller gets a well-formed 200 with nothing in it. */
          var url = this.pluBlocked;
          this.addEventListener('loadend', function () { URL.revokeObjectURL(url); });
          return send.call(this);
        }
        return send.apply(this, arguments);
      };`;
if (!page.includes(NEW_OPEN) || !page.includes(OLD_SEND)) throw new Error('guard blocks not found');

const v2 = page.replace(NEW_OPEN, NEW_OPEN.replace('[method, this.pluBlocked]', "['GET', this.pluBlocked]"));
const v3 = page.replace(NEW_OPEN, OLD_OPEN).replace(OLD_SEND, `      XMLHttpRequest.prototype.send = function () {
        if (this.pluBroken) {
          refuse('a request', this.pluUrl);
          try { this.abort(); } catch (e) {}
          this.dispatchEvent(new Event('error'));
          return;
        }
        return send.apply(this, arguments);
      };`);
const PAGES = { 'index-v2.html': v2, 'index-v3.html': v3 };

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    if (PAGES[path.basename(url)]) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(Buffer.from(PAGES[path.basename(url)], 'utf8'));
    }
    const body = await readFile(path.join(ROOT, url));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(url)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('404'); }
});
await new Promise((r) => server.listen(8357, '127.0.0.1', r));
const origin = 'http://127.0.0.1:8357';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function visitAll(label, pageName) {
  const profile = await mkdtemp(path.join(tmpdir(), 'chk-'));
  const proc = spawn(CHROME, ['--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
    '--remote-debugging-port=9344', '--user-data-dir=' + profile, '--window-size=1280,800',
    '--window-position=-32000,-32000', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9344/json/list')).json()).find((t) => t.type === 'page'); } catch (e) {}
    if (!target) await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id != null) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
  });
  await send('Page.enable'); await send('Runtime.enable');
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

  const report = [];
  for (let visit = 1; visit <= 3; visit++) {
    await send('Page.navigate', { url: origin + '/games/funny-shooter-2/' + pageName });
    await sleep(14000);
    const state = await send('Runtime.evaluate', { expression: `(function(){
      var b = document.getElementById('plu-startup-error');
      return (b ? 'ABORTED' : 'ok') + ' | xhr=' + JSON.stringify(window.__xhrs || []);
    })()`, returnByValue: true });
    report.push('visit ' + visit + ': ' + String(state.result?.value).slice(0, 260));
  }
  console.log('=== ' + label);
  for (const r of report) console.log('    ' + r);
  ws.close(); proc.kill(); await sleep(300);
  await rm(profile, { recursive: true, force: true });
}

await visitAll('v1 current (POST kept)', 'index.html');
await visitAll('v2 blocked POST rewritten to GET', 'index-v2.html');
await visitAll('v3 old guard (abort + error event)', 'index-v3.html');

server.close();
process.exit(0);
