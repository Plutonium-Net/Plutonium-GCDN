/* Boot the page, then actually play it: find the request the guard refuses and
   watch what the runtime does about it. */
import { serve, browser, sleep } from './h.mjs';

const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin, hits } = await serve(ROOT, 8351);
const b = await browser({ port: 9338 });
const say = (s) => console.log(s);

const state = `(function(){
  var box = document.getElementById('plu-startup-error');
  return JSON.stringify({
    instance: typeof window.unityInstance,
    panel: box ? box.innerText.replace(/\\s+/g,' ').slice(0,200) : null
  });
})()`;

async function click(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  }
}

try {
  await b.goto(origin + '/games/funny-shooter-2/index.html', 2000);
  await sleep(14000);
  say('booted: ' + await b.raw(state));
  say('refused so far: ' + JSON.stringify(b.events.console.filter((c) => /refusing/.test(c.text)).map((c) => c.text.slice(0, 140))));

  /* Sweep the frame: a 6x4 grid of clicks, with a pause between passes. */
  const marks = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 12; i++) {
      const x = 320 + (i % 4) * 213;
      const y = 260 + Math.floor(i / 4) * 140;
      marks.push([x, y]);
      await click(x, y);
      await sleep(1200);
    }
    await sleep(2500);
    const refused = b.events.console.filter((c) => /refusing/.test(c.text));
    const aborts = b.events.exceptions.filter((e) => /abort/.test(String(e)));
    say('pass ' + (pass + 1) + ': refused=' + refused.length + ' aborts=' + aborts.length + ' ' + await b.raw(state));
    if (aborts.length) break;
  }

  say('\n=== refused requests');
  for (const c of b.events.console.filter((c) => /refusing/.test(c.text))) say('  ' + c.text.slice(0, 220));
  say('=== exceptions');
  for (const e of b.events.exceptions.slice(0, 3)) say('  ' + String(e).split('\n')[0].slice(0, 200));
  say('=== off-machine requests that did go out: ' +
    b.events.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:')).length);
  say('=== 404s: ' + JSON.stringify(hits.filter((h) => h.status === 404).map((h) => h.url).slice(0, 8)));
  say('=== console tail');
  for (const c of b.events.console.slice(-10)) say('  ' + c.type + ' ' + c.text.slice(0, 180));
} catch (e) {
  say('FAILED: ' + (e && e.stack || e));
} finally {
  await b.close();
  process.exit(0);
}
