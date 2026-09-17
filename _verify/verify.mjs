/*
 * verify.mjs — the Fancade hydration check.
 *
 * Storage.init() calls Storage.sync(), and sync() is the only place the browser's
 * stored files reach the wasm: it walks localStorage.key(i), skips every key that
 * does not start with Storage.PREFIX, and calls the engine's _storage_write for
 * the rest. Record what the real boot does, then play, save, reboot and repeat.
 */
import { launch, sleep } from './cdp.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8332/games/drive-mad/index.html';

/* Wrap sync() before the wasm calls it, by polling: the shell assigns its own
   Storage object at load time, and the player calls init() well after that. */
const INIT = `(() => {
  window.__sync = [];
  var timer = setInterval(function () {
    var S = window.Storage;
    if (!S || typeof S.sync !== 'function' || S.__wrapped) return;
    S.__wrapped = true;
    clearInterval(timer);
    var orig = S.sync;
    S.sync = function () {
      var paths = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(S.PREFIX) === 0) paths.push(k.slice(S.PREFIX.length));
      }
      /* _storage_write is the glue's global binding for the wasm export, so this
         sees exactly what the engine is handed. */
      var realWrite = window._storage_write;
      var sizes = [];
      if (typeof realWrite === 'function') {
        window._storage_write = function (p, d, n) { sizes.push(n); return realWrite.apply(this, arguments); };
      }
      var r = orig.apply(this, arguments);
      if (typeof realWrite === 'function') window._storage_write = realWrite;
      window.__sync.push({ paths: paths, pushed: sizes.length, sizes: sizes });
      return r;
    };
  }, 0);
})();`;

const report = {};
const { page, events, close } = await launch();
const boot = async (label) => {
  events.console.length = 0;
  events.exceptions.length = 0;
  await page.navigate(url);
  let ok = true;
  try {
    await page.waitFor(`(() => { try { return Module._get_app_inited() === 1; } catch (e) { return false; } })()`, 90000, 'app_init');
  } catch (e) { ok = false; report[label + 'Error'] = String(e.message); }
  await sleep(2500);
  report[label] = JSON.parse(await page.evaluate(`JSON.stringify((() => ({
    booted: !!window.__sync,
    hydrationDuringBoot: window.__sync || null,
    globals: { storageWrite: typeof _storage_write, moduleStorageWrite: typeof Module._storage_write, writeArrayToMemory: typeof Module.writeArrayToMemory },
    areaKeys: (() => { const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; })(),
    docBytes: PluStore.get().length,
    appInited: (() => { try { return Module._get_app_inited(); } catch (e) { return 'n/a'; } })()
  }))())`));
  report[label].appInitedOk = ok;
  report[label].console = events.console.map((c) => c.type + ': ' + c.text).slice(-12);
  report[label].exceptions = events.exceptions.slice(0, 4);

  /* Count what a sync pushes, by watching the engine entry point the glue exposes. */
  report[label].manualSync = JSON.parse(await page.evaluate(`JSON.stringify((() => {
    const paths = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(Storage.PREFIX)) paths.push(k.slice(Storage.PREFIX.length));
    }
    let calls = 0, sizes = [];
    const real = window.Module._storage_write;
    try {
      window.Module._storage_write = function (p, d, n) { calls++; sizes.push(n); return real.apply(this, arguments); };
      Storage.sync();
    } catch (e) {
      return { paths: paths, error: String(e.message) };
    } finally {
      window.Module._storage_write = real;
    }
    return { paths: paths, pushes: calls, sizes: sizes };
  })())`));
};

try {
  await page.addInitScript(INIT);
  await boot('firstBoot');

  const geo = JSON.parse(await page.evaluate(`JSON.stringify((() => { const r = document.getElementById('canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height }; })())`));
  await page.click(geo.left + geo.w / 2, geo.top + geo.h / 2);
  await sleep(1500);
  await page.mouse('mousePressed', geo.left + geo.w * 0.82, geo.top + geo.h * 0.86);
  await sleep(5000);
  await page.mouse('mouseReleased', geo.left + geo.w * 0.82, geo.top + geo.h * 0.86, { buttons: 0 });
  await sleep(2500);
  report.afterPlay = JSON.parse(await page.evaluate(`JSON.stringify({
    docBlocks: PluStore.parse(PluStore.get()).files.map((f) => f.kind + ' ' + f.path + ' (' + (f.text || '').length + ')'),
    docBytes: PluStore.get().length
  })`));

  await boot('secondBoot');
} finally {
  console.log(JSON.stringify(report, null, 2));
  await close();
}
