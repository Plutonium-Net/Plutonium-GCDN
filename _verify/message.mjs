/*
 * message.mjs — what the game shows, and what the shell hands it.
 *
 * Records the paths Storage.sync() would push into the wasm, whether the wasm
 * export is called for each, and any visible text about loading progress.
 */
import { launch, sleep } from './cdp.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8332/games/drive-mad/index.html';
const report = {};
const { page, events, close } = await launch();
try {
  await page.navigate(url);
  await page.waitFor(`(() => { try { return Module._get_app_inited() === 1; } catch (e) { return false; } })()`, 60000, 'app_init');
  await sleep(3000);

  report.afterBoot = JSON.parse(await page.evaluate(`JSON.stringify((() => {
    /* What Storage.sync() would push, by the shell's own rule. */
    const paths = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(Storage.PREFIX)) paths.push(k.slice(Storage.PREFIX.length));
    }
    /* Does sync actually reach the wasm export? Count the calls it makes. */
    const realSync = Storage.sync;
    let pushed = 0, seen = [];
    const realWrite = Module.writeArrayToMemory;
    if (realWrite) {
      Module.writeArrayToMemory = function (arr, ptr) { pushed++; seen.push(Array.from(arr).length); return realWrite.apply(Module, arguments); };
    }
    try { Storage.sync(); } finally { if (realWrite) Module.writeArrayToMemory = realWrite; }
    /* Anything on screen about progress, and the shell's own messages. */
    const text = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400);
    const all = Array.from(document.querySelectorAll('*')).map((e) => (e.children.length ? '' : (e.textContent || ''))).join(' | ');
    return {
      shellWouldPush: paths,
      syncCalledTheWasm: pushed,
      syncPushedSizes: seen,
      visible: /Failed to load|progress data|load saved/i.test(all),
      matchesOnScreen: (all.match(/[^|]*(Failed to load|progress data|load saved)[^|]*/gi) || []).slice(0, 5),
      bodyText: text
    };
  })())`));
  report.secondBoot = null;
  console.log(JSON.stringify(report, null, 2));
} finally {
  console.log('--- console tail');
  console.log(JSON.stringify(events.console.slice(-8).map((c) => c.type + ': ' + c.text), null, 1));
  await close();
}
