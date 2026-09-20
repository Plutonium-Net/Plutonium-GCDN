import { launch } from './h.mjs';
import { writeFileSync } from 'node:fs';
import { decode, palette, ascii } from './png.mjs';

const b = await launch({ headful: process.argv.includes('--headful') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(tag) {
  const full = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`_sr/${tag}.png`, Buffer.from(full.data, 'base64'));
  const { w, h, bpp, px } = decode(`_sr/${tag}.png`);
  let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * bpp;
    if (px[i] + px[i + 1] + px[i + 2] > 90) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  console.log('%s lit=%d bbox=%s', tag, n, n ? `${x0},${y0}-${x1},${y1}` : '-');
  console.log('  palette:', palette(`_sr/${tag}.png`).join(' '));
  return { w, h, bpp, px, x0, y0, x1, y1, n };
}

try {
  await b.goto('/_sr/orig.html');
  await sleep(15000);
  await shot('orig');
  console.log('orig console:', b.console().slice(-12));
  const off = [...new Set(b.requests())].filter(u => !u.startsWith('http://127.0.0.1:5500'));
  console.log('orig off-machine requests:', off.length);

  await b.goto('/games/soccer-random/index.html');
  await sleep(15000);
  const mine = await shot('conv');
  console.log('conv console:', b.console().slice(-12));
  console.log(ascii('_sr/conv.png', 100, 38));
} finally {
  await b.close();
}
