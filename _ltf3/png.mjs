import zlib from 'node:zlib';

export function decodePng(buf) {
  let o = 8; /* signature */
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); o += 4;
    const type = buf.toString('ascii', o, o + 4); o += 4;
    const data = buf.slice(o, o + len); o += len + 4; /* + crc */
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' unsupported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('colorType ' + colorType + ' unsupported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.slice(p, p + stride); p += stride;
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const dst = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? dst[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      dst[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

const RAMP = ' .:-=+*#%@';
export function ascii(png, cols = 96, rows = 32) {
  const { width, height, channels, data } = png;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * width / cols), x1 = Math.max(x0 + 1, Math.floor((c + 1) * width / cols));
      const y0 = Math.floor(r * height / rows), y1 = Math.max(y0 + 1, Math.floor((r + 1) * height / rows));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * width + x) * channels;
        sum += (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11); n++;
      }
      const lum = sum / n / 255;
      line += RAMP[Math.min(RAMP.length - 1, Math.round(lum * (RAMP.length - 1)))];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function nonBlack(png) {
  const { width, height, channels, data } = png;
  let n = 0;
  for (let i = 0; i < width * height; i++) {
    const j = i * channels;
    if (data[j] + data[j + 1] + data[j + 2] > 45) n++;
  }
  return n / (width * height);
}
