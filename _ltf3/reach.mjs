/* Reach the movie's own save event: Ruffle's trace log on, the storage area
   instrumented, and real keyboard input as well as clicks. */
import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8402);
const b = await browser({ port: 9392 });

const HOOK = `(function () {
  window.__log = [];
  var rawDefine = Object.defineProperty;
  Object.defineProperty = function (o, p, d) {
    if (p === 'localStorage' && d && d.value) {
      var area = d.value;
      ['getItem', 'setItem', 'removeItem'].forEach(function (m) {
        var fn = area[m];
        if (typeof fn !== 'function') return;
        Object.defineProperty(area, m, {
          value: function () {
            var a = [].slice.call(arguments);
            var r;
            try { r = fn.apply(area, a); } catch (e) { r = null; }
            if (m === 'getItem') window.__log.push(['GET', String(a[0]), r === null ? null : String(r).length]);
            else if (m === 'setItem') window.__log.push([m, String(a[0]), String(a[1] == null ? '' : a[1]).length]);
            else window.__log.push([m, String(a[0])]);
            return r;
          },
          enumerable: false, configurable: true, writable: true
        });
      });
    }
    return rawDefine.call(Object, o, p, d);
  };
  /* Ruffle reads RufflePlayer.config when a player is created; the page's own
     script runs in the same task as ruffle.min.js, so the assignment is caught
     here and the log level set before that. */
  var real = null;
  Object.defineProperty(window, 'RufflePlayer', {
    configurable: true,
    get: function () { return real; },
    set: function (v) {
      try { v.config = Object.assign({}, v.config, { logLevel: 'trace' }); } catch (e) {}
      real = v;
    }
  });
})();`;

const KEY = (type, k) => ({ type, key: k, code: k, windowsVirtualKeyCode: { Enter: 13, Space: 32, ArrowRight: 39, ArrowLeft: 37 }[k] || 0, text: k.length === 1 ? k : undefined });

try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 3000);
  await sleep(10000);
  await b.click(632, 400);
  await sleep(4000);
  const spots = [[632, 400], [632, 300], [480, 350], [760, 450], [632, 600], [400, 450], [632, 200]];
  for (let i = 0; i < 90; i++) {
    const [x, y] = spots[i % spots.length];
    await b.click(x, y);
    if (i % 4 === 0) {
      const k = ['n', 'o', 'b', 'Enter', 'Space', 'ArrowRight'][(i / 4) % 6];
      const kd = KEY('keyDown', k), ku = KEY('keyUp', k);
      await b.send('Input.dispatchKeyEvent', kd);
      await b.send('Input.dispatchKeyEvent', ku);
    }
    await b.send('Page.captureScreenshot', { format: 'png' });
    await sleep(140);
  }
  const log = await b.raw('JSON.stringify(window.__log)');
  console.log('storage log: ' + log);
  console.log('stats: ' + JSON.stringify(await b.raw('PluStore.stats()')));
  console.log('document:\n' + String(await b.raw("localStorage.getItem('plu:text:learn-to-fly-3')")).slice(0, 400));
  const cons = b.events.console.filter((c) => /ruffle|plu|shared|profile|error/i.test(c.text)).slice(-40);
  console.log('console:\n' + cons.map((c) => c.type + ': ' + c.text.slice(0, 300)).join('\n'));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
