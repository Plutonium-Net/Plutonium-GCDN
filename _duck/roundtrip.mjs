/* Does a save sitting in the document actually reach the game? (temporary)

   The document is seeded from a page that is not running the game: a live
   player flushes its own in-memory SharedObject when the page goes away, which
   overwrites anything written while it was up. */
import { launch, sleep } from './cdp.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:8332/games/duck-life/index.html';
const NEUTRAL = 'http://127.0.0.1:8332/STORAGE.md';   // same origin, runs nothing
const DOC_KEY = 'plu:text:duck-life';

/* Wrap the installed area at install time: Ruffle reaches the area through its
   property surface (`localStorage[name]`), not getItem/setItem. */
const init = `
(() => {
  const calls = []; window.__calls = calls;
  window.__lastRead = undefined;
  Object.defineProperty(window, 'PluStore', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      const orig = v.installSharedObjects.bind(v);
      v.installSharedObjects = function (...a) {
        const area = orig(...a);
        const note = (what, name, value) => {
          if (/mydata$/.test(String(name))) {
            if (what === 'read') window.__lastRead = value === undefined ? null : String(value);
          }
          calls.push(what + ' ' + String(name).slice(-24) + ' :: ' + (value === undefined ? '(absent)' : String(value).slice(0, 16)));
        };
        const wrapped = new Proxy(area, {
          get(t, p) {
            if (typeof p === 'symbol') return t[p];
            const val = t[p];
            if (typeof val !== 'function') { note('read', p, val); return val; }
            return function (...args) {
              const out = val.apply(t, args);
              if (p === 'getItem' || p === 'setItem') note(p === 'getItem' ? 'read' : 'write', args[0], p === 'getItem' ? out : args[1]);
              return out;
            };
          },
          set(t, p, val) { note('write', p, val); t[p] = val; return true; }
        });
        Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true, enumerable: true });
        return wrapped;
      };
      Object.defineProperty(window, 'PluStore', { value: v, configurable: true, writable: true });
    }
  });
})();
`;

function fieldOffset(soap, name) {
  const at = soap.indexOf(Buffer.from(name, 'latin1'));
  if (at < 0) return null;
  if (soap.readUInt16BE(at - 2) !== name.length) throw new Error('bad name length for ' + name);
  return { type: at + name.length, value: at + name.length + 1 };
}

const { page, events, close } = await launch();
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });

const report = {};
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(20000);
report.phaseA = {
  firstCall: (JSON.parse(await page.evaluate('JSON.stringify(window.__calls)'))[0] || ''),
  writes: JSON.parse(await page.evaluate('JSON.stringify(window.__calls)')).length,
  doc: await page.evaluate('PluStore.get()')
};

const m = /^@file (.*)\n([A-Za-z0-9+/=]+)\n@end$/m.exec(report.phaseA.doc);
if (!m) throw new Error('no @file block');
const soap = Buffer.from(m[2], 'base64');
const money = fieldOffset(soap, 'money');
const seed = fieldOffset(soap, 'seed');
report.fields = {
  key: m[1], bytes: soap.length,
  moneyHex: soap.subarray(money.value, money.value + 8).toString('hex'),
  seedHex: soap.subarray(seed.value, seed.value + 8).toString('hex')
};

/* money -> 4321 and seed -> 32000, so a loaded save is distinguishable from one
   the game wrote itself. */
const doctored = Buffer.from(soap);
doctored.writeDoubleBE(4321.0, money.value);
doctored.writeDoubleBE(32000.0, seed.value);
const doctoredDoc = report.phaseA.doc.replace(m[2], doctored.toString('base64'));
report.doctored = { moneyHex: '40b0e10000000000', seedHex: '40df95c000000000' };

/* Seed the document from a page that is not running the game. */
await page.navigate(NEUTRAL);
await page.evaluate(`localStorage.setItem(${JSON.stringify(DOC_KEY)}, ${JSON.stringify(doctoredDoc)})`);
report.seeded = await page.evaluate(`localStorage.getItem(${JSON.stringify(DOC_KEY)}).indexOf('40b0e1') < 0 && localStorage.getItem(${JSON.stringify(DOC_KEY)}).length`);

/* Now load the game on top of it. */
await page.navigate(URL);
await page.waitFor('!!window.RufflePlayer', 30000, 'RufflePlayer');
await sleep(24000);
report.phaseB = {
  handedTheSeededSave: await page.evaluate(`window.__lastRead === ${JSON.stringify(doctored.toString('base64'))}`),
  handedHead: await page.evaluate('window.__lastRead ? window.__lastRead.slice(100, 160) : null'),
  expectedHead: doctored.toString('base64').slice(100, 160),
  writes: JSON.parse(await page.evaluate('JSON.stringify(window.__calls)')).slice(0, 3),
  doc: await page.evaluate('PluStore.get()')
};
report.phaseBDocFields = (() => {
  const mm = /^@file (.*)\n([A-Za-z0-9+/=]+)\n@end$/m.exec(report.phaseB.doc) || [null, null, ''];
  const b = Buffer.from(mm[2] || '', 'base64');
  if (!b.length) return null;
  return {
    moneyHex: b.subarray(fieldOffset(b, 'money').value, fieldOffset(b, 'money').value + 8).toString('hex'),
    seedHex: b.subarray(fieldOffset(b, 'seed').value, fieldOffset(b, 'seed').value + 8).toString('hex')
  };
})();
report.exceptions = events.exceptions;
report.remoteRequests = events.requests.filter((u) => !u.startsWith('http://127.0.0.1:8332'));

console.log(JSON.stringify(report, null, 1));
await close();
