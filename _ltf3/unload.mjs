import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8400);
const b = await browser({ port: 9390 });
const say = (s) => console.log(s);
const doc = async () => b.raw("(function(){try{return localStorage.getItem('plu:text:learn-to-fly-3')||'none'}catch(e){return 'x'}})()");
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(12000);
  await b.click(632, 400);
  await sleep(3000);
  const spots = [[632, 400], [632, 300], [480, 350], [760, 450], [632, 600], [400, 450]];
  for (let i = 0; i < 120; i++) {
    const [x, y] = spots[i % spots.length];
    await b.click(x, y);
    await b.send('Page.captureScreenshot', { format: 'png' });
    await sleep(150);
  }
  say('fileWrites before leaving: ' + await b.raw('PluStore.stats().fileWrites'));
  await b.goto(origin + '/_ltf3/blank.html', 2000);
  say('doc after leaving: ' + (await doc()).slice(0, 200));
  say('fileWrites after: (page gone)');
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
