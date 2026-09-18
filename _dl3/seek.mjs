/* Click a grid and watch for the first SharedObject access, which is the moment
   the game actually starts. */
import { launch, pngStats, sleep } from './cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8342';
const page = await launch();
await page.send('Page.enable');
await page.send('Runtime.enable');
page.raw.onClose(() => console.log('!! browser died'));

await page.addInitScript(`
window.__log = [];
(function () {
  var dp = Object.defineProperty;
  Object.defineProperty = function (target, prop, desc) {
    if (target === window && prop === 'localStorage' && desc && 'value' in desc && typeof Proxy === 'function') {
      var raw = desc.value;
      desc = { value: new Proxy(raw, {
        get: function (t, p) {
          if (typeof p === 'symbol') return t[p];
          var v = t[p];
          if (typeof v === 'function') {
            return function () {
              var r = v.apply(t, arguments);
              window.__log.push(p + '(' + JSON.stringify(arguments[0]) + ')');
              return r;
            };
          }
          var isMethod = p === 'getItem' || p === 'setItem' || p === 'removeItem' || p === 'clear' || p === 'key' || p === 'length';
          if (!isMethod && (typeof v === 'string' || v === undefined)) {
            window.__log.push('GET[' + String(p) + '] -> ' + (typeof v === 'string' ? v.length + ' chars' : 'undefined'));
          }
          return v;
        },
        set: function (t, p, val) { window.__log.push('SET[' + String(p) + '] <- ' + String(val).length + ' chars'); t[p] = val; return true; }
      }), configurable: true, enumerable: desc.enumerable };
    }
    return dp.call(Object, target, prop, desc);
  };
})();
`);

await page.navigate(BASE + '/games/duck-life-3/index.html');
await sleep(8000);
console.log('before clicking:', await page.evaluate('window.__log.join(" | ")') || '(nothing)');

const points = [];
for (let y = 620; y >= 40; y -= 80) for (let x = 100; x <= 1180; x += 100) points.push([x, y]);

let found = false;
let prev = null, prevNb = null;
for (let i = 0; i < points.length && !found; i++) {
  const [x, y] = points[i];
  await page.click(x, y);
  await sleep(700);
  const log = await page.evaluate('window.__log.join(" | ")');
  await page.screenshot('_dl3/seek.png');
  const s = pngStats('_dl3/seek.png');
  const changed = prev && Math.abs(s.hash - prev) > 0 && s.nonblank !== prevNb;
  if (log) {
    console.log('storage event after clicking', x, y, '->', log);
    found = true;
  }
  if (changed) console.log('screen changed at', x, y, 'draw=' + s.nonblank);
  prev = s.hash; prevNb = s.nonblank;
}
await page.screenshot('_dl3/seek-final.png');
console.log('after sweep:', await page.evaluate('window.__log.join(" | ")') || '(still nothing)');
console.log('docLen', await page.evaluate('PluStore.get().length'));
page.close();
process.exit(0);
