/* Boot Duck Life in headless Chrome and report what actually happens (temporary). */
import { launch, sleep } from './cdp.mjs';

const URL = process.env.DUCK_URL || 'http://127.0.0.1:8332/games/duck-life/index.html';
const { page, events, close } = await launch();

const report = {};
const t0 = Date.now();
await page.navigate(URL);

/* Wait for Ruffle to be up and the movie to be handed to it. */
try {
  await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer global');
  report.ruffleGlobal = await page.evaluate('Object.keys(window.RufflePlayer || {}).join(",")');
} catch (e) { report.ruffleGlobalError = String(e.message); }

try {
  await page.waitFor(
    '(() => { const p = document.querySelector("ruffle-player"); return !!(p && p.shadowRoot); })()',
    30000, 'ruffle-player shadow root');
} catch (e) { report.shadowError = String(e.message); }

/* Give the wasm compile + movie load time. */
await sleep(25000);

report.elapsedMs = Date.now() - t0;
report.page = await page.evaluate(`JSON.stringify({
  title: document.title,
  players: document.querySelectorAll('ruffle-player').length,
  panel: !!document.querySelector('#flash-container'),
  containerText: (document.getElementById('flash-container') || {}).textContent || '',
  shadow: (() => {
    const p = document.querySelector('ruffle-player');
    const sr = p && p.shadowRoot;
    if (!sr) return null;
    const canvas = sr.querySelector('canvas');
    return {
      nodes: sr.children.length,
      hasCanvas: !!canvas,
      canvasSize: canvas ? [canvas.width, canvas.height] : null,
      innerHtmlHead: sr.innerHTML.slice(0, 300)
    };
  })(),
  ruffleStorage: (() => {
    try { const { localStorage } = window; return !!localStorage; } catch (e) { return 'threw: ' + e.message; }
  })()
})`);

report.localStorageProps = await page.evaluate(`JSON.stringify({
  descriptor: Object.getOwnPropertyDescriptor(window, 'localStorage'),
  protoName: Object.getPrototypeOf(window.localStorage).constructor.name,
  isOurProxy: Object.getPrototypeOf(window.localStorage).constructor.name === 'Object'
})`);

report.keys = await page.evaluate(`JSON.stringify({
  plainKeys: (() => { const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; })(),
  docLen: typeof PluStore !== 'undefined' ? PluStore.get().length : null
})`);

report.requests = events.requests;
report.responses = events.responses.map((r) => r.status + ' ' + r.url);
report.failed = events.failed;
report.exceptions = events.exceptions;
report.console = events.console.map((c) => c.type + ': ' + c.text);

console.log(JSON.stringify(report, null, 2));
await page.screenshot('_duck/boot.png');
await close();
