import zlib from "node:zlib";

/** Images de test, sans dépendance : un vrai PNG (décodable, uni) et des en-têtes WebP valides pour chacun des trois formats (lossy, lossless, étendu). */
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, "latin1"); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };

export function png(width = 640, height = 400, rgb = [200, 120, 60]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** « lossy » (VP8 ), « lossless » (VP8L) ou « extended » (VP8X) : l'en-tête est exact (type et dimensions), le reste du flux n'est pas décodable. */
export function webp(width = 640, height = 400, kind = "lossless") {
  let body;
  if (kind === "lossy") { body = Buffer.alloc(10 + 8); body.writeUInt32LE(10, 4); body.write("VP8 ", 0, "latin1"); body.set([0, 0, 0, 0x9d, 0x01, 0x2a], 8); body.writeUInt16LE(width, 14); body.writeUInt16LE(height, 16); }
  else if (kind === "extended") { body = Buffer.alloc(18); body.write("VP8X", 0, "latin1"); body.writeUInt32LE(10, 4); body.writeUIntLE(width - 1, 12, 3); body.writeUIntLE(height - 1, 15, 3); }
  else { body = Buffer.alloc(13); body.write("VP8L", 0, "latin1"); body.writeUInt32LE(5, 4); body[8] = 0x2f; body.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 9); }
  body = Buffer.concat([body, Buffer.alloc(16)]); body.writeUInt32LE(body.length - 8, 4);   // un flux plausible : le reste du chunk est rempli
  const riff = Buffer.alloc(12); riff.write("RIFF", 0, "latin1"); riff.writeUInt32LE(4 + body.length, 4); riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, body]);
}

/** Même image, remplie jusqu'à `bytes` octets (poids limite) : pour un PNG, un bloc `tEXt` avant `IEND`. */
export function padPng(buf, bytes) {
  const iend = buf.subarray(buf.length - 12);
  return Buffer.concat([buf.subarray(0, buf.length - 12), chunk("tEXt", Buffer.alloc(Math.max(0, bytes - buf.length - 12), 0x41)), iend]);
}
