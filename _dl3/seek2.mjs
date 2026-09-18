/* Click a coarse grid, logging to a file so nothing is lost if the run is
   killed, and stop at the first SharedObject access. */
import { launch, pngStats, sleep } from './cdp.mjs';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8342';
const LOG = '_dl3/seek2.log';
writeFileSync(LOG, '');
const note = (s) => { appendFileSync(LOG, s + '\n'); console.log(s); };

const page = await launch();
await page.send('Page.enable');
await page.send('Runtime.enable');
page.raw.onClose(() => note('!! browser died'));

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
await sleep(9000);
note('booted; storage log: ' + ((await page.evaluate('window.__log.join(" | ")')) || '(empty)'));
note('player geometry: ' + (await page.evaluate(`(() => {
  const p = document.querySelector('ruffle-player');
  if (!p) return 'none';
  const r = p.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, w: Math.round(r.width), h: Math.round(r.height) });
})()`)));

const pts = [];
for (let y = 620; y >= 60; y -= 70) for (let x = 120; x <= 1180; x += 120) pts.push([x, y]);
note('sweeping ' + pts.length + ' points');

for (let i = 0; i < pts.length; i++) {
  const [x, y] = pts[i];
  await page.click(x, y);
  await sleep(900);
  const log = await page.evaluate('window.__log.join(" | ")');
  if (log) {
    await page.screenshot('_dl3/seek2-hit.png');
    note('STORAGE after clicking ' + x + ',' + y + ' -> ' + log);
    break;
  }
  if (i % 9 === 0) {
    await page.screenshot('_dl3/seek2.png');
    const s = pngStats('_dl3/seek2.png');
    note('  ...' + i + ' clicks, screen draw=' + s.nonblank + ' hash=' + s.hash);
  }
}
note('final storage log: ' + ((await page.evaluate('window.__log.join(" | ")')) || '(still empty)'));
note('docLen: ' + await page.evaluate('PluStore.get().length'));
await page.screenshot('_dl3/seek2-final.png');
page.close();
process.exit(0);
