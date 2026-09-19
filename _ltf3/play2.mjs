/* Give the movie every chance to save: long idle, then hold-and-release play
   (how the Learn to Fly games launch), watching for Ruffle's write verb. */
import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8407);
const b = await browser({ port: 9397 });

const HOOK = `(function () {
  window.__log = [];
  window.__traces = [];
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
          deleteProperty: function (t, p) { note('DELETE', p); return delete t[p]; },
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

const hold = async (x, y, ms) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(ms);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
};

try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 3000);
  await sleep(11000);
  await b.click(632, 400);
  await sleep(6000);

  console.log('--- after play button');
  console.log(b.events.console.filter((c) => /LOG:/.test(c.text)).slice(-6).map((c) => c.text.replace(/^.*LOG: /, '').slice(0, 130)).join('\n'));

  /* How many traces has the movie emitted so far? Anything new means it moved. */
  const before = b.events.console.length;
  await sleep(45000);
  console.log('--- after 45s idle, new console events: ' + (b.events.console.length - before));
  console.log(b.events.console.slice(before).filter((c) => /LOG:/.test(c.text)).map((c) => c.text.replace(/^.*LOG: /, '').slice(0, 130)).join('\n'));

  const mark = b.events.console.length;
  const pts = [[632, 400], [632, 520], [500, 300], [760, 300]];
  for (let i = 0; i < 40; i++) {
    const [x, y] = pts[i % pts.length];
    await hold(x, y, 1400);
    await sleep(900);
  }
  console.log('--- after 40 charge/release cycles, new console events: ' + (b.events.console.length - mark));
  console.log(b.events.console.slice(mark).filter((c) => /LOG:/.test(c.text)).map((c) => c.text.replace(/^.*LOG: /, '').slice(0, 130)).join('\n'));
  console.log('storage ops: ' + await b.raw('JSON.stringify(window.__log)'));
  console.log('stats: ' + JSON.stringify(await b.raw('PluStore.stats()')));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
