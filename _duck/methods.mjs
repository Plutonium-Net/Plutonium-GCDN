/* Which parts of the Web Storage surface does Ruffle actually touch? (temporary) */
import { launch, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://localhost:5500/games/duck-life/index.html';
const { page, events, close } = await launch();

const init = `
(() => {
  const calls = [];
  window.__calls = calls;
  const rec = (what, args) => {
    calls.push(what + '(' + args.map(a => JSON.stringify(a)).join(',') + ')');
  };
  let real;
  Object.defineProperty(window, 'PluStore', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      real = v;
      const origInstall = v.installWebStorage.bind(v);
      v.installWebStorage = function () {
        const area = origInstall();
        const logged = new Proxy(area, {
          get(t, p) {
            if (typeof p === 'symbol') return t[p];
            let val;
            try { val = t[p]; } catch (e) { val = undefined; }
            if (typeof val === 'function') {
              return function (...a) { rec(String(p), a); return val.apply(t, a); };
            }
            if (p !== 'then') rec('get ' + String(p), []);
            return val;
          },
          set(t, p, val) { rec('set ' + String(p), [val]); t[p] = val; return true; },
          has(t, p) { if (typeof p !== 'symbol') rec('has ' + String(p), []); return p in t; }
        });
        Object.defineProperty(window, 'localStorage', { value: logged, configurable: true, enumerable: true });
        return logged;
      };
      Object.defineProperty(window, 'PluStore', { value: v, configurable: true, writable: true });
    }
  });
})();
`;

await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(28000);

/* Click the movie once to move past any intro, then look for more calls. */
const box = JSON.parse(await page.evaluate(`JSON.stringify((() => {
  const c = document.querySelector('ruffle-player');
  const r = c.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
})())`));
for (let i = 0; i < 3; i++) {
  await page.click(box.x, box.y);
  await sleep(2500);
}
await sleep(6000);

console.log('player box:', JSON.stringify(box));
console.log('calls:');
console.log(await page.evaluate(`JSON.stringify(window.__calls, null, 1)`));
console.log('doc:', await page.evaluate('PluStore.get()'));
console.log('stats:', await page.evaluate('JSON.stringify(PluStore.stats())'));
console.log('exceptions:', JSON.stringify(events.exceptions));
await close();
