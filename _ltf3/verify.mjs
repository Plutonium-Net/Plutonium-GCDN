import { serve, browser, sleep } from './h.mjs';
import { decodeLso, fileValue } from './amf.mjs';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin, hits } = await serve(ROOT, 8390);
const b = await browser({ port: 9380 });
const say = (s) => console.log(s);
const DOC_KEY = 'plu:text:learn-to-fly-3';
const storageId = { securityOrigin: origin, isLocalStorage: true };

const docNow = async () => {
  const r = await b.send('DOMStorage.getDOMStorageItems', { storageId });
  const e = (r.entries || []).find(([k]) => k === DOC_KEY);
  return e ? e[1] : null;
};
async function waitReady(limitMs = 120000) {
  const probe = "function(){var p=document.querySelector('ruffle-player');if(!p||!p.shadowRoot)return 0;var c=p.shadowRoot.querySelector('canvas');return c&&c.width>0?1:0;}";
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await b.raw('(' + probe + ')()')) return 'canvas up after ' + Math.round((Date.now() - t0) / 1000) + 's';
    await sleep(1500);
  }
  return 'canvas never appeared';
}
async function playToWrite() {
  say('  ' + await waitReady());
  await sleep(10000);
  for (const [x, y] of [[632, 400], [480, 350], [632, 300]]) {
    await b.click(x, y); await sleep(2500);
    await b.send('Page.captureScreenshot', { format: 'png' });
    if ((await b.raw('PluStore.stats().fileWrites')) > 0) return 'wrote at ' + x + ',' + y;
  }
  for (let pass = 1; pass <= 3; pass++) for (let y = 110; y <= 660; y += 80) for (let x = 180; x <= 1100; x += 100) {
    await b.click(x, y); await sleep(1100);
    await b.send('Page.captureScreenshot', { format: 'png' });
    if ((await b.raw('PluStore.stats().fileWrites')) > 0) return 'wrote at pass ' + pass + ' ' + x + ',' + y;
  }
  return 'never wrote';
}

try {
  await b.send('DOMStorage.enable');
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });

  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(15000);
  say('stats after boot: ' + await b.raw('JSON.stringify(PluStore.stats())'));
  say('play: ' + await playToWrite());

  const doc = await docNow();
  if (!doc) { say('document: none'); }
  else {
    const keys = doc.split('\n').filter((l) => l.startsWith('@file ')).map((l) => l.slice(6));
    say('document: ' + doc.length + ' chars, blocks ' + JSON.stringify(keys));
    for (const k of keys) {
      const lso = decodeLso(fileValue(doc, k));
      say('  ' + k + ': ' + lso.bytes + ' bytes, name="' + lso.soName + '", ' + Object.keys(lso.fields).length +
        ' fields, parsed to ' + lso.consumed + (lso.error ? '  ERROR ' + lso.error : ''));
      say('    ' + Object.keys(lso.fields).slice(0, 12).join(' '));
    }
  }

  say('\n=== console (non-Ruffle)');
  for (const c of b.events.console) if (!/Ruffle WASM|New Ruffle|Loading SWF/.test(c.text)) say('  [' + c.type + '] ' + String(c.text).slice(0, 220));
  say('\n=== requests (' + b.events.requests.length + ')');
  say('off-machine requests: ' + b.events.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:')).length);
  for (const r of b.events.requests) if (!r.url.startsWith(origin)) say('  OFF: ' + r.method + ' ' + r.url.slice(0, 110));
  say('404s served: ' + JSON.stringify(hits.filter((h) => h.status === 404).map((h) => h.url)));
  say('failed loads: ' + JSON.stringify(b.events.failed.slice(0, 8)));
  say('exceptions: ' + JSON.stringify(b.events.exceptions.slice(0, 5)));
} catch (e) {
  say('FAILED: ' + (e && e.stack || e));
} finally {
  await b.close();
  process.exit(0);
}
