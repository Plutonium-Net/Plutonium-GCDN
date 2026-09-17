/* Minimal, dependency-free Chrome DevTools Protocol client (temporary). */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtArg(a) {
  if (!a) return '';
  if (a.type === 'string') return a.value;
  if (a.type === 'undefined') return 'undefined';
  if (Object.prototype.hasOwnProperty.call(a, 'value')) {
    try { return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value); }
    catch (e) { return String(a.value); }
  }
  if (a.unserializableValue) return a.unserializableValue;
  return a.description || a.type;
}

class Page {
  constructor(ws, events) {
    this.ws = ws; this.events = events; this.id = 0; this.pending = new Map();
    ws.onmessage = (ev) => this._onMessage(JSON.parse(ev.data));
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.method + ' ' + JSON.stringify(msg.error))); else res(msg.result);
      return;
    }
    const p = msg.params || {};
    switch (msg.method) {
      case 'Runtime.consoleAPICalled':
        this.events.console.push({ type: p.type, text: (p.args || []).map(fmtArg).join(' ') });
        break;
      case 'Runtime.exceptionThrown': {
        const d = (p.exceptionDetails && (p.exceptionDetails.exception || {})) || {};
        this.events.exceptions.push(d.description || (p.exceptionDetails || {}).text || 'exception');
        break;
      }
      case 'Network.requestWillBeSent': this.events.requests.push(p.request.url); break;
      case 'Network.responseReceived': this.events.responses.push({ url: p.response.url, status: p.response.status }); break;
      case 'Network.loadingFailed': this.events.failed.push({ url: p.url || '', error: p.errorText, canceled: !!p.canceled }); break;
      case 'Runtime.executionContextCreated': this.events.contexts.push(p.context.origin || p.context.name); break;
      default: break;
    }
  }
  send(method, params = {}, timeoutMs = 60000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, timeoutMs);
      this.pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text;
      throw new Error('evaluate threw: ' + d);
    }
    return r.result.value;
  }
  async waitFor(expression, timeoutMs, label) {
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try { v = await this.evaluate(expression); } catch (e) { v = false; }
      if (v) return Date.now() - t0;
      if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for ' + (label || expression));
      await sleep(120);
    }
  }
  /* Runs before any of the page's own scripts, which is the only way to watch a
     function the game defines at load time (the shell assigns its own Storage). */
  addInitScript(source) {
    return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    const t0 = Date.now();
    for (;;) {
      try { if (await this.evaluate('document.readyState === "complete"')) break; } catch (e) {}
      if (Date.now() - t0 > 30000) throw new Error('navigation never completed: ' + url);
      await sleep(100);
    }
  }
  mouse(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', Object.assign({
      type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1
    }, extra));
  }
  async click(x, y) {
    await this.mouse('mouseMoved', x, y, { buttons: 0 });
    await this.mouse('mousePressed', x, y);
    await sleep(60);
    await this.mouse('mouseReleased', x, y, { buttons: 0 });
  }
}

export async function launch({ port = 9334, width = 500, height = 900 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plu-verify-'));
  const proc = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--no-service-autorun',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader', '--hide-scrollbars',
    `--window-size=${width},${height}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(base + '/json/version')).ok) break; } catch (e) {}
    if (Date.now() - t0 > 30000) throw new Error('Chrome never answered on ' + base + '\n' + stderr);
    await sleep(150);
  }
  const tab = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('no devtools socket')); });

  const events = { console: [], exceptions: [], requests: [], responses: [], failed: [], contexts: [] };
  const page = new Page(ws, events);
  for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable']) await page.send(m);
  return {
    page, events,
    async close() { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(300); }
  };
}
