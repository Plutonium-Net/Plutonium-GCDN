/* Each game's page, with one write through its installed area. (temporary) */
import { launch, sleep } from './cdp.mjs';

const GAMES = ['cookie-clicker', 'core-ball', 'bacon-may-die', 'drive-mad', 'duck-life'];
const out = [];

for (const game of GAMES) {
  const { page, events, close } = await launch({ port: 9500 + out.length });
  const row = { game };
  try {
    await page.navigate('http://127.0.0.1:8332/games/' + game + '/index.html');
    await sleep(game === 'drive-mad' ? 20000 : 14000);
    row.area = JSON.parse(await page.evaluate(`JSON.stringify((() => {
      localStorage.setItem('smoke-probe', 'ok-' + ${JSON.stringify(game)});
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      const stored = PluStore.list().map((f) => f.path).filter((p) => p.indexOf('smoke-probe') >= 0);
      const viaMethod = localStorage.getItem('smoke-probe');
      const viaProperty = localStorage['smoke-probe'];
      localStorage.removeItem('smoke-probe');
      return {
        storedAs: stored, viaMethod, viaProperty,
        enumerated: keys.filter((k) => k.indexOf('smoke-probe') >= 0).length,
        goneAfterRemove: localStorage.getItem('smoke-probe'),
        stats: PluStore.stats()
      };
    })())`));
  } catch (e) {
    row.error = String(e.message).slice(0, 160);
  }
  row.exceptions = events.exceptions.map((x) => x.slice(0, 120));
  out.push(row);
  await close();
}

console.log(JSON.stringify(out, null, 1));
