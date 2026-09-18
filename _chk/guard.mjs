/* Does a blocked request now come back as an empty success, and does the game
   live through the two telemetry requests it makes at startup? */
import { serve, browser, sleep } from './h.mjs';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin, hits } = await serve(ROOT, 8352);
const b = await browser({ port: 9339 });
const say = (s) => console.log(s);

try {
  await b.goto(origin + '/games/funny-shooter-2/index.html', 2000);
  for (let i = 0; i < 5; i++) {
    await sleep(5000);
    say((5 * (i + 1)) + 's: ' + await b.raw(`(function(){
      var box = document.getElementById('plu-startup-error');
      return JSON.stringify({
        instance: typeof window.unityInstance,
        panel: box ? box.innerText.replace(/\\s+/g,' ').slice(0,160) : null,
        refused: window.pluRefused,
        stats: (function(){ try { return PluStore.stats(); } catch(e){ return String(e); } })()
      });
    })()`));
    if (i === 3) {
      /* Also prove the guard still *answers* a blocked request on demand. */
      say('direct probe: ' + await b.raw(`(async function(){
        var r = await fetch('https://example.com/nothing.json');
        return JSON.stringify({ status: r.status, length: (await r.text()).length });
      })()`));
    }
  }

  say('\n=== refusals logged');
  for (const c of b.events.console.filter((c) => /refusing/.test(c.text))) say('  ' + c.text.slice(0, 200));
  say('=== off-machine requests: ' +
    b.events.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:')).length);
  say('=== exceptions: ' + b.events.exceptions.length);
  for (const e of b.events.exceptions.slice(0, 3)) say('  ' + String(e).split('\n')[0].slice(0, 180));
  say('=== failed loads: ' + JSON.stringify(b.events.failed.slice(0, 4).map((f) => f.error)));
  say('=== 404s: ' + JSON.stringify(hits.filter((h) => h.status === 404).map((h) => h.url).slice(0, 6)));
} catch (e) {
  say('FAILED: ' + (e && e.stack || e));
} finally {
  await b.close();
  process.exit(0);
}
