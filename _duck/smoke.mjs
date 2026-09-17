/* Every other consumer of js/plustore.js, booted once, to be sure the area
   change did not disturb them. (temporary) */
import { launch, sleep } from './cdp.mjs';

const GAMES = [
  ['cookie-clicker', 25000],
  ['core-ball', 15000],
  ['bacon-may-die', 20000],
  ['drive-mad', 25000],
  ['snow-rider-3d', 30000]
];
const BASE = 'http://127.0.0.1:8332/games/';
const out = [];

for (const [game, wait] of GAMES) {
  const { page, events, close } = await launch({ port: 9400 + out.length });
  const row = { game };
  try {
    await page.navigate(BASE + game + '/index.html');
    await sleep(wait);
    row.state = JSON.parse(await page.evaluate(`JSON.stringify({
      docLen: (typeof PluStore !== 'undefined' && PluStore.get) ? PluStore.get().length : null,
      files: (typeof PluStore !== 'undefined' && PluStore.list) ? PluStore.list().map((f) => f.path).slice(0, 8) : null,
      stats: (typeof PluStore !== 'undefined' && PluStore.stats) ? PluStore.stats() : null,
      browserKeys: (() => { try { const o = []; for (let i = 0; i < localStorage.length; i++) o.push(localStorage.key(i)); return o; } catch (e) { return 'threw'; } })(),
      idb: 'pending'
    })`));
    row.state.idb = await page.evaluate(`(async () => { try { return JSON.stringify((await indexedDB.databases()).map((d) => d.name)); } catch (e) { return 'threw'; } })()`);
  } catch (e) {
    row.error = String(e.message).slice(0, 200);
  }
  row.exceptions = events.exceptions.map((x) => x.slice(0, 160));
  row.consoleErrors = events.console.filter((c) => c.type === 'error').map((c) => c.text.slice(0, 160));
  row.remote = events.requests.filter((u) => !u.startsWith('http://127.0.0.1:8332') && !u.startsWith('data:'));
  out.push(row);
  await close();
}

console.log(JSON.stringify(out, null, 1));
