import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8391);
const b = await browser({ port: 9381 });
const say = (s) => console.log(s);
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  for (let i = 0; i < 12; i++) {
    await sleep(20000);
    await b.send('Page.captureScreenshot', { format: 'png' });
    say((20 * (i + 1)) + 's: ' + await b.raw("JSON.stringify({w:(function(){try{return PluStore.stats().fileWrites}catch(e){return 'x'}})(), doc:(function(){try{return localStorage.getItem('plu:text:learn-to-fly-3')?'yes':'no'}catch(e){return 'x'}})()})"));
  }
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
