/**
 * IMAGE HEADERS OF A SCENE (core 0.40.0): the size of a picture read from its first bytes, at install, WITHOUT decoding it (a tiny file can still unpack into a
 * huge picture: the decoded size, not the file size, is what costs memory in the browser source). PNG (`IHDR`), WebP (`VP8 `, `VP8L`, `VP8X`) and a sanitised SVG
 * (`width`/`height` or `viewBox`). An animated PNG (`acTL`) or an animated WebP is refused: animation is always a sprite sheet with a declared grid, frame by frame.
 * Pure (bytes in, numbers out).
 */
export type ImageProbe = { w: number; h: number; animated: boolean };

const u32 = (b: Buffer, o: number): number => b.readUInt32BE(o);

function probePng(b: Buffer): ImageProbe | null {
  if (b.length < 33 || b.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const w = u32(b, 16), h = u32(b, 20);
  let animated = false;
  for (let o = 8; o + 8 <= b.length && o < 4096;) {
    const len = u32(b, o), type = b.subarray(o + 4, o + 8).toString("latin1");
    if (type === "acTL") animated = true;
    if (type === "IDAT") break;
    o += 12 + len;
  }
  return { w, h, animated };
}

function probeWebp(b: Buffer): ImageProbe | null {
  if (b.length < 30 || b.subarray(0, 4).toString("latin1") !== "RIFF" || b.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  const type = b.subarray(12, 16).toString("latin1");
  let animated = false;
  for (let o = 12; o + 8 <= b.length;) {   // an animation says so by its chunks, whatever the first one is
    const t = b.subarray(o, o + 4).toString("latin1");
    if (t === "ANIM" || t === "ANMF") animated = true;
    o += 8 + b.readUInt32LE(o + 4) + (b.readUInt32LE(o + 4) & 1);
  }
  if (type === "VP8X") return { w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)), animated: animated || (b[20]! & 0x02) !== 0 };
  if (type === "VP8L") return b[20] === 0x2f ? { w: 1 + (b.readUInt16LE(21) & 0x3fff), h: 1 + ((b.readUInt32LE(22) >>> 6) & 0x3fff), animated } : null;
  if (type === "VP8 ") return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, animated } : null;
  return null;
}

/** The pixel size of a sanitised SVG: its `width` and `height` (px or bare numbers), else its `viewBox`. */
function probeSvg(b: Buffer): ImageProbe | null {
  const head = b.toString("utf8", 0, Math.min(b.length, 2048)), tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];
  const px = (v: string | undefined) => (v && /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(v) ? parseFloat(v) : NaN);
  let w = px(attr("width")), h = px(attr("height"));
  const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if ((!(w > 0) || !(h > 0)) && vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) { w = vb[2]!; h = vb[3]!; }
  return w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h), animated: false } : null;
}

/** The size of a `.png`, `.webp` or `.svg` from its bytes, or null (not what its extension says, or unreadable). */
export function probeImage(file: string, b: Buffer): ImageProbe | null {
  try {
    if (file.endsWith(".png")) return probePng(b);
    if (file.endsWith(".webp")) return probeWebp(b);
    if (file.endsWith(".svg")) return probeSvg(b);
  } catch { /* a truncated file */ }
  return null;
}
