import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8399);
const b = await browser({ port: 9389 });
const say = (s) => console.log(s);
const hook = `
var realPlu = null;
Object.defineProperty(window, 'PluStore', {
  configurable: true,
  get: function () { return realPlu; },
  set: function (v) {
    realPlu = v;
    var orig = v.installSharedObjects.bind(v);
    v.installSharedObjects = function (movie) {
      var area = orig(movie);
      window.__so = [];
      var wrapped = new Proxy(area, {
        get: function (t, p) {
          if (typeof p === 'symbol' || p in t) {
            var f = t[p]; return typeof f === 'function' ? f.bind(t) : f;
          }
          var val = t[p];
          window.__so.push(['GET', String(p), val ? String(val).length : 0]);
          return val;
        },
        set: function (t, p, val) {
          window.__so.push(['SET', String(p), (val === undefined || val === null) ? 0 : String(val).length]);
          t[p] = val; return true;
        }
      });
      Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true, writable: true });
      return area;
    };
  }
});
`;
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(12000);
  say('so log up to now: ' + await b.raw('JSON.stringify(window.__so || "no log")'));
  await b.click(632, 400);
  await sleep(5000);
  const spots = [[632, 300], [480, 350], [760, 450], [632, 600], [400, 450]];
  for (let i = 0; i < 160; i++) {
    const [x, y] = spots[i % spots.length];
    await b.click(x, y);
    await b.send('Page.captureScreenshot', { format: 'png' });
    await sleep(150);
  }
  say('so log after driving: ' + await b.raw('JSON.stringify((window.__so||[]).slice(0,40))'));
  say('log length: ' + await b.raw('(window.__so||[]).length'));
  say('fileWrites: ' + await b.raw('PluStore.stats().fileWrites'));
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
