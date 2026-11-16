/**
 * THE APPROXIMATE STILL PICTURE OF A COMPOSITION (core 0.25.0), made on the server with `sharp` (already a dependency; no browser on the server). What the
 * assistant LOOKS at while it places the text (`composition_preview` of a module): the backdrop (a picture, the first picture of a GIF, the still picture of
 * a video, or a plain frame when a video has none), the boxes at their place and size, their band, their outline, their text fitted as the engine does
 * (shrink, wrap, cut with "…"). Approximate on purpose and saying so: the font is the one bundled for previews (Inter Bold, fonts/preview), not the one OBS
 * will use; emoji and scripts the font lacks show as boxes; "Like the element" is drawn as white text with its outline. The exact render is the HTML kit
 * (kitPage.ts), opened in the assistant's own browser.
 *
 * Safety: only `/uploads/<uuid>.<ext>` files of the site are read (the caller checked they belong to it), `limitInputPixels`, a 4 s budget per render, texts
 * escaped for Pango markup (`&`, `<`, `>`), output 1280 px at most on its longest side.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { FORMAT_RATIO, IMAGE_SRC, LIMITS, VIDEO_SRC, type ResolvedBox, type ResolvedComposition } from "./model";
import { ratio as contrastRatio } from "@/core/overlays/appearance";

export type PreviewBackground = "checker" | "dark" | "light";
export type PreviewOptions = {
  /** Width of the picture, 320 to 1280 (default 960); the height follows the frame (the longest side stays under 1280). */
  width?: number;
  /** What shows through a transparent backdrop (default: checkerboard, as in the editor). */
  background?: PreviewBackground;
  /** The moment shown, in seconds: boxes not yet in (or already out) are left out. Default: once every box is in. */
  at?: number;
  /** The file's own size when it is known (a video: from its upload), for the "media" format. */
  media?: { width: number; height: number } | null;
  /** Where the files live (tests). */
  uploadsDir?: string;
};
export type PreviewBoxInfo = { id: string; text: string; shown: boolean; sizePx1080: number; lines: number; overflow: boolean; colour: string; band: boolean; outline: "none" | "thin" | "thick"; contrast: number | null; readable: boolean; readableBy: "band" | "outline" | "contrast" | null };
export type PreviewResult = { png: Buffer; mimeType: "image/png" | "image/jpeg"; info: { approximate: true; width: number; height: number; backdrop: "picture" | "gif-first-frame" | "video-still" | "none"; font: string; at: number; boxes: PreviewBoxInfo[]; notes: string[] } };

/** The font every preview uses (OFL, Inter; the credits are in fonts/CREDITS.md). */
export const PREVIEW_FONT = { family: "Inter", style: "Bold", file: "fonts/preview/Inter-Bold.otf" } as const;
const fontPath = () => path.resolve(/* turbopackIgnore: true */ process.cwd(), PREVIEW_FONT.file);
const BG: Record<PreviewBackground, string> = { checker: "#ffffff", dark: "#16181d", light: "#f4f4f2" };
const hexRgb = (h: string) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const lum = (h: string) => { const c = hexRgb(h); const l = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * l(c.r) + 0.7152 * l(c.g) + 0.0722 * l(c.b); };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The look of a box as the engine draws it (render.ts `lookOf`), in plain values: text colour, band (colour, opacity) and outline. "element" cannot know the
 * element's tokens here: white text with its outline (the engine's own fallback). A test keeps both in step.
 */
export function previewLook(b: Pick<ResolvedBox, "look" | "color" | "resolved" | "outline" | "pill">): { fg: string; band: { colour: string; alpha: number } | null; outline: "none" | "thin" | "thick"; radiusEm: number | null; radiusPx1080: number | null } {
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const explicit = typeof b.color === "string" && HEX.test(b.color) ? b.color.toLowerCase() : b.resolved === "#ffffff" || b.resolved === "#111111" ? b.resolved : null;
  if (b.look === "element") return { fg: explicit ?? "#ffffff", band: null, outline: b.outline === "none" ? "none" : b.outline === "thick" ? "thick" : "thin", radiusEm: 0.3, radiusPx1080: null };
  const PRESETS: Record<string, { opacity: number; outline: "thin" | "thick" }> = { readable: { opacity: 85, outline: "thin" }, discreet: { opacity: 55, outline: "thin" }, bare: { opacity: 0, outline: "thick" } };
  let panel = "#14171c", alpha = 0, line: "none" | "thin" | "thick" = b.outline ?? "thin";
  if (b.look === "custom" && b.pill) { panel = HEX.test(b.pill.color) ? b.pill.color : "#14171c"; alpha = Math.min(100, Math.max(0, b.pill.opacity)) / 100; }
  else if (PRESETS[b.look]) { alpha = PRESETS[b.look]!.opacity / 100; line = PRESETS[b.look]!.outline; }
  const worst = (fg: string) => Math.min(...[{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }].map((base) => { const p = hexRgb(panel); const over = { r: p.r * alpha + base.r * (1 - alpha), g: p.g * alpha + base.g * (1 - alpha), b: p.b * alpha + base.b * (1 - alpha) }; return contrastRatio(hexRgb(fg), over); }));
  const text = explicit ? (lum(explicit) > 0.4 ? "light" : "dark") : alpha <= 0 ? "light" : worst("#ffffff") >= worst("#111111") ? "light" : "dark";
  if (!explicit && alpha > 0 && text === "dark" && panel === "#14171c") panel = "#f7f7f5";
  if (line === "none" && alpha * 100 < 65) line = "thin";
  return { fg: explicit ?? (text === "light" ? "#ffffff" : "#111111"), band: alpha > 0 ? { colour: panel, alpha } : null, outline: line, radiusEm: b.look === "custom" && b.pill ? null : 0.3, radiusPx1080: b.look === "custom" && b.pill ? b.pill.radius : null };
}

type Sharp = (typeof import("sharp"))["default"];
let engine: Promise<Sharp> | null = null;
/** `sharp` is loaded at the first preview only (as in imageDerive.ts): an overlay page or a module that never previews never loads it. */
const loadSharp = (): Promise<Sharp> => (engine ??= import("sharp").then((m) => m.default ?? (m as unknown as Sharp)));

/** Renders a text in the preview font: its picture (RGBA) and size. `width` wraps (Pango); none: one line. */
async function textPicture(sharp: Sharp, text: string, px: number, colour: string, width: number | null, align: "left" | "centre" | "right") {
  const out = await sharp({ text: { text: `<span foreground="${colour}">${esc(text)}</span>`, font: `${PREVIEW_FONT.family} ${PREVIEW_FONT.style} ${Math.max(1, Math.round(px * 10) / 10)}`, fontfile: fontPath(), dpi: 72, rgba: true, ...(width ? { width: Math.max(1, Math.floor(width)), wrap: "word-char" as const } : {}), align } })
    .png().timeout({ seconds: 4 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

/** The frame ratio: a fixed format, or the file's own shape. */
function frameOf(c: ResolvedComposition, media: { width: number; height: number } | null, want: number) {
  const r = c.format !== "media" ? FORMAT_RATIO[c.format] : media && media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
  let w = Math.min(1280, Math.max(320, Math.round(want))), h = Math.round(w / r);
  if (h > 1280) { h = 1280; w = Math.max(1, Math.round(h * r)); }
  return { w, h };
}

/** The checkerboard of the editor, as a picture (what shows through a transparent backdrop). */
function checkerSvg(w: number, h: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#ffffff"/><rect width="10" height="10" fill="#d6d6d6"/><rect x="10" y="10" width="10" height="10" fill="#d6d6d6"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`);
}

export async function previewComposition(c: ResolvedComposition, opts: PreviewOptions = {}): Promise<PreviewResult> {
  const sharp = await loadSharp();
  const dir = opts.uploadsDir ?? UPLOADS_DIR;
  const notes: string[] = [];
  const src = String(c.backdrop?.src ?? "");
  const video = VIDEO_SRC.test(src);
  const stillSrc = video ? (c.backdrop.poster && IMAGE_SRC.test(c.backdrop.poster) ? c.backdrop.poster : "") : IMAGE_SRC.test(src) ? src : "";
  let still: Buffer | null = null, stillMeta: { width: number; height: number } | null = null;
  if (stillSrc) {
    try {
      still = await fs.readFile(path.join(dir, path.basename(stillSrc)));
      const m = await sharp(still, { limitInputPixels: 40_000_000 }).metadata();
      if (m.width && m.height) stillMeta = { width: m.width, height: m.height };
    } catch { still = null; notes.push("The backdrop file could not be read: a plain frame is shown."); }
  } else if (video) notes.push("This video has no still picture: a plain frame is shown. Upload it with a poster to see its picture here, or open composition_render_kit.");
  const { w: W, h: H } = frameOf(c, opts.media ?? (video ? null : stillMeta), opts.width ?? 960);
  const u = H / 1080;
  const layers: { input: Buffer; left: number; top: number }[] = [];
  const background = opts.background ?? "checker";
  const base = background === "checker" ? await sharp(checkerSvg(W, H)).png().toBuffer() : await sharp({ create: { width: W, height: H, channels: 4, background: BG[background] } }).png().toBuffer();

  // The backdrop, framed as the engine frames it (object-fit + object-position = the focus point).
  let backdropPixels: { data: Buffer; width: number; height: number } | null = null;
  if (still && stillMeta) {
    const fx = (c.backdrop.focus?.[0] ?? 50) / 100, fy = (c.backdrop.focus?.[1] ?? 50) / 100;
    const k = c.backdrop.fit === "contain" ? Math.min(W / stillMeta.width, H / stillMeta.height) : Math.max(W / stillMeta.width, H / stillMeta.height);
    const rw = Math.max(1, Math.round(stillMeta.width * k)), rh = Math.max(1, Math.round(stillMeta.height * k));
    let pic = await sharp(still, { limitInputPixels: 40_000_000, animated: false }).resize(rw, rh, { fit: "fill" }).ensureAlpha().png().timeout({ seconds: 4 }).toBuffer();
    let left = Math.round((W - rw) * fx), top = Math.round((H - rh) * fy);
    if (rw > W || rh > H) {
      const ex = { left: Math.max(0, -left), top: Math.max(0, -top), width: Math.min(W, rw), height: Math.min(H, rh) };
      pic = await sharp(pic).extract(ex).png().toBuffer();
      left = Math.max(0, left); top = Math.max(0, top);
    }
    layers.push({ input: pic, left, top });
    const flat = await sharp(base).composite([{ input: pic, left, top }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    backdropPixels = { data: flat.data, width: flat.info.width, height: flat.info.height };
  }

  // The moment shown: once every box is in, unless asked.
  const at = Number.isFinite(opts.at) ? Math.min(LIMITS.at.max, Math.max(0, Number(opts.at))) : Math.max(0, ...c.boxes.map((b) => (b.in?.anim === "none" ? 0 : (b.in?.at ?? 0) + (b.in?.dur ?? 0))));
  const boxes: PreviewBoxInfo[] = [];
  for (const b of c.boxes) {
    const look = previewLook(b);
    const text = b.case === "upper" ? b.text.toUpperCase() : b.text;
    const inAt = b.in?.anim === "none" ? 0 : b.in?.at ?? 0;
    const outAt = typeof b.out?.at === "number" ? b.out.at + (b.out.dur ?? 0) : null;
    const shown = at >= inAt && (outAt === null || at < outAt);
    const info: PreviewBoxInfo = { id: b.id, text, shown, sizePx1080: b.size, lines: 0, overflow: false, colour: look.fg, band: !!look.band, outline: look.outline, contrast: null, readable: true, readableBy: look.band && look.band.alpha >= 0.65 ? "band" : look.outline !== "none" ? "outline" : null };
    boxes.push(info);
    if (!shown) continue;
    // the box, its inner area (the engine's padding: 0.4 % of the frame width on each side)
    const pad = 0.004 * W;
    const bx = (b.x / 100) * W, by = (b.y / 100) * H, bw = (b.w / 100) * W, bh = (b.h / 100) * H;
    const innerW = Math.max(1, bw - 2 * pad), innerH = Math.max(1, bh - 2 * pad);
    const align = b.align === "start" ? "left" : b.align === "end" ? "right" : "centre";
    const padEm = look.band ? { x: 0.45, y: 0.12 } : { x: 0.1, y: 0.05 };
    const mode = b.fit === "wrap" || b.fit === "cut" ? b.fit : "shrink";
    const maxLines = mode === "cut" ? 1 : b.maxLines;
    const lineOf = async (px: number) => (await textPicture(sharp, "Ag", px, "#000000", null, "left")).height;
    const render = async (size: number, t: string) => {
      const px = size * u;
      const width = mode === "cut" ? null : innerW - 2 * padEm.x * px;
      const pic = await textPicture(sharp, t, px, look.fg, width && width > px ? width : null, align);
      const lineH = await lineOf(px);
      const lines = Math.max(1, Math.round(pic.height / Math.max(1, lineH)));
      const fits = pic.height + 2 * padEm.y * px <= innerH + 0.5 && pic.width + 2 * padEm.x * px <= innerW + 0.5 && lines <= maxLines;
      return { pic, lines, fits, px };
    };
    // shrink: the largest size between minSize and size that fits (halving, as the engine); wrap and cut keep the size
    let size = b.size, r = await render(size, text);
    if (!r.fits && mode === "shrink" && b.minSize < b.size) {
      let lo = b.minSize, hi = b.size;
      const low = await render(lo, text);
      if (low.fits) { r = low; size = lo; while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const m = await render(mid, text); if (m.fits) { lo = mid; r = m; size = mid; } else hi = mid; } }
      else { r = low; size = lo; }
    }
    // still too long: cut with "…" (the engine's line clamp), the longest start that fits
    let shownText = text;
    if (!r.fits) {
      info.overflow = true;
      let lo = 0, hi = text.length;
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const m = await render(size, `${text.slice(0, mid).trimEnd()}…`); if (m.fits) lo = mid; else hi = mid; }
      shownText = `${text.slice(0, lo).trimEnd()}…`;
      r = await render(size, shownText);
    }
    info.sizePx1080 = size; info.lines = r.lines; info.text = shownText;
    // place the text block (and its band) in the box, by the anchor (the engine's flex alignment)
    const px = r.px;
    const blockW = Math.min(innerW, r.pic.width + 2 * padEm.x * px), blockH = Math.min(innerH, r.pic.height + 2 * padEm.y * px);
    const anchor = String(b.anchor ?? "bc"), vert = anchor === "c" ? "m" : anchor[0], horiz = anchor === "c" ? "c" : anchor[1];
    const left = bx + pad + (horiz === "l" ? 0 : horiz === "r" ? innerW - blockW : (innerW - blockW) / 2);
    const top = by + pad + (vert === "t" ? 0 : vert === "b" ? innerH - blockH : (innerH - blockH) / 2);
    const L = Math.max(0, Math.round(left)), T = Math.max(0, Math.round(top));
    if (look.band) {
      const radius = look.radiusPx1080 !== null ? look.radiusPx1080 * u : (look.radiusEm ?? 0.3) * px;
      const c0 = hexRgb(look.band.colour);
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(blockW)}" height="${Math.ceil(blockH)}"><rect width="100%" height="100%" rx="${radius}" fill="rgb(${c0.r},${c0.g},${c0.b})" fill-opacity="${look.band.alpha}"/></svg>`), left: L, top: T });
    }
    const tl = Math.max(0, Math.round(L + padEm.x * px)), tt = Math.max(0, Math.round(T + padEm.y * px));
    // the outline: the text in the outline colour, offset in 8 directions (the engine's text-shadow), under the text
    if (look.outline !== "none") {
      const light = lum(look.fg) > 0.4;
      const oc = light ? "#000000" : "#ffffff";
      const d = Math.max(1, Math.round((look.outline === "thick" ? 3 : 2) * u));
      const ink = await textPicture(sharp, shownText, px, oc, mode === "cut" ? null : innerW - 2 * padEm.x * px > px ? innerW - 2 * padEm.x * px : null, align);
      for (const [dx, dy] of [[-d, -d], [d, -d], [-d, d], [d, d], [0, -d], [0, d], [-d, 0], [d, 0]] as const) layers.push({ input: ink.data, left: Math.max(0, tl + dx), top: Math.max(0, tt + dy) });
    }
    layers.push({ input: r.pic.data, left: tl, top: tt });
    // readability: a band of 65 % or more, or an outline, reads anywhere (the kit's rule); the worst contrast (5 % of the pixels) of the text over what is
    // under it is given too, so the assistant sees how much the outline has to do
    if (backdropPixels && !(look.band && look.band.alpha >= 0.65)) {
      const fg = hexRgb(look.fg), list: number[] = [];
      const x0 = Math.max(0, Math.floor(bx)), y0 = Math.max(0, Math.floor(by)), x1 = Math.min(W, Math.ceil(bx + bw)), y1 = Math.min(H, Math.ceil(by + bh));
      const step = Math.max(1, Math.floor(((x1 - x0) * (y1 - y0)) / 4000));
      for (let i = 0, n = 0; i < (x1 - x0) * (y1 - y0); i += step, n++) {
        const x = x0 + (i % (x1 - x0)), y = y0 + Math.floor(i / (x1 - x0)), o = (y * W + x) * 3;
        let p = { r: backdropPixels.data[o]!, g: backdropPixels.data[o + 1]!, b: backdropPixels.data[o + 2]! };
        if (look.band) { const bc = hexRgb(look.band.colour), a = look.band.alpha; p = { r: bc.r * a + p.r * (1 - a), g: bc.g * a + p.g * (1 - a), b: bc.b * a + p.b * (1 - a) }; }
        list.push(contrastRatio(fg, p));
      }
      if (list.length) {
        list.sort((a, z) => a - z);
        info.contrast = Math.round(list[Math.floor(list.length * 0.05)]! * 10) / 10;
        if (info.contrast >= 4.5) info.readableBy = info.readableBy ?? "contrast";
        info.readable = info.readableBy !== null;
      }
    }
  }
  const composed = sharp(base).composite(layers.filter((l) => l.left < W && l.top < H)).timeout({ seconds: 4 });
  let png = await composed.png({ compressionLevel: 9 }).toBuffer();
  let mimeType: "image/png" | "image/jpeg" = "image/png";
  if (png.length > 900_000) { png = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer(); mimeType = "image/jpeg"; }
  if (boxes.some((b) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b.text))) notes.push("Emoji are drawn with the preview font, which has none: they show as boxes here, not in OBS.");
  return { png, mimeType, info: { approximate: true, width: W, height: H, backdrop: !still ? "none" : video ? "video-still" : /\.gif$/.test(src) ? "gif-first-frame" : "picture", font: `${PREVIEW_FONT.family} ${PREVIEW_FONT.style} (preview font; OBS uses the element's)`, at, boxes, notes } };
}
