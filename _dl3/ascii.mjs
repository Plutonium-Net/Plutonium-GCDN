/* Decode a PNG screenshot and print it as ASCII art. Scratch only. */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  let at = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (ft === 1) cur[i] = (cur[i] + a) & 255;
      else if (ft === 2) cur[i] = (cur[i] + b) & 255;
      else if (ft === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels: ch, data: out };
}

const RAMP = ' .:-=+*#%@';

export function ascii(path, cols, crop) {
  const full = decodePng(readFileSync(path));
  let img = full;
  if (crop) {
    const [cx0, cy0, cx1, cy1] = crop;
    const w = cx1 - cx0, h = cy1 - cy0;
    const buf = Buffer.alloc(w * h * full.channels);
    for (let y = 0; y < h; y++) {
      full.data.copy(buf, y * w * full.channels,
        ((y + cy0) * full.width + cx0) * full.channels,
        ((y + cy0) * full.width + cx0 + w) * full.channels);
    }
    img = { width: w, height: h, channels: full.channels, data: buf };
  }
  cols = cols || 118;
  const rows = process.env.PIXEL
    ? img.height
    : Math.max(1, Math.round((cols * img.height) / img.width / 2.1));
  if (process.env.PIXEL) cols = img.width;
  let out = '';
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * img.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * img.width) / cols));
      const y0 = Math.floor((r * img.height) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * img.height) / rows));
      let sum = 0, n = 0, colored = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * img.width + x) * img.channels;
          const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
          sum += 0.299 * R + 0.587 * G + 0.114 * B; n++;
          if (Math.max(R, G, B) - Math.min(R, G, B) > 40) colored++;
        }
      }
      const lum = sum / (n || 1);
      const sat = colored / (n || 1);
      let idx = Math.round((lum / 255) * (RAMP.length - 1));
      if (sat < 0.06 && lum > 90 && lum < 210) idx = Math.max(idx, 4);
      line += RAMP[Math.min(RAMP.length - 1, idx)];
    }
    out += line + '\n';
  }
  return out;
}

if (process.argv[2]) {
  const crop = process.env.CROP ? process.env.CROP.split(',').map(Number) : null;
  for (const f of process.argv.slice(2)) {
    console.log('=== ' + f + (crop ? ' crop ' + crop.join(',') : ''));
    console.log(ascii(f, Number(process.env.COLS || 118), crop));
  }
}
