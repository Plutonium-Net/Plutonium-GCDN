/*
 * load-test.mjs — is the Fancade player handed its database at boot?
 *
 * The shell hydrates the wasm in Storage.sync(), which walks localStorage.key(i)
 * and skips every key that does not start with Storage.PREFIX. This reports what
 * the shell would see, then plays, saves, and boots again to see whether the game
 * loads what it saved.
 */
import { launch, sleep } from './cdp.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8332/games/drive-mad/index.html';
const report = {};
const { page, events, close } = await launch();

const probe = () => page.evaluate(`JSON.stringify((() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  const passing = keys.filter((k) => k.startsWith(Storage.PREFIX));
  return {
    appInited: (() => { try { return Module._get_app_inited(); } catch (e) { return 'n/a'; } })(),
    prefix: Storage.PREFIX,
    areaKeys: keys,
    keysTheShellWouldUse: passing,
    decoded: passing.map((k) => {
      const d = Storage.get(Storage.PREFIX, k.slice(Storage.PREFIX.length));
      return { key: k, bytes: d ? d.length : null };
    }),
    docBytes: PluStore.get().length,
    docBlocks: PluStore.parse(PluStore.get()).files.map((f) => f.kind + ' ' + f.path),
    stats: PluStore.stats()
  };
})())`);

const boot = async (label) => {
  events.console.length = 0;
  await page.navigate(url);
  await page.waitFor(`(() => { try { return Module._get_app_inited() === 1; } catch (e) { return false; } })()`, 60000, 'app_init');
  await sleep(3000);
  report[label] = JSON.parse(await probe());
  report[label].console = events.console.map((c) => c.type + ': ' + c.text).slice(-24);
  report[label].exceptions = events.exceptions.slice(0, 4);
};

try {
  await boot('firstBoot');
  report.firstBoot.sawLoadFailure = events.console.some((c) => /Failed to load|failed to load|progress data/i.test(c.text));

  /* play, so the game writes a save of its own */
  const geo = JSON.parse(await page.evaluate(`JSON.stringify((() => { const r = document.getElementById('canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height }; })())`));
  await page.click(geo.left + geo.w / 2, geo.top + geo.h / 2);
  await sleep(1500);
  await page.mouse('mousePressed', geo.left + geo.w * 0.82, geo.top + geo.h * 0.86);
  await sleep(5000);
  await page.mouse('mouseReleased', geo.left + geo.w * 0.82, geo.top + geo.h * 0.86, { buttons: 0 });
  await sleep(2500);
  report.afterPlay = JSON.parse(await probe());

  await boot('secondBoot');
  report.secondBoot.sawLoadFailure = events.console.some((c) => /Failed to load|failed to load|progress data/i.test(c.text));
  report.secondBoot.messages = events.console.filter((c) => /load|progress|database|Migrat/i.test(c.text)).map((c) => c.text);
} finally {
  console.log(JSON.stringify(report, null, 2));
  await close();
}
