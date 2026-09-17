/* Each game's page: does the area it installed (if any) and its files layer
   both reach the stored document? (temporary) */
import { launch, sleep } from './cdp.mjs';

const GAMES = ['cookie-clicker', 'core-ball', 'bacon-may-die', 'drive-mad', 'duck-life'];
const out = [];

for (const game of GAMES) {
  const { page, events, close } = await launch({ port: 9500 + out.length });
  const row = { game };
  try {
    await page.navigate('http://127.0.0.1:8332/games/' + game + '/index.html');
    await sleep(game === 'drive-mad' ? 20000 : 14000);
    row.probe = JSON.parse(await page.evaluate(`JSON.stringify((() => {
      const hostStorage = Object.getPrototypeOf(localStorage).constructor.name === 'Object';
      const docBefore = PluStore.get();
      localStorage.setItem('smoke-probe', 'via-area');
      const docAfterArea = PluStore.get();
      PluStore.files.write('smoke-file', 'via-files');
      const docAfterFiles = PluStore.get();
      const viaMethod = localStorage.getItem('smoke-probe');
      const viaProperty = localStorage['smoke-probe'];
      localStorage.removeItem('smoke-probe');
      PluStore.files.remove('smoke-file');
      const docAfterCleanup = PluStore.get();
      return {
        areaIsOurs: hostStorage,
        areaWriteReachedDocument: docAfterArea.indexOf('via-area') >= 0,
        filesWriteReachedDocument: docAfterFiles.indexOf('via-files') >= 0,
        viaMethod, viaProperty,
        cleanupLeftNothing: docAfterCleanup.indexOf('smoke-') < 0,
        docLenBefore: docBefore.length,
        keys: PluStore.list().map((f) => f.path)
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
