import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const URL = 'https://cdn.jsdelivr.net/gh/RobiFet/CMinterview@a4017231eca9f2173ad7ec0e63b01e4786b4ad6b/web/src/BiWrath.swf';
const r = await fetch(URL);
console.log('status', r.status, 'length', r.headers.get('content-length'));
const buf = Buffer.from(await r.arrayBuffer());
console.log('bytes', buf.length);
console.log('sha256', createHash('sha256').update(buf).digest('hex'));
console.log('md5   ', createHash('md5').update(buf).digest('hex'));

/* SWF header: "FWS"/"CWS"/"ZWS", version, file length, then a RECT in twips. */
const sig = buf.toString('ascii', 0, 3);
const version = buf[3];
const fileLength = buf.readUInt32LE(4);
let p = 8, bits = 0, n = 0, rect = [];
const read = () => { if (n === 0) { bits = buf[p++]; n = 8; } const b = (bits >> 7) & 1; bits = (bits << 1) & 0xff; n--; return b; };
const nbits = (() => { let v = 0; for (let i = 0; i < 5; i++) v = (v << 1) | read(); return v; })();
for (let i = 0; i < 4; i++) { let v = 0; for (let j = 0; j < nbits; j++) v = (v << 1) | read(); rect.push(v); }
const twips = t => (t / 20).toFixed(0);
console.log('sig %s version %d fileLength %d  rect %s -> %sx%s px (stage %sx%s twips)',
  sig, version, fileLength, rect.join(','),
  twips(rect[1] - rect[0]), twips(rect[3] - rect[2]), rect[1] - rect[0], rect[3] - rect[2]);
console.log('frameRate', (buf[p] | (buf[p + 1] << 8)) / 256, 'frames', buf.readUInt16LE(p + 2));
writeFileSync('games/the-binding-of-isaac/BiWrath.swf', buf);
console.log('wrote games/the-binding-of-isaac/BiWrath.swf');
