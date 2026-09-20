import { launch } from './h.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const b = await launch({ headful: process.argv.includes('--headful') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  await b.goto('/games/soccer-random/index.html');
  await sleep(12000);
  // the whole canvas is 1264x625 but the drawing is tiny: find the bounding box
  // of every pixel that is not the near-black clear colour, straight from the PNG
  const full = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('_sr/full.png', Buffer.from(full.data, 'base64'));
  const { w, h, bpp, px } = decode('_sr/full.png');
  let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * bpp;
    const lum = px[i] + px[i + 1] + px[i + 2];
    if (lum > 90) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  console.log('non-dark pixels: %d, bbox: %d,%d - %d,%d', n, x0, y0, x1, y1);
  if (n === 0) { console.log('screen is entirely dark'); } else {
    const pad = 6;
    const clip = { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad),
      width: Math.min(w - x0 + pad, x1 - x0 + 2 * pad + 1), height: y1 - y0 + 2 * pad + 1, scale: 1 };
    const zoom = await b.send('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync('_sr/zoom.png', Buffer.from(zoom.data, 'base64'));
    const z = decode('_sr/zoom.png');
    const RAMP = ' .:-=+*#%@';
    let s = '';
    for (let r = 0; r < z.h; r++) {
      for (let c = 0; c < z.w; c++) {
        const i = (r * z.w + c) * z.bpp;
        s += RAMP[Math.min(9, Math.floor((z.px[i] + z.px[i + 1] + z.px[i + 2]) / 3 / 256 * 10))];
      }
      s += '\n';
    }
    console.log('zoom ' + clip.width + 'x' + clip.height);
    console.log(s);
  }
} finally {
  await b.close();
}
