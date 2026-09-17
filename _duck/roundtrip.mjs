/* Does the stored SharedObject actually reach the game? (temporary) */
import { launch, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:8332/games/duck-life/index.html';

/* Wrap the installed area at install time, and log every way into it — Ruffle
   turns out to use the property surface, not getItem/setItem. */
const init = `
(() => {
  const calls = []; window.__calls = calls;
  const note = (what, name, value) => {
    let shown;
    if (value === undefined) shown = '(absent)';
    else {
      const s = String(value);
      shown = s.length > 60 ? s.slice(0, 20) + '…' + s.slice(-40) : s;
    }
    calls.push(what + ' ' + String(name).slice(-28) + ' :: ' + shown);
  };
  Object.defineProperty(window, 'PluStore', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      const orig = v.installSharedObjects.bind(v);
      v.installSharedObjects = function (...a) {
        const area = orig(...a);
        const wrapped = new Proxy(area, {
          get(t, p) {
            if (typeof p === 'symbol') return t[p];
            const val = t[p];
            if (typeof val !== 'function') { note('read', p, val); return val; }
            return function (...args) {
              const out = val.apply(t, args);
              if (p === 'getItem' || p === 'setItem') note(p, args[0], p === 'getItem' ? out : args[1]);
              return out;
            };
          },
          set(t, p, val) { note('write', p, val); t[p] = val; return true; },
          has(t, p) { const r = p in t; note('has', p, r); return r; }
        });
        Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true, enumerable: true });
        return wrapped;
      };
      Object.defineProperty(window, 'PluStore', { value: v, configurable: true, writable: true });
    }
  });
})();
`;

/* Offset of an AMF0-property-table name: 2-byte length, name, one type byte,
   then the payload. */
function fieldOffset(soap, name) {
  const at = soap.indexOf(Buffer.from(name, 'latin1'));
  if (at < 0) return null;
  const declared = soap.readUInt16BE(at - 2);
  if (declared !== name.length) throw new Error('bad name length for ' + name + ': ' + declared);
  return { name: at, type: at + name.length, value: at + name.length + 1 };
}

const { page, events, close } = await launch();
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });

const report = {};
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(24000);
report.phaseA = {
  calls: await page.evaluate('JSON.stringify(window.__calls)'),
  doc: await page.evaluate('PluStore.get()')
};

const m = /^@file (.*)\n([A-Za-z0-9+/=]+)\n@end$/m.exec(report.phaseA.doc);
if (!m) throw new Error('no @file block');
const key = m[1];
const soap = Buffer.from(m[2], 'base64');
const money = fieldOffset(soap, 'money');
const seed = fieldOffset(soap, 'seed');
report.fields = {
  key, bytes: soap.length, money, seed,
  moneyHex: soap.subarray(money.value, money.value + 8).toString('hex'),
  seedHex: soap.subarray(seed.value, seed.value + 8).toString('hex')
};

/* A correct edit this time: money -> 4321, and the seed -> 0x7E57 so a value the
   game loaded can be told apart from one it wrote fresh. */
const doctored = Buffer.from(soap);
doctored.writeDoubleBE(4321.0, money.value);
doctored.writeDoubleBE(0x7e57, seed.value);
report.doctored = {
  moneyHex: doctored.subarray(money.value, money.value + 8).toString('hex'),
  seedHex: doctored.subarray(seed.value, seed.value + 8).toString('hex')
};
await page.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(doctored.toString('base64'))})`);
report.storedBack = await page.evaluate('PluStore.get()');

/* Reload: the document holds the doctored save, a fresh page loads it. */
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(26000);
report.phaseB = {
  calls: await page.evaluate('JSON.stringify(window.__calls)'),
  doc: await page.evaluate('PluStore.get()')
};
report.phaseBHanded = (() => {
  const mm = /^@file (.*)\n([A-Za-z0-9+/=]+)\n@end$/m.exec(report.phaseB.doc) || [];
  const b = mm[2] ? Buffer.from(mm[2], 'base64') : Buffer.alloc(0);
  const mo = b.length ? fieldOffset(b, 'money') : null;
  const se = b.length ? fieldOffset(b, 'seed') : null;
  return {
    moneyHex: mo ? b.subarray(mo.value, mo.value + 8).toString('hex') : null,
    seedHex: se ? b.subarray(se.value, se.value + 8).toString('hex') : null
  };
})();
report.exceptions = events.exceptions;
report.requests = events.requests.filter((u) => !u.startsWith('http://127.0.0.1:8332/games/duck-life'));

console.log(JSON.stringify(report, null, 1));
await close();
