/* Minimal CDP harness (no dependencies): launches Chrome headless, attaches to
   the page target, and offers navigate / evaluate / console+network capture. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://127.0.0.1:5500';

const profile = mkdtempSync(join(tmpdir(), 'sr-cdp-'));

export async function launch({ headful = false } = {}) {
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required',
  ];
  if (!headful) args.push('--headless=new');
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable');

  const api = {
    events,
    send,
    async goto(url) {
      events.length = 0;
      await send('Page.navigate', { url: BASE + url });
      await new Promise(r => setTimeout(r, 300));
    },
    async evaluate(expression, awaitPromise = false) {
      const r = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise, allowUnsafeEvalBlockedByCSP: false,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' +
        (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
      return r.result.value;
    },
    console() {
      return events.filter(e => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded')
        .map(e => e.method === 'Log.entryAdded'
          ? `[${e.params.entry.level}] ${e.params.entry.text}`
          : `[${e.params.type}] ` + e.params.args.map(a => a.value !== undefined ? a.value :
            (a.description || a.type)).join(' '));
    },
    requests() {
      return events.filter(e => e.method === 'Network.requestWillBeSent')
        .map(e => e.params.request.url);
    },
    exceptions() {
      return events.filter(e => e.method === 'Runtime.exceptionThrown')
        .map(e => e.params.exceptionDetails.text + ' ' +
          (e.params.exceptionDetails.exception?.description || ''));
    },
    async close() {
      ws.close();
      proc.kill();
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
  return api;
}
