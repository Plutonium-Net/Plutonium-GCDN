import { serve, browser, sleep } from './h.mjs';
import { decodePng, ascii, nonBlack } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8393);
const b = await browser({ port: 9383, headful: true });
const say = (s) => console.log(s);
async function shot() {
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  return decodePng(Buffer.from(r.data, 'base64'));
}
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.open = function () { return null; };" });
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 2000);
  for (let i = 1; i <= 6; i++) {
    await sleep(15000);
    const p = await shot();
    say((15 * i) + 's: fileWrites=' + await b.raw('PluStore.stats().fileWrites') + '  non-black=' + (nonBlack(p) * 100).toFixed(1) + '%');
  }
  const p = await shot();
  say('=== screen at ~90s');
  say(ascii(p, 96, 30));
} catch (e) { say('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
