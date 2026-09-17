/* Duck Life, end to end: local files only, save in the document, and the save
   actually handed back to the game. (temporary) */
import { launch, sleep } from './cdp.mjs';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8332/games/duck-life/index.html';

/* ── PNG stats, so "the game is rendering" and "the click did something" are
      measured rather than assumed. ─────────────────────────────────────── */
function decodePng(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported color type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, px: out };
}
function stats(img) {
  const { px, channels, w, h } = img;
  let nonBlack = 0, sum = 0;
  for (let i = 0; i < px.length; i += channels) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (r > 24 || g > 24 || b > 24) nonBlack++;
    sum += r + g + b;
  }
  return { w, h, nonBlackPct: +(100 * nonBlack / (w * h)).toFixed(1), mean: +(sum / (w * h * 3)).toFixed(1) };
}
function diffPct(a, b) {
  const n = Math.min(a.px.length, b.px.length);
  let d = 0, total = 0;
  for (let i = 0; i < n; i += a.channels) { d += Math.abs(a.px[i] - b.px[i]); total += 255; }
  return +(100 * d / total).toFixed(1);
}

/* An init script that wraps the installed area so the game's own reads are
   visible. Registered before the page's scripts, so its DOMContentLoaded
   listener runs before the one that starts the movie. */
const init = `
document.addEventListener('DOMContentLoaded', function () {
  var area = window.localStorage;
  var log = window.__area = [];
  var wrapped = new Proxy(area, {
    get: function (t, p) {
      if (typeof p === 'symbol') return t[p];
      var v = t[p];
      if (typeof v !== 'function') return v;
      return function () {
        var out = v.apply(t, arguments);
        if (p === 'getItem' || p === 'setItem') {
          log.push(p + ' ' + String(arguments[0]) + ' -> ' + (p === 'getItem' ? String(out).slice(0, 24) : String(arguments[1]).slice(0, 24)));
        }
        return out;
      };
    },
    set: function (t, p, v) { t[p] = v; return true; }
  });
  Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true, enumerable: true });
});
`;

const { page, events, close } = await launch();
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });

const report = {};
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
report.keysAtInstall = await page.evaluate(`JSON.stringify({
  proto: Object.getPrototypeOf(localStorage).constructor.name,
  docLen: PluStore.get().length,
  keys: (() => { const o = []; for (let i = 0; i < localStorage.length; i++) o.push(localStorage.key(i)); return o; })()
})`);

await page.waitFor('(() => { const p = document.querySelector("ruffle-player"); return !!(p && p.shadowRoot && p.shadowRoot.querySelector("canvas")); })()', 40000, 'canvas');
report.declaredMovie = await page.evaluate(`(() => {
  const p = document.querySelector('ruffle-player');
  return JSON.stringify({ players: document.querySelectorAll('ruffle-player').length });
})()`);
await sleep(22000);

const boot = {};
await page.screenshot('_duck/f1.png');
boot.areaLog = await page.evaluate('JSON.stringify(window.__area)');
boot.doc = await page.evaluate('PluStore.get()');
boot.stats = await page.evaluate('JSON.stringify(PluStore.stats())');
report.boot = boot;
report.frame1 = stats(decodePng('_duck/f1.png'));
await page.screenshot('_duck/f2.png');
report.animating = diffPct(decodePng('_duck/f1.png'), decodePng('_duck/f2.png'));

/* Play: click the middle of the movie a few times. */
const box = JSON.parse(await page.evaluate(`JSON.stringify((() => {
  const p = document.querySelector('ruffle-player');
  const r = p.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})())`));
for (let i = 0; i < 5; i++) { await page.click(box.x, box.y); await sleep(1800); }
await sleep(6000);
await page.screenshot('_duck/f3.png');
report.frameAfterClicks = stats(decodePng('_duck/f3.png'));
report.clickChangedFrame = diffPct(decodePng('_duck/f2.png'), decodePng('_duck/f3.png'));
report.docAfterClicks = await page.evaluate('PluStore.get()');

/* The round trip: doctor the stored SharedObject, reload, and look at what the
   game is handed and what it writes back. */
const docText = report.docAfterClicks;
const m = /^@file (.*)\n([A-Za-z0-9+/=]+)\n@end$/m.exec(docText);
if (!m) throw new Error('no @file block in the document:\n' + docText);
const storedName = m[1];
const soap = Buffer.from(m[2], 'base64');

/* Duck Life's save is AMF0: ... "money\0<type><payload>" ... A double is 8 bytes
   big-endian, preceded by 0x00. Set money to 4321 and mark the seed field. */
const moneyAt = soap.indexOf(Buffer.from('money\0'));
if (moneyAt < 0) throw new Error('no money field in the SharedObject');
const doctored = Buffer.from(soap);
doctored.writeUInt8(0x00, moneyAt + 6);
doctored.writeDoubleBE(4321.0, moneyAt + 7);
const doctoredB64 = doctored.toString('base64');
report.doctored = { key: storedName, bytes: doctored.length, origMoneyBytes: soap.subarray(moneyAt + 6, moneyAt + 15).toString('hex') };

await page.evaluate(`localStorage.setItem(${JSON.stringify(storedName)}, ${JSON.stringify(doctoredB64)})`);
report.docAfterDoctor = await page.evaluate('PluStore.get()');

/* Reload: fresh page, same document in the browser store. */
await page.navigate('about:blank');
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(25000);
report.afterReload = {
  areaLog: await page.evaluate('JSON.stringify(window.__area)'),
  doc: await page.evaluate('PluStore.get()')
};

report.requests = events.requests;
report.failed = events.failed.map((f) => f.error + ' ' + f.url);
report.exceptions = events.exceptions;
report.console = events.console.map((c) => c.type + ': ' + c.text.replace(/\s+/g, ' ').slice(0, 160));

console.log(JSON.stringify(report, null, 1));
await close();
