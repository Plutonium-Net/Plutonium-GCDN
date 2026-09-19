import { serve, browser, sleep } from './h.mjs';
import { decodePng, ascii } from './png.mjs';
const ROOT = 'C:/Users/its_c/Main/GitHub/Plutonium-GCDN';
const { origin } = await serve(ROOT, 8408);
const b = await browser({ port: 9398 });
try {
  await b.goto(origin + '/games/learn-to-fly-3/index.html', 3000);
  await sleep(12000);
  await b.click(632, 400);
  await sleep(9000);
  const png = decodePng(Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('page ' + png.width + 'x' + png.height);
  console.log(ascii(png, 150, 44));
} catch (e) { console.log('FAILED: ' + (e && e.stack || e)); } finally { await b.close(); process.exit(0); }
