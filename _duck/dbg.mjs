/* Why is the wrapper not seeing Ruffle's calls? (temporary) */
import { launch, sleep } from './cdp.mjs';

const init = `
(() => {
  const calls = []; window.__calls = calls;
  window.__hooked = 'no';
  Object.defineProperty(window, 'PluStore', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      window.__hooked = 'setter';
      const orig = v.installSharedObjects.bind(v);
      v.installSharedObjects = function (...a) {
        window.__hooked = 'wrapped';
        const area = orig(...a);
        const wrapped = new Proxy(area, {
          get(t, p) {
            if (typeof p === 'symbol') return t[p];
            const val = t[p];
            if (typeof val !== 'function') return val;
            return function (...args) {
              const out = val.apply(t, args);
              if (p === 'getItem' || p === 'setItem') calls.push(p + ' ' + String(args[0]).slice(-30));
              return out;
            };
          },
          set(t, p, val) { t[p] = val; return true; }
        });
        window.__wrapped = wrapped;
        Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true, enumerable: true });
        return wrapped;
      };
      Object.defineProperty(window, 'PluStore', { value: v, configurable: true, writable: true });
    }
  });
})();
`;

const { page, events, close } = await launch();
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
await page.navigate('http://127.0.0.1:8332/games/duck-life/index.html');
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(12000);
console.log(await page.evaluate(`JSON.stringify({
  hooked: window.__hooked,
  hasWrapped: !!window.__wrapped,
  same: window.localStorage === window.__wrapped,
  descriptor: (() => { const d = Object.getOwnPropertyDescriptor(window, 'localStorage'); return { configurable: d.configurable, hasValue: 'value' in d, isWrapped: d.value === window.__wrapped }; })(),
  callsBefore: window.__calls.length,
  manual: (() => { localStorage.setItem('probe-key', '1'); return window.__calls.slice(-2); })(),
  docKeys: PluStore.list().map(f => f.path)
}, null, 1)`));
console.log('exceptions:', JSON.stringify(events.exceptions));
await close();
