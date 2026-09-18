/* Minimal dependency-free CDP client: launch Chrome, open a page, evaluate JS,
   screenshot, count network requests. Used only to verify the Duck Life 2
   conversion; not part of the game. */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export async function launch({ headless = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  const args = [
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--window-size=1280,800',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (headless) args.push('--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  args.push('about:blank');

  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('chrome did not report a ws url\n' + stderr)), 30000);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const m = stderr.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(t); resolve(m[0]); }
    });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error('chrome exited ' + c + '\n' + stderr)); });
  });

  const browser = await connect(wsUrl);
  const targets = await browser.send('Target.getTargets');
  const page = targets.targetInfos.find((t) => t.type === 'page');
  const session = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const s = makeSession(browser, session.sessionId);
  s.close = () => { try { proc.kill(); } catch {} };
  return s;
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws open failed')); });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      const h = handlers.get(msg.method);
      if (h) h(msg.params, msg.sessionId);
    }
  };
  return {
    raw: ws,
    send(method, params = {}, sessionId) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify(sessionId ? { id: mid, method, params, sessionId } : { id: mid, method, params }));
      });
    },
    on(method, fn) { handlers.set(method, fn); },
  };
}

function makeSession(browser, sessionId) {
  const listeners = { console: [], network: [], errors: [] };
  browser.on('Runtime.consoleAPICalled', (p, sid) => {
    if (sid !== sessionId) return;
    const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    listeners.console.push({ type: p.type, text });
  });
  browser.on('Runtime.exceptionThrown', (p, sid) => {
    if (sid !== sessionId) return;
    const d = p.exceptionDetails || {};
    listeners.errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  });
  browser.on('Network.requestWillBeSent', (p, sid) => {
    if (sid !== sessionId) return;
    listeners.network.push({ url: p.request.url, method: p.request.method, type: p.type });
  });
  return {
    raw: browser,
    sessionId,
    listeners,
    send: (method, params) => browser.send(method, params, sessionId),
    on(method, fn) { browser.on(method, fn); },
    async evaluate(expr) {
      const r = await this.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
      });
      if (r.exceptionDetails) {
        throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r.result.value;
    },
    async navigate(url) {
      await this.send('Page.navigate', { url });
    },
    async screenshot(path) {
      const r = await this.send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    async click(x, y) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    async key(text) {
      for (const ch of text) {
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch });
      }
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
