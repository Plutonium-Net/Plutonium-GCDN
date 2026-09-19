/* Find where the movie reacts, then drive those spots and watch for a save.
   Also proves the movie's read reaches PluStore's document: seed it first. */
import { serve, browser, sleep } from './h.mjs';
import { decodePng } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8406);
const b = await browser({ port: 9396 });

const HOOK = `(function () {
  window.__log = [];
  function note(op, k, v) { if (window.__log.length < 500) window.__log.push([op, String(k), v === undefined ? undefined : String(v).length]); }
  var cap = null;
  Object.defineProperty(window, 'RufflePlayer', {
    configurable: true,
    get: function () { return cap; },
    set: function (v) { try { v.config = Object.assign({}, v.config, { logLevel: 'trace' }); } catch (e) {} cap = v; }
  });
  var lib = null;
  Object.defineProperty(window, 'PluStore', {
    configurable: true,
    get: function () { return lib; },
    set: function (v) {
      var orig = v.installSharedObjects;
      v.installSharedObjects = function (movie) {
        var area = orig.call(v, movie);
        var seen = new Proxy(area, {
          get: function (t, p) {
            if (typeof p !== 'string') return t[p];
            if (p === 'length') return t.length;
            var val = t[p];
            note('read[' + (val === undefined ? 'miss' : 'hit') + ']', p, val);
            return val;
          },
          set: function (t, p, val) { note('WRITE', p, val); return t[p] = val; },
          has: function (t, p) { return p in t; },
          ownKeys: function (t) { return Reflect.ownKeys(t); }
        });
        Object.defineProperty(window, 'localStorage', { value: seen, configurable: true, enumerable: true });
        return seen;
      };
      lib = v;
    }
  });
})();`;

const lum = (png) => { const { width, height, channels, data } = png; const out = new Float64Array(width * height); for (let i = 0; i < width * height; i++) { const j = i * channels; out[i] = data[j] * 0.3 + data[j + 1] * 0.59 + data[j + 2] * 0.11; } return { out, width, height }; };
const shot = async () => lum(decodePng(Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')));
const diff = (a, c) => { let s = 0, n = 0; for (let i = 0; i < a.out.length; i += 4) { s += Math.abs(a.out[i] - c.out[i]); n++; } return s / n; };
const stat = (png) => { let s = 0; for (let i = 0; i < png.out.length; i += 4) s += png.out[i]; return (s / (png.out.length / 4)).toFixed(1); };

try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 3000);
  await sleep(11000);

  /* Seed the document under the mapped key, so the movie's read either hits it
     or misses — the one difference that proves where it reads from. */
  await b.raw(`PluStore.files.write('/#LearnToFly3/profileData', 'PluStore-SEED-MARKER')`);

  await b.click(632, 400); /* Ruffle's own play button */
  await sleep(5000);

  const base = await shot();
  console.log('idle luminance ' + stat(base));

  /* Where does the movie react? */
  const cols = [300, 450, 632, 800, 950];
  const rows = [120, 220, 320, 420, 520, 620];
  const hits = [];
  for (const y of rows) {
    let line = String(y).padStart(4) + ' ';
    for (const x of cols) {
      await b.click(x, y);
      await sleep(260);
      const after = await shot();
      const d = diff(base, after);
      line += (d > 4 ? '#' : d > 1 ? '+' : d > 0.2 ? '.' : ' ') + ' ';
      if (d > 1) hits.push({ x, y, d: Number(d.toFixed(1)) });
      await b.click(x, y); /* undo any toggle */
      await sleep(200);
    }
    console.log(line);
  }
  console.log('reactive: ' + JSON.stringify(hits.sort((p, q) => q.d - p.d).slice(0, 8)));

  /* Drive the most reactive spots and watch for a write. */
  const targets = hits.length ? hits.map((h) => [h.x, h.y]) : [[632, 400]];
  for (let i = 0; i < 90; i++) {
    const [x, y] = targets[i % targets.length];
    await b.click(x, y);
    await b.send('Page.captureScreenshot', { format: 'png' });
    await sleep(160);
  }
  console.log('storage ops: ' + await b.raw('JSON.stringify(window.__log)'));
  console.log('stats: ' + JSON.stringify(await b.raw('PluStore.stats()')));
  console.log('doc: ' + String(await b.raw("localStorage.getItem('plu:text:learn-to-fly-3')")).slice(0, 200));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
