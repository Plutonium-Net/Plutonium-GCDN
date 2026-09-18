/* Two visits in one profile: fresh boot, then the cached/hydrated boot. */
import { serve, browser, sleep } from './h.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin, hits } = await serve(ROOT, 8348);
const b = await browser({ port: 9336 });
const say = (s) => console.log(s);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
say('disk glue   sha ' + sha(ROOT + '/games/funny-shooter-2/FunnyShooter2_Yandex.framework.js'));

const probe = `(function(){
  var warn = document.getElementById('unity-warning');
  var cover = document.getElementById('loading-cover');
  var box = document.getElementById('plu-startup-error');
  return JSON.stringify({
    framework: typeof window.unityFramework,
    instance: typeof window.unityInstance,
    panel: box ? box.innerText.replace(/\\s+/g,' ').slice(0,120) : null,
    cover: cover ? cover.style.display : '?',
    stats: (function(){ try { return PluStore.stats(); } catch(e){ return 'no PluStore'; } })()
  });
})()`;

async function pass(label) {
  for (let i = 0; i < 20; i++) {
    await sleep(4000);
    const s = await b.raw(probe);
    say(label + ' ' + (4 * (i + 1)) + 's: ' + s);
    if (s && s.indexOf('"instance":"object"') >= 0) return true;
  }
  return false;
}

try {
  await b.goto(origin + '/games/funny-shooter-2/index.html', 1500);
  if (!(await pass('first '))) say('first pass: DID NOT BOOT');
  say('');
  b.events.console.length = 0; b.events.failed.length = 0; b.events.exceptions.length = 0; hits.length = 0;
  await b.goto(origin + '/games/funny-shooter-2/index.html', 1500);
  if (!(await pass('second'))) say('second pass: DID NOT BOOT');
  say('\nsecond-visit 404s: ' + JSON.stringify(hits.filter((h) => h.status === 404)));
  say('second-visit failed loads: ' + JSON.stringify(b.events.failed.slice(0, 6)));
  say('second-visit exceptions: ' + JSON.stringify(b.events.exceptions.slice(0, 4)));
} catch (e) {
  say('FAILED: ' + (e && e.stack || e));
} finally {
  await b.close();
  process.exit(0);
}
