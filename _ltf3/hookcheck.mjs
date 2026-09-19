import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8404);
const b = await browser({ port: 9394 });
const HOOK = `(function () {
  window.__log = [];
  var cap = null;
  var lib = null;
  Object.defineProperty(window, 'PluStore', {
    configurable: true,
    get: function () { return lib; },
    set: function (v) {
      var orig = v.installSharedObjects;
      v.installSharedObjects = function (movie) {
        var area = orig.call(v, movie);
        window.__hooked = true;
        var seen = new Proxy(area, {
          get: function (t, p) {
            if (p === 'getItem') return function (k) { window.__log.push(['get', String(k)]); return t.getItem(k); };
            if (p === 'setItem') return function (k, val) { window.__log.push(['set', String(k)]); return t.setItem(k, val); };
            return t[p];
          }
        });
        Object.defineProperty(window, 'localStorage', { value: seen, configurable: true, enumerable: true });
        return seen;
      };
      lib = v;
    }
  });
})();`;
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 6000);
  console.log('hooked: ' + await b.raw('String(window.__hooked)'));
  console.log('isProxy: ' + await b.raw("String(!!window.localStorage && window.localStorage !== Object.getPrototypeOf(window.localStorage))"));
  console.log('probe get: ' + await b.raw("String(localStorage.getItem('zzz'))"));
  console.log('log: ' + await b.raw('JSON.stringify(window.__log)'));
  console.log('has getItem: ' + await b.raw("String(typeof localStorage.getItem)"));
  await sleep(14000);
  console.log('after boot log: ' + await b.raw('JSON.stringify(window.__log)'));
  console.log('stats: ' + JSON.stringify(await b.raw('PluStore.stats()')));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
