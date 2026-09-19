/* Ruffle keeps a SharedObject in localStorage as the base64 of a complete Local
   Shared Object container, not of bare AMF. The container is written by `flash-lso`
   (ruffle-rs/rust-flash-lso), which Ruffle uses:

     00 BF                      HEADER_VERSION
     u32                        the file's total length
     "TCSO" 00 04 00 00 00 00   HEADER_SIGNATURE (10 bytes)
     u16 <name>                 the SharedObject's own name
     00 00 00 00                three PADDING bytes, then the AMF version (0)
     repeat: u16 <key> <AMF0 value> 00   <- one PADDING byte after each element
     (no terminator: the body simply ends)

   The trailing 0x00 is `write_element_and_padding`'s PADDING constant; leaving it
   out misaligns every following field. */

const SIG = [0x54, 0x43, 0x53, 0x4f]; /* "TCSO" */

export function decodeLso(base64) {
  const b = Buffer.from(base64, 'base64');
  let o = 0;
  const out = { soName: null, fields: {}, offsets: {}, trace: [] };

  const str16 = () => { const n = b.readUInt16BE(o); o += 2; return b.toString('utf8', o, (o += n)); };

  function readPayload(t, depth) {
    if (depth > 6) throw new Error('nesting too deep at ' + (o - 1));
    switch (t) {
      case 0x00: { const v = b.readDoubleBE(o); o += 8; return v; }
      case 0x01: return !!b[o++];
      case 0x02: return str16();
      case 0x03: return readObject(depth, false);
      case 0x05: return null;
      case 0x06: return undefined;
      case 0x08: return readObject(depth, true);
      case 0x0a: { const n = b.readUInt32BE(o); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(readValue(depth + 1)); return a; }
      case 0x0b: { const v = b.readDoubleBE(o); o += 8; o += 2; return new Date(v); }
      case 0x0c: { const n = b.readUInt32BE(o); o += 4; return b.toString('utf8', o, (o += n)); }
      default: throw new Error('unknown AMF0 marker 0x' + t.toString(16) + ' at ' + (o - 1));
    }
  }

  function readValue(depth) { return readPayload(b[o++], depth); }

  function readObject(depth, ecma) {
    if (ecma) o += 4;
    const obj = {};
    for (;;) {
      if (b[o] === 0x00 && b[o + 1] === 0x00 && b[o + 2] === 0x09) { o += 3; return obj; }
      const key = str16();
      const at = o;
      const marker = b[o];
      obj[key] = readValue(depth + 1);
      out.offsets[key] = { marker, at };
    }
  }

  try {
    const lso = b.length > 16 && SIG.every((v, i) => b[6 + i] === v);
    out.container = lso;
    if (lso) {
      out.declaredLength = b.readUInt32BE(2);
      o = 16;
      out.soName = str16();
      o += 4;                     /* 3 PADDING bytes + the AMF version */
      while (o < b.length) {
        const key = str16();
        const at = o;
        const marker = b[o];
        out.fields[key] = readValue(0);
        out.offsets[key] = { marker, at };
        out.trace.push(key + '=' + JSON.stringify(out.fields[key]));
        o += 1;                   /* the per-element PADDING byte */
      }
    } else {
      while (o < b.length) {
        const t = b[o];
        if (t === 0x02) { const s = readValue(0); if (out.soName === null) out.soName = s; }
        else { readValue(0); }
      }
    }
  } catch (e) {
    out.error = e.message;
  }

  out.bytes = b.length;
  out.consumed = o;
  out.hex = b.slice(0, 64).toString('hex').replace(/(..)/g, '$1 ').trim();
  return out;
}

export const decodeSharedObject = decodeLso;

/* The `@file` line inside a PluStore document, and the base64 body under it. */
export function fileValue(documentText, name) {
  const lines = documentText.split('\n');
  const at = lines.indexOf('@file ' + name);
  return at < 0 ? null : lines[at + 1];
}
