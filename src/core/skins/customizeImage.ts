/**
 * THE PICTURE PIPELINE of skin customization (docs/SKINS.md "Customization", "Pictures"): what an owner uploads for an image slot becomes ONE file made by the core.
 * Nothing of the received file is kept: it is decoded, orientation applied, cropped to the slot's ratio around the chosen focal point, scaled down to the slot's
 * largest size, and RE-ENCODED. EXIF, GPS, XMP, comments and any data after the image are gone by construction, and so is a polyglot (a file that is also something else).
 *
 *  - decompression bombs: the type and size come from the header first; more than 40 million pixels (24 million in total for an animation) is refused before decoding;
 *  - a deadline (45 s) and two jobs at a time, the same limits as every other image job of the core;
 *  - animated pictures ARE allowed (GIF, animated WebP, APNG): at most 100 frames; an animation is never cropped (its ratio must fit) and gets a STILL (its first frame)
 *    that the sheet swaps in when the visitor asks for less motion;
 *  - an SVG goes through `sanitizeSvg` (rewritten from recognised parts) and is never stored as received.
 * No database or route here: `customizeStore.ts` owns files and rows. `sharp` is loaded on first use; without it the upload says so instead of storing anything.
 */
import crypto from "node:crypto";
import { TIMED_OUT, withDeadline } from "../deadline";
import { loadEngine, MAX_INPUT_PIXELS, slot } from "../imageDerive";
import { looksLikeSvg } from "../logoUpload";
import { sanitizeSvg } from "../svg";
import { MAX_UPLOAD_BYTES, sniffImage } from "../services/uploads";
import type { UploadRule } from "./customizeSpec";

export const PICTURE_LIMITS = {
  inputBytes: MAX_UPLOAD_BYTES,
  inputPixels: MAX_INPUT_PIXELS,
  /** An animation is decoded whole, in memory: fewer pixels than a still. */
  animatedPixels: 24_000_000,
  frames: 100,
  deadlineMs: 45_000,
} as const;

export type PictureError = {
  ok: false;
  code: "format" | "toolarge" | "pixels" | "small" | "ratio" | "heavy" | "frames" | "animation" | "busy" | "engine" | "failed" | "svg" | "unreadable";
  /** Numbers and words the message names (the size got and needed, the heaviest allowed). */
  detail?: Record<string, number | string>;
};
export type PictureOk = { ok: true; main: Buffer; ext: "webp" | "png" | "svg"; still?: Buffer; lum?: [number, number]; width: number; height: number; frames: number };
const no = (code: PictureError["code"], detail?: PictureError["detail"]): PictureError => ({ ok: false, code, ...(detail ? { detail } : {}) });

// ── APNG: a chunk whitelist rewrite (sharp reads only the first frame of an APNG, so the animation is kept by rewriting the file itself) ───────────────

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf: Buffer): number { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks an animated PNG needs to be displayed. Every other chunk (text, EXIF, profiles, physical size, time stamp, anything private) is dropped. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "tRNS", "acTL", "fcTL", "fdAT", "IDAT", "IEND"]);

export type PngRewrite = { ok: true; png: Buffer; frames: number; width: number; height: number; animated: boolean } | { ok: false };
/** Rewrites a PNG keeping only the whitelisted chunks, each with a valid checksum. Anything malformed is refused. */
export function rewritePng(buf: Buffer): PngRewrite {
  if (buf.length < 45 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return { ok: false };
  const parts: Buffer[] = [PNG_SIGNATURE];
  let at = 8, width = 0, height = 0, frames = 1, animated = false, sawEnd = false, count = 0, fctl = 0;
  while (at + 12 <= buf.length) {
    if (++count > 5000) return { ok: false };
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (len > buf.length || at + 12 + len > buf.length || !/^[A-Za-z]{4}$/.test(type)) return { ok: false };
    const data = buf.subarray(at + 8, at + 8 + len);
    if (crc32(buf.subarray(at + 4, at + 8 + len)) !== buf.readUInt32BE(at + 8 + len)) return { ok: false };
    if (count === 1 && type !== "IHDR") return { ok: false };
    if (type === "IHDR") { if (len !== 13) return { ok: false }; width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "acTL") { if (len !== 8) return { ok: false }; frames = data.readUInt32BE(0); animated = frames > 1; }
    if (type === "fcTL") fctl++;
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(at, at + 12 + len));
    at += 12 + len;
    if (type === "IEND") { sawEnd = true; break; }   // anything after IEND (trailing data, a hidden archive) is not copied
  }
  if (!sawEnd || !width || !height || (animated && fctl < 1)) return { ok: false };
  return { ok: true, png: Buffer.concat(parts), frames, width, height, animated };
}

// ── The pipeline ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n));
const channelLum = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const kindOf = (buf: Buffer): "png" | "jpg" | "webp" | "gif" | "svg" | null => (looksLikeSvg(buf) ? "svg" : sniffImage(buf));
const QUALITY = [86, 76, 66, 56, 46, 36];

/** A picture as a file the core made, or why not. `focal`: where the crop is centred (0..1), default the middle. */
export async function processPicture(buf: Buffer, rule: UploadRule, opts: { focal?: { x: number; y: number } } = {}): Promise<PictureOk | PictureError> {
  if (buf.length > PICTURE_LIMITS.inputBytes) return no("toolarge", { max: Math.floor(PICTURE_LIMITS.inputBytes / 1024 / 1024) });
  const kind = kindOf(buf);
  if (!kind || !rule.formats.includes(kind)) return no("format", { allowed: rule.formats.join(", ") });
  if (kind === "svg") return svgPicture(buf, rule);
  const sharp = await loadEngine();
  if (!sharp) return no("engine");
  const job = await slot(() => withDeadline(() => rasterPicture(sharp, buf, kind, rule, opts.focal ?? { x: 0.5, y: 0.5 }), PICTURE_LIMITS.deadlineMs));
  if (job === "busy") return no("busy");
  if (job === TIMED_OUT) return no("failed");
  return job;
}

function svgPicture(buf: Buffer, rule: UploadRule): PictureOk | PictureError {
  const clean = sanitizeSvg(buf.toString("utf8"), undefined, "contain", "center", { maxBytes: rule.maxKb * 1024, maxElements: 3000 });
  if (!clean.ok) return no("svg", { reason: clean.error.slice(0, 120) });
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(clean.svg);
  const w = Number(box?.[1]), h = Number(box?.[2]);
  if (!w || !h) return no("svg", { reason: "viewBox" });
  const want = rule.ratio[0] / rule.ratio[1];
  if (Math.abs(w / h - want) / want > Math.max(rule.ratioTolerance, 0.001)) return no("ratio", { want: `${rule.ratio[0]}:${rule.ratio[1]}` });
  return { ok: true, main: Buffer.from(clean.svg, "utf8"), ext: "svg", width: Math.round(w), height: Math.round(h), frames: 1 };
}

type Sharp = NonNullable<Awaited<ReturnType<typeof loadEngine>>>;

async function rasterPicture(sharp: Sharp, input: Buffer, kind: "png" | "jpg" | "webp" | "gif", rule: UploadRule, focal: { x: number; y: number }): Promise<PictureOk | PictureError> {
  try {
    let buf = input;
    let apng = false;
    let apngFrames = 1;
    if (kind === "png") {
      // a PNG is rewritten from its whitelisted chunks first: no metadata, nothing after the end, valid checksums; an animated one keeps its animation
      const r = rewritePng(buf);
      if (!r.ok) return no("unreadable");
      buf = r.png;
      apng = r.animated;
      apngFrames = r.frames;
      if (apng && !rule.animated) return no("animation");
      if (apng && r.frames > PICTURE_LIMITS.frames) return no("frames", { max: PICTURE_LIMITS.frames });
    }
    const head = await sharp(buf, { limitInputPixels: false, animated: true }).metadata();
    if (!head.width || !head.height) return no("unreadable");
    const frames = apng ? apngFrames : Math.max(1, head.pages ?? 1);
    const pageH = head.pageHeight ?? head.height;
    const turned = !apng && frames === 1 && (head.orientation ?? 1) >= 5;
    const W = turned ? pageH : head.width, H = turned ? head.width : pageH;
    const animated = frames > 1;
    if (animated && !rule.animated) return no("animation");
    if (frames > PICTURE_LIMITS.frames) return no("frames", { max: PICTURE_LIMITS.frames });
    if (W * H > PICTURE_LIMITS.inputPixels || W * H * frames > (animated ? PICTURE_LIMITS.animatedPixels : PICTURE_LIMITS.inputPixels)) return no("pixels");

    const want = rule.ratio[0] / rule.ratio[1];
    const have = W / H;
    const off = Math.abs(have - want) / want > rule.ratioTolerance;
    // crop region (a still only): the biggest region of the slot's ratio, centred on the focal point
    let region = { left: 0, top: 0, width: W, height: H };
    if (off) {
      if (animated) return no("ratio", { want: `${rule.ratio[0]}:${rule.ratio[1]}` });
      if (have > want) { const width = Math.max(1, Math.round(H * want)); region = { left: clamp(Math.round(focal.x * W - width / 2), 0, W - width), top: 0, width, height: H }; }
      else { const height = Math.max(1, Math.round(W / want)); region = { left: 0, top: clamp(Math.round(focal.y * H - height / 2), 0, H - height), width: W, height }; }
    }
    if (region.width < rule.minPx[0] || region.height < rule.minPx[1]) return no("small", { got: region.width, need: rule.minPx[0] });

    // size: down to the slot's largest, never up; heavier than allowed: smaller steps, never below the slot's smallest
    const maxBytes = rule.maxKb * 1024;
    let scale = Math.min(1, rule.maxPx[0] / region.width, rule.maxPx[1] / region.height);
    const make = async (q: number, s: number, first: boolean): Promise<{ out: Buffer; w: number; h: number }> => {
      const w = Math.max(1, Math.round(region.width * s)), h = Math.max(1, Math.round(region.height * s));
      let p = sharp(buf, { limitInputPixels: animated ? PICTURE_LIMITS.animatedPixels : PICTURE_LIMITS.inputPixels, failOn: "error", animated: animated && !first && !apng });
      if (!animated && !apng) p = p.rotate();   // EXIF orientation applied, then every piece of metadata is dropped by the encoder
      if (!animated && off) p = p.extract(region);
      p = p.resize(w, h, { fit: "fill", kernel: "lanczos3" });
      return { out: await p.webp({ quality: q, effort: 4 }).toBuffer(), w, h };
    };
    if (apng) {
      // an animated PNG is kept as the rewritten file: it fits the slot as it is, or it is refused (no frame-by-frame resize without a decoder)
      if (buf.length > maxBytes) return no("heavy", { max: rule.maxKb });
      if (W > rule.maxPx[0] || H > rule.maxPx[1]) return no("small", { got: W, need: rule.maxPx[0] });
      await sharp(buf, { limitInputPixels: PICTURE_LIMITS.inputPixels, failOn: "error" }).raw().toBuffer();   // really decodable
      const first = await make(80, 1, true);
      return { ok: true, main: buf, ext: "png", still: first.out, lum: await luminance(sharp, first.out), width: W, height: H, frames };
    }
    let result: { out: Buffer; w: number; h: number } | null = null;
    for (let step = 0; step < 6 && !result; step++) {
      for (const q of QUALITY) { const r = await make(q, scale, false); if (r.out.length <= maxBytes) { result = r; break; } }
      if (!result) { scale *= 0.75; if (region.width * scale < rule.minPx[0] || region.height * scale < rule.minPx[1]) break; }
    }
    if (!result) return no("heavy", { max: rule.maxKb });
    const still = animated ? (await make(80, scale, true)).out : undefined;
    return { ok: true, main: result.out, ext: "webp", ...(still ? { still } : {}), lum: await luminance(sharp, still ?? result.out), width: result.w, height: result.h, frames };
  } catch {
    return no("unreadable");
  }
}

/** The 10th and 90th percentile of the relative luminance of a picture (a 32-pixel sample): the darkest and the brightest parts text may sit on. */
async function luminance(sharp: Sharp, webp: Buffer): Promise<[number, number] | undefined> {
  try {
    const { data, info } = await sharp(webp, { limitInputPixels: PICTURE_LIMITS.inputPixels }).resize(32, 32, { fit: "inside" }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lums: number[] = [];
    for (let i = 0; i + 2 < data.length; i += info.channels) lums.push(0.2126 * channelLum(data[i]!) + 0.7152 * channelLum(data[i + 1]!) + 0.0722 * channelLum(data[i + 2]!));
    if (!lums.length) return undefined;
    lums.sort((a, b) => a - b);
    const at = (p: number) => Math.round(lums[Math.min(lums.length - 1, Math.floor(p * lums.length))]! * 10000) / 10000;
    return [at(0.1), at(0.9)];
  } catch { return undefined; }
}

/** A fresh file name: `<uuid>.<ext>`, matching UPLOAD_NAME_RE. */
export const newPictureName = (ext: "webp" | "png" | "svg"): string => `${crypto.randomUUID()}.${ext}`;
