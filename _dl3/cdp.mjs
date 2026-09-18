/* Minimal dependency-free CDP client, scratch only: launch Chrome, drive a page,
   evaluate JS, screenshot, count requests. */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ headless = true, profile } = {}) {
  const dir = profile || mkdtempSync(join(tmpdir(), 'cdp-'));
  const args = [
    '--remote-debugging-port=0',
    '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--window-size=' + (process.env.WINSIZE || '1280,800'),
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
  const { targetInfos } = await browser.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });

  const listeners = { console: [], network: [], errors: [] };
  const mine = (sid) => sid === sessionId;
  browser.on('Runtime.consoleAPICalled', (p, sid) => {
    if (!mine(sid)) return;
    listeners.console.push({ type: p.type, text: (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ') });
  });
  browser.on('Runtime.exceptionThrown', (p, sid) => {
    if (!mine(sid)) return;
    const d = p.exceptionDetails || {};
    listeners.errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  });
  browser.on('Network.requestWillBeSent', (p, sid) => {
    if (!mine(sid)) return;
    listeners.network.push({ url: p.request.url, method: p.request.method });
  });

  let dead = null;
  browser.onClose(() => { dead = 'browser died'; });

  return {
    raw: browser, sessionId, listeners, dead: () => dead,
    send: (method, params) => browser.send(method, params, sessionId),
    on(method, fn) { browser.on(method, fn); },
    async addInitScript(source) { return this.send('Page.addScriptToEvaluateOnNewDocument', { source }); },
    async evaluate(expr) {
      const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async navigate(url) { await this.send('Page.navigate', { url }); },
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
        const code = ch === '\r' ? 'Enter' : ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase();
        const vk = ch === '\r' ? 13 : ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
        const common = { key: ch === '\r' ? 'Enter' : ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, ...common });
        await this.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, ...common });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch, ...common });
      }
    },
    close() { try { proc.kill(); } catch {} },
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws open failed')); });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  const closedHandlers = [];
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
  ws.onclose = () => {
    for (const { reject } of pending.values()) reject(new Error('CDP connection closed (browser died)'));
    pending.clear();
    for (const h of closedHandlers) h();
  };
  return {
    raw: ws,
    onClose(fn) { closedHandlers.push(fn); },
    on(method, fn) { handlers.set(method, fn); },
    send(method, params = {}, sessionId) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify(sessionId ? { id: mid, method, params, sessionId } : { id: mid, method, params }));
      });
    },
  };
}

/* PNG statistics without a dependency: decode for a cheap "is anything drawn"
   and "did the frame change" signal. */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function pngStats(path) {
  const buf = readFileSync(path);
  let at = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (ft === 1) cur[i] = (cur[i] + a) & 255;
      else if (ft === 2) cur[i] = (cur[i] + b) & 255;
      else if (ft === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  let hash = 0, nb = 0, n = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * ch;
      const v = out[i] + out[i + 1] + out[i + 2];
      if (v > 30) nb++;
      n++;
      hash = (hash * 31 + v) | 0;
    }
  }
  return { width, height, hash, nonblank: +(nb / n).toFixed(3) };
}
