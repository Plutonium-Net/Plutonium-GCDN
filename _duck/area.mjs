/* The area's key mapping, and whether anything reaches the browser's own
   localStorage besides the document. (temporary) */
import { launch, sleep } from './cdp.mjs';

const URL = 'http://127.0.0.1:8332/games/duck-life/index.html';
const NEUTRAL = 'http://127.0.0.1:8332/STORAGE.md';

const { page, events, close } = await launch();
await page.navigate(URL);
await page.waitFor('!!window.PluStore', 20000, 'PluStore');
await sleep(16000);

const report = {};
report.mapping = JSON.parse(await page.evaluate(`JSON.stringify((() => {
  const host = '127.0.0.1/games/duck-life/duck-life.swf/probe-object';
  localStorage.setItem(host, 'probe-value');
  const names = PluStore.list().map((f) => f.path);
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return {
    storedAs: names.filter((n) => n.indexOf('probe') >= 0),
    keyISpelling: keys.filter((k) => k.indexOf('probe') >= 0),
    objectKeys: Object.keys(localStorage),
    readBackThroughHostKey: localStorage.getItem(host),
    readBackThroughProperty: localStorage[host],
    hasHostKey: host in localStorage,
    length: localStorage.length,
    otherHostSpelling: localStorage.getItem('localhost/games/duck-life/duck-life.swf/probe-object'),
    otherHostSpellingStored: PluStore.list().map((f) => f.path).filter((n) => n.indexOf('probe') >= 0)
  };
})())`));
report.listing = await page.evaluate(`JSON.stringify(PluStore.list())`);
report.indexedDb = await page.evaluate(`(async () => JSON.stringify(await indexedDB.databases()))()`);

/* Clean the probe key out, then look at the browser's own store from a page that
   is not running the game: only the document should be there. */
await page.evaluate(`localStorage.removeItem('127.0.0.1/games/duck-life/duck-life.swf/probe-object')`);
await page.navigate(NEUTRAL);
report.browserStore = await page.evaluate(`JSON.stringify((() => {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i) + ' (' + localStorage.getItem(localStorage.key(i)).length + ' chars)');
  return out;
})())`);

report.exceptions = events.exceptions;
console.log(JSON.stringify(report, null, 1));
await close();
