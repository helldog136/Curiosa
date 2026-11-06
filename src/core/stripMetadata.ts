/**
 * Lossless removal of metadata from an image, without decoding it (the pixels are never touched). Used by `media_import` only.
 *
 * It is an ALLOW-LIST: only what the picture needs is copied, everything else is dropped, and a file whose structure cannot be read is REFUSED
 * (`UnreadableImage`), never stored as received.
 *   - JPEG: kept = SOF, DHT, DAC, DQT, DRI, DNL, SOS and its data, RSTn, APP0 (JFIF), APP2 only when it is a colour profile, APP14 (Adobe colour transform).
 *     Dropped = APP1 (EXIF with GPS, XMP), APP13 (IPTC), COM, APP3..APP12, APP15, everywhere (also between progressive scans), and ANYTHING after the end of image
 *     (an appended thumbnail or EXIF). The EXIF Orientation is the one thing kept, rewritten in a minimal APP1 of 34 bytes (the site rotates pictures upright from
 *     it, imageDerive.ts), so a phone portrait does not turn sideways and carries no GPS.
 *   - PNG: kept = the chunks the picture needs (IHDR, PLTE, IDAT, IEND, tRNS, colour and size information, animation chunks); text, EXIF, time and unknown chunks are
 *     dropped, and anything after IEND.
 *   - WebP, GIF, svg and everything else: returned as received (the caller checks them; WebP and GIF metadata is not removed here).
 */
export class UnreadableImage extends Error {}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "hIST", "pHYs", "acTL", "fcTL", "fdAT", "cICP", "mDCV"]);

export function stripMetadata(buf: Buffer): Buffer {
  if (buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return stripPng(buf);
  return buf;
}

/** The Orientation (1 to 8) of the first EXIF block, or 1. Never throws. */
function orientationOf(app1: Buffer): number {
  try {
    if (app1.toString("latin1", 0, 6) !== "Exif\0\0") return 1;
    const tiff = app1.subarray(6);
    const le = tiff.toString("latin1", 0, 2) === "II";
    if (!le && tiff.toString("latin1", 0, 2) !== "MM") return 1;
    const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    if (u16(2) !== 42) return 1;
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < Math.min(count, 64); i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
    }
  } catch { /* out of range: no orientation */ }
  return 1;
}

/** A complete APP1 segment that holds only the Orientation (34 bytes). */
function orientationSegment(orientation: number): Buffer {
  const b = Buffer.alloc(36);
  b[0] = 0xff; b[1] = 0xe1; b.writeUInt16BE(34, 2);
  b.write("Exif\0\0", 4, "latin1");
  b.write("II", 10, "latin1"); b.writeUInt16LE(42, 12); b.writeUInt32LE(8, 14); // TIFF header, IFD0 at 8
  b.writeUInt16LE(1, 18);                                                       // one entry
  b.writeUInt16LE(0x0112, 20); b.writeUInt16LE(3, 22); b.writeUInt32LE(1, 24); b.writeUInt16LE(orientation, 28);
  return b;                                                                      // next IFD = 0 (bytes 32 to 35)
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const KEEP_JPEG = (marker: number, segment: Buffer): boolean => {
  if (SOF.has(marker) || marker === 0xc4 || marker === 0xcc || marker === 0xdb || marker === 0xda || marker === 0xdd || marker === 0xdc || marker === 0xe0 || marker === 0xee) return true;
  if (marker === 0xe2) return segment.toString("latin1", 4, 15) === "ICC_PROFILE"; // a colour profile, not a vendor block
  return false;
};

function stripJpeg(buf: Buffer): Buffer {
  const bad = () => new UnreadableImage("jpeg");
  const out: Buffer[] = [buf.subarray(0, 2)];
  let orientation = 1; let inserted = false; let sawFrame = false; let sawScan = false;
  let i = 2;
  const insertOrientation = () => { if (!inserted) { inserted = true; if (orientation !== 1) out.push(orientationSegment(orientation)); } };
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw bad();
    const marker = buf[i + 1];
    if (marker === undefined) throw bad();
    if (marker === 0xff) { i++; continue; }                     // fill byte
    if (marker === 0xd9) {                                      // end of image: nothing after it is kept
      if (!sawFrame || !sawScan) throw bad();
      insertOrientation();
      out.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0x00 || marker === 0xd8) throw bad();
    if (i + 4 > buf.length) throw bad();
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) throw bad();
    const segment = buf.subarray(i, i + 2 + length);
    if (marker === 0xe1 && orientation === 1) orientation = orientationOf(segment.subarray(4));
    if (marker !== 0xe0) insertOrientation();                    // the APP0 (JFIF) stays first, the Orientation comes right after it
    if (KEEP_JPEG(marker, segment)) out.push(segment);
    if (SOF.has(marker)) sawFrame = true;
    i += 2 + length;
    if (marker === 0xda) {                                      // scan data: up to the next real marker (not a stuffed 00, not RSTn, not a fill byte)
      sawScan = true;
      const start = i;
      while (i < buf.length - 1) {
        if (buf[i] === 0xff) {
          const next = buf[i + 1]!;
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
          if (next === 0xff) { i++; continue; }
          i += 2; continue;
        }
        i++;
      }
      if (i >= buf.length - 1) throw bad(); // the data runs to the end of the file: truncated
      out.push(buf.subarray(start, i));
    }
  }
  throw bad(); // no end of image: truncated
}

function stripPng(buf: Buffer): Buffer {
  const bad = () => new UnreadableImage("png");
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8; let sawHeader = false; let sawData = false;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const end = i + 12 + length;
    if (end > buf.length) throw bad();
    const type = buf.toString("latin1", i + 4, i + 8);
    if (type === "IHDR") sawHeader = true;
    if (type === "IDAT") sawData = true;
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") { if (!sawHeader || !sawData) throw bad(); return Buffer.concat(out); }
  }
  throw bad();
}
