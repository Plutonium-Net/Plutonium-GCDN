import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function decode(path) {
  const buf = readFileSync(path);
  let at = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported png ct=${ct} bd=${bd}`);
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

const RAMP = ' .:-=+*#%@';

export function ascii(path, cols = 100, rows = 34) {
  const { w, h, bpp, px } = decode(path);
  let s = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor((c + 0.5) * w / cols), y = Math.floor((r + 0.5) * h / rows);
      const i = (y * w + x) * bpp;
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      s += RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
    }
    s += '\n';
  }
  return s;
}

export function palette(path, top = 12) {
  const { w, h, bpp, px } = decode(path);
  const counts = new Map();
  for (let i = 0; i < px.length; i += bpp) {
    const k = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([k, n]) => `#${((k >> 8 & 15) * 17).toString(16).padStart(2, '0')}` +
      `${((k >> 4 & 15) * 17).toString(16).padStart(2, '0')}` +
      `${((k & 15) * 17).toString(16).padStart(2, '0')} ${(n / (w * h) * 100).toFixed(1)}%`);
}

if (process.argv[1] && process.argv[1].endsWith('png.mjs')) {
  const f = process.argv[2];
  console.log(palette(f).join('  '));
  console.log(ascii(f));
}
