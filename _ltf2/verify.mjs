/* Does the converted page start the movie, reach the network for nothing, refuse
   the hosts inside the SWF, and put its save in the document? */
import { serve, browser, sleep } from './h.mjs';
import { decodeLso, fileValue } from './amf.mjs';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin, hits } = await serve(ROOT, 8380);
const b = await browser({ port: 9370 });
const say = (s) => console.log(s);
const DOC_KEY = 'plu:text:learn-to-fly-2';
const storageId = { securityOrigin: origin, isLocalStorage: true };

const docNow = async () => {
  const r = await b.send('DOMStorage.getDOMStorageItems', { storageId });
  const e = (r.entries || []).find(([k]) => k === DOC_KEY);
  return e ? e[1] : null;
};
async function sweep(label) {
  await b.click(632, 400); await sleep(2500);
  for (let pass = 1; pass <= 3; pass++) for (let y = 110; y <= 660; y += 80) for (let x = 180; x <= 1100; x += 100) {
    await b.click(x, y); await sleep(1100);
    await b.send('Page.captureScreenshot', { format: 'png' });
    const w = await b.raw('PluStore.stats().fileWrites');
    if (w > 0) return label + ': wrote at ' + x + ',' + y + ' (fileWrites=' + w + ')';
  }
  return label + ': never wrote';
}

try {
  await b.send('DOMStorage.enable');
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });

  await b.goto(origin + '/games/learn-to-fly-2/index.html', 2000);
  await sleep(22000);
  say('stats after boot: ' + await b.raw('JSON.stringify(PluStore.stats())'));
  say('player: ' + await b.raw("(function(){var p=document.querySelector('ruffle-player');return p?('present, shadow=' + (p.shadowRoot?p.shadowRoot.childElementCount:'none')):'missing';})()"));

  say(await sweep('play'));
  const doc = await docNow();
  if (!doc) { say('document: none'); }
  else {
    const key = doc.split('\n').filter((l) => l.startsWith('@file ')).map((l) => l.slice(6));
    say('document: ' + doc.length + ' chars, blocks ' + JSON.stringify(key));
    for (const k of key) {
      const b64 = fileValue(doc, k);
      const lso = decodeLso(b64);
      say('  ' + k + ': ' + b64.length + ' b64 / ' + lso.bytes + ' bytes, name="' + lso.soName +
        '", ' + Object.keys(lso.fields).length + ' fields' + (lso.error ? ', ERROR ' + lso.error : ', parsed to byte ' + lso.consumed));
      say('    ' + Object.entries(lso.fields).slice(0, 14).map(([f, v]) => f + '=' + JSON.stringify(v)).join('  '));
    }
  }

  say('\n=== console');
  for (const c of b.events.console) if (!/Ruffle WASM|New Ruffle|Loading SWF/.test(c.text)) say('  [' + c.type + '] ' + String(c.text).slice(0, 220));
  say('\n=== requests (' + b.events.requests.length + ')');
  for (const r of b.events.requests) say('  ' + r.method + ' ' + r.url.slice(0, 110));
  say('off-machine requests: ' + b.events.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:')).length);
  say('404s served: ' + JSON.stringify(hits.filter((h) => h.status === 404).map((h) => h.url)));
  say('failed loads: ' + JSON.stringify(b.events.failed.slice(0, 8)));
  say('exceptions: ' + JSON.stringify(b.events.exceptions.slice(0, 5)));
} catch (e) {
  say('FAILED: ' + (e && e.stack || e));
} finally {
  await b.close();
  process.exit(0);
}
