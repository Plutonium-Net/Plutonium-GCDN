import { launch } from './h.mjs';
import { writeFileSync } from 'node:fs';
import { ascii, palette } from './png.mjs';

const b = await launch({ headful: process.argv.includes('--headful') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  await b.goto('/games/soccer-random/index.html');
  await sleep(12000);
  console.log(await b.evaluate(`JSON.stringify((() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { rect: [r.x|0, r.y|0, r.width|0, r.height|0], css: c.style.cssText,
      attr: [c.width, c.height], bodyText: document.body.innerText.slice(0, 300),
      top: (document.elementFromPoint(innerWidth/2, innerHeight/2) || {}).tagName };
  })())`));
  const r = JSON.parse(await b.evaluate(`JSON.stringify((() => {
    const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
    return [r.x|0, r.y|0, r.width|0, r.height|0];
  })())`));
  const shot = await b.send('Page.captureScreenshot', {
    format: 'png', clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 },
  });
  writeFileSync('_sr/canvas.png', Buffer.from(shot.data, 'base64'));
  console.log(palette('_sr/canvas.png').join('  '));
  console.log(ascii('_sr/canvas.png', 96, 40));
} finally {
  await b.close();
}
