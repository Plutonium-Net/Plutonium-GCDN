/* Run the freshly-localised page and list every request it makes, so the assets
   it still needs (which 404 locally) name themselves. */
import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin, hits } = await serve(ROOT, 8410);
const b = await browser({ port: 9400 });

try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/motox3m/index.html', 2000);
  await sleep(25000);

  console.log('=== stats: ' + await b.raw('JSON.stringify(window.PluStore ? PluStore.stats() : null)'));
  console.log('=== localStorage is ours: ' + await b.raw("String(window.localStorage && typeof window.localStorage.getItem === 'function')"));

  const missing = hits.filter((h) => h.status === 404).map((h) => h.url);
  console.log('=== 404s (' + missing.length + '):');
  for (const m of [...new Set(missing)].sort()) console.log('  ' + m);

  console.log('=== all requests (' + hits.length + '):');
  for (const h of hits) console.log('  ' + h.status + ' ' + h.url);

  console.log('=== console:');
  for (const c of b.events.console) console.log('  [' + c.type + '] ' + String(c.text).slice(0, 240));
  console.log('=== exceptions: ' + JSON.stringify(b.events.exceptions.slice(0, 6), null, 1));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
