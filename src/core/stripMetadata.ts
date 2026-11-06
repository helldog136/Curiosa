/**
 * Lossless removal of metadata from an image, without decoding it (the pixels are never touched):
 *   - JPEG: the segments APP1 (EXIF with GPS, XMP), APP13 (IPTC) and COM (comments) are dropped; the colour profile (APP2) and everything the picture needs are kept.
 *   - PNG: the text chunks (tEXt, zTXt, iTXt) and eXIf are dropped.
 *   - WebP, GIF and everything else: returned as received (not rewritten here).
 * Used by `media_import` only. An input that does not parse is returned unchanged.
 */
export function stripMetadata(buf: Buffer): Buffer {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf);
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return stripPng(buf);
  } catch { /* unreadable structure: keep the file as it is */ }
  return buf;
}

function stripJpeg(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return buf;
    const marker = buf[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // start of scan: the rest is the picture data
    if (marker === 0xd9) { out.push(buf.subarray(i)); return Buffer.concat(out); }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) return buf;
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out.push(buf.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return buf;
}

function stripPng(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const end = i + 12 + length;
    if (end > buf.length) return buf;
    const type = buf.toString("latin1", i + 4, i + 8);
    if (!["tEXt", "zTXt", "iTXt", "eXIf"].includes(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}
