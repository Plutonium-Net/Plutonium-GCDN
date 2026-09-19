/* See every storage operation Ruffle makes, by wrapping the area the page
   installs, and driving the movie hard with both mouse and keyboard. */
import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8403);
const b = await browser({ port: 9393 });

const HOOK = `(function () {
  window.__log = [];
  function note(op, k, v) {
    if (window.__log.length < 400) window.__log.push([op, String(k), v === undefined ? undefined : String(v).length]);
  }
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
            if (p === 'getItem') return function (k) { var r = t.getItem(k); note('getItem', k, r === null ? undefined : r); return r; };
            if (p === 'setItem') return function (k, val) { note('setItem', k, val); return t.setItem(k, val); };
            if (p === 'removeItem') return function (k) { note('removeItem', k); return t.removeItem(k); };
            if (p === 'clear') return function () { note('clear', '*'); return t.clear(); };
            if (p === 'key') return function (i) { var r = t.key(i); note('key', i, r === null ? undefined : r); return r; };
            if (p === 'length') return t.length;
            if (typeof p === 'string') { var v = t[p]; note('read[' + (v === undefined ? 'miss' : 'hit') + ']', p, v); return v; }
            return t[p];
          },
          set: function (t, p, val) { note('assign', p, val); return t[p] = val; },
          has: function (t, p) { note('has', p); return p in t; },
          ownKeys: function (t) { note('ownKeys', '*'); return Reflect.ownKeys(t); },
          deleteProperty: function (t, p) { note('delete', p); return delete t[p]; }
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
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 3000);
  await sleep(11000);
  await b.click(632, 400); // Ruffle's own play button
  await sleep(5000);
  const spots = [[632, 400], [632, 300], [480, 350], [760, 450], [632, 600], [400, 450], [632, 200]];
  const keys = ['Space', 'Enter', 'ArrowRight', 'ArrowLeft', 'w', 'a', 's', 'd'];
  for (let i = 0; i < 120; i++) {
    const [x, y] = spots[i % spots.length];
    await b.click(x, y);
    const k = keys[i % keys.length];
    const base = { key: k, code: k, windowsVirtualKeyCode: { Enter: 13, Space: 32, ArrowRight: 39, ArrowLeft: 37, w: 87, a: 65, s: 83, d: 68 }[k] || 0, text: k.length === 1 ? k : undefined };
    await b.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
    await b.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    await b.send('Page.captureScreenshot', { format: 'png' });
    await sleep(130);
  }
  console.log('storage ops: ' + await b.raw('JSON.stringify(window.__log)'));
  console.log('stats: ' + JSON.stringify(await b.raw('PluStore.stats()')));
  console.log('document: ' + String(await b.raw("localStorage.getItem('plu:text:learn-to-fly-3')")).slice(0, 300));
  const cons = b.events.console.filter((c) => /LOG:|ERROR/.test(c.text)).slice(-18);
  console.log('--- movie log tail\n' + cons.map((c) => c.text.replace(/^.*LOG: /, '').slice(0, 200)).join('\n'));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
