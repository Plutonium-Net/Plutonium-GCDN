import { serve, browser, sleep } from './h.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8397);
const b = await browser({ port: 9387 });
const say = (s) => console.log(s);
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  await sleep(12000);
  await b.click(632, 400);   // dismiss Ruffle's play button
  await sleep(20000);
  say('--- full console ---');
  for (const c of b.events.console) say('[' + c.type + '] ' + String(c.text));
  say('--- exceptions ---');
  for (const e of b.events.exceptions) say(String(e));
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
