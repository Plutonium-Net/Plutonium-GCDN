import { launch } from './h.mjs';
import { writeFileSync } from 'node:fs';
import { decode, palette } from './png.mjs';

const b = await launch({ headful: process.argv.includes('--headful') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sig(tag) {
  const s = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`_sr/${tag}.png`, Buffer.from(s.data, 'base64'));
  const { w, h, bpp, px } = decode(`_sr/${tag}.png`);
  let n = 0;
  for (let i = 0; i < px.length; i += bpp) if (px[i] + px[i + 1] + px[i + 2] > 90) n++;
  console.log('%s lit=%d  %s', tag, n, palette(`_sr/${tag}.png`).slice(0, 3).join(' '));
  return n;
}

async function click(x, y) {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await sleep(60);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(80);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

try {
  await b.goto('/games/soccer-random/index.html');
  await sleep(14000);
  await sig('p0');
  // the intro glyphs sit near 630,310 in CSS pixels; try the middle and a few targets
  for (const [tag, x, y] of [['p1', 632, 310], ['p2', 500, 400], ['p3', 632, 200], ['p4', 900, 400]]) {
    await click(x, y);
    await sleep(2500);
    await sig(tag);
  }
  // keyboard: this build has a Keyboard plugin and a mouse/touch one
  for (const k of ['Space', 'ArrowRight', 'Enter']) {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: 32 });
    await sleep(100);
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: 32 });
    await sleep(1500);
  }
  await sig('p5');
  console.log('exceptions:', b.exceptions());
  console.log('console tail:', b.console().slice(-6));
} finally {
  await b.close();
}
