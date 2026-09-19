/* The round trip for Learn to Fly 2:

     1. fresh boot, play until the movie writes its save
     2. read the PluStore document, decode the LSO
     3. seed values into it from a page that is NOT playing the movie
     4. reload: confirm the movie's own localStorage view returns the seeded bytes
        (the read half, through the same area Ruffle uses), then play once and
        report which seeds the movie kept

   The page has to be left before editing: a live movie re-flushes its SharedObject
   out of its in-memory data, which overwrites a live edit within a second or two. */
import { serve, browser, sleep } from './h.mjs';
import { decodeLso, fileValue } from './amf.mjs';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8381);
const b = await browser({ port: 9371 });
const say = (s) => console.log(s);
const KEY = 'learn-to-fly-2.swf/mainprofile';
const DOC_KEY = 'plu:text:learn-to-fly-2';
const storageId = { securityOrigin: origin, isLocalStorage: true };
const SEED = { bestAltitude: 123456, player_cash: 98765, daysTotal: 4321 };

const docNow = async () => {
  const r = await b.send('DOMStorage.getDOMStorageItems', { storageId });
  const e = (r.entries || []).find(([k]) => k === DOC_KEY);
  return e ? e[1] : null;
};
async function playToWrite() {
  await b.click(632, 400); await sleep(2500);
  for (let pass = 1; pass <= 3; pass++) for (let y = 110; y <= 660; y += 80) for (let x = 180; x <= 1100; x += 100) {
    await b.click(x, y); await sleep(1100);
    await b.send('Page.captureScreenshot', { format: 'png' });
    if ((await b.raw('PluStore.stats().fileWrites')) > 0) return 'wrote at ' + x + ',' + y;
  }
  return 'never wrote';
}
function seedFields(b64, values) {
  const buf = Buffer.from(b64, 'base64');
  const lso = decodeLso(b64);
  const done = [];
  for (const key of Object.keys(values)) {
    const spot = lso.offsets[key];
    if (!spot || spot.marker !== 0x00) { done.push(key + ': skipped (no double)'); continue; }
    buf.writeDoubleBE(values[key], spot.at + 1);
    done.push(key + ': seeded at byte ' + spot.at);
  }
  say('  ' + done.join('; '));
  return buf.toString('base64');
}

try {
  await b.send('DOMStorage.enable');
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });

  say('--- VISIT 1 ---');
  await b.goto(origin + '/games/learn-to-fly-2/index.html', 2000);
  await sleep(22000);
  say('play: ' + await playToWrite());
  const doc1 = await docNow();
  const b64 = fileValue(doc1, KEY);
  const lso1 = decodeLso(b64);
  say('document: ' + doc1.length + ' chars; ' + KEY + ' = ' + b64.length + ' b64, name "' +
    lso1.soName + '", ' + Object.keys(lso1.fields).length + ' fields, parsed to byte ' + lso1.consumed);

  say('seeding:');
  const seeded = seedFields(b64, SEED);
  const D2 = doc1.replace('@file ' + KEY + '\n' + b64, '@file ' + KEY + '\n' + seeded);

  await b.goto(origin + '/_ltf2/blank.html', 1500);
  await b.raw('localStorage.setItem(' + JSON.stringify(DOC_KEY) + ', ' + JSON.stringify(D2) + ')');
  say('edited document written from a page that is not playing: ' +
    ((await b.raw('localStorage.getItem(' + JSON.stringify(DOC_KEY) + ')')) === D2));

  say('--- VISIT 2 (reload; state before any play) ---');
  await b.goto(origin + '/games/learn-to-fly-2/index.html', 2000);
  await sleep(22000);
  say('PluStore stats: ' + await b.raw('JSON.stringify(PluStore.stats())'));
  const view = await b.raw('localStorage.getItem(' + JSON.stringify(KEY) + ')');
  say('movie\u2019s own view of localStorage: ' + (view ? view.length + ' chars' : 'null'));
  say('the movie is handed exactly the seeded save: ' + (view === seeded));
  const v = decodeLso(view);
  say('decoded seeds before play: ' + Object.keys(SEED).map((k) => k + '=' + v.fields[k]).join('  '));

  say('--- play ---');
  say('play: ' + await playToWrite());
  const doc3 = await docNow();
  const lso3 = decodeLso(fileValue(doc3, KEY));
  say('document after play: ' + lso3.bytes + ' bytes, parsed to ' + lso3.consumed);
  say('seed survival:');
  for (const k of Object.keys(SEED)) {
    say('  ' + k.padEnd(13) + ' seeded ' + String(SEED[k]).padEnd(9) + ' -> after play ' + lso3.fields[k] +
      (lso3.fields[k] === SEED[k] ? '   SURVIVED' : '   overwritten'));
  }

  say('\noff-machine requests: ' + b.events.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:')).length);
  say('exceptions: ' + JSON.stringify(b.events.exceptions.slice(0, 3)));
} catch (e) {
  say('FAILED: ' + (e && e.stack || e));
} finally {
  await b.close();
  process.exit(0);
}
