import { serve, browser, sleep } from './h.mjs';
import { decodePng, ascii, nonBlack } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8392);
const b = await browser({ port: 9382 });
const say = (s) => console.log(s);
async function shot() {
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  return decodePng(Buffer.from(r.data, 'base64'));
}
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  for (const t of [25, 55, 90]) {
    await sleep(t === 25 ? 25000 : 30000);
    const p = await shot();
    say('=== at ~' + t + 's, non-black ' + (nonBlack(p) * 100).toFixed(1) + '%');
    say(ascii(p));
  }
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
