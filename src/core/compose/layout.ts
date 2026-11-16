/**
 * GEOMETRY OF THE COMPOSITION EDITOR (core 0.19.0). Pure and tested alone: every rectangle is in PERCENT of the frame (0 to 100 on each axis), so what the
 * editor computes is what the page draws, whatever the zoom. The same ideas as the overlay page editor (overlays/layout.ts: handles, magnet, anchors), on a
 * frame whose sides are not in pixels.
 */
import { LIMITS, SAFE_MARGIN, type Box, type GUIDES } from "./model";

export type PRect = { x: number; y: number; w: number; h: number };
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export type SnapLine = { axis: "x" | "y"; at: number; kind: "frame" | "centre" | "margin" | "box" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const MIN = LIMITS.minBox;

/** Keeps a rectangle inside the frame, at least 4 % on each side, rounded to 2 decimals. */
export function clampRect(r: PRect): PRect {
  const w = clamp(Number.isFinite(r.w) ? r.w : MIN, MIN, 100), h = clamp(Number.isFinite(r.h) ? r.h : MIN, MIN, 100);
  return { x: r2(clamp(Number.isFinite(r.x) ? r.x : 0, 0, 100 - w)), y: r2(clamp(Number.isFinite(r.y) ? r.y : 0, 0, 100 - h)), w: r2(w), h: r2(h) };
}

/** Moves a rectangle by (dx, dy) percent, kept in the frame. */
export const moveRect = (r: PRect, dx: number, dy: number): PRect => clampRect({ ...r, x: r.x + dx, y: r.y + dy });

/** The new rectangle while a handle is dragged by (dx, dy) percent: the opposite side stays put (or, `fromCentre`, both sides move). Never smaller than 4 %. */
export function resizeRect(start: PRect, handle: Handle, dx: number, dy: number, fromCentre = false): PRect {
  const west = handle.includes("w"), east = handle.includes("e"), north = handle.includes("n"), south = handle.includes("s");
  let x0 = start.x, x1 = start.x + start.w, y0 = start.y, y1 = start.y + start.h;
  if (east) { x1 = start.x + start.w + dx; if (fromCentre) x0 = start.x - dx; }
  if (west) { x0 = start.x + dx; if (fromCentre) x1 = start.x + start.w - dx; }
  if (south) { y1 = start.y + start.h + dy; if (fromCentre) y0 = start.y - dy; }
  if (north) { y0 = start.y + dy; if (fromCentre) y1 = start.y + start.h - dy; }
  x0 = clamp(x0, 0, 100); x1 = clamp(x1, 0, 100); y0 = clamp(y0, 0, 100); y1 = clamp(y1, 0, 100);
  if (x1 - x0 < MIN) { if (west && !east) x0 = x1 - MIN; else x1 = x0 + MIN; }
  if (y1 - y0 < MIN) { if (north && !south) y0 = y1 - MIN; else y1 = y0 + MIN; }
  return clampRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/** The lines a box snaps to: the frame edges and centre, the safe margins of the chosen guides, the edges and centres of the other boxes. */
export function snapLines(guides: (typeof GUIDES)[number], others: readonly PRect[]): SnapLine[] {
  const out: SnapLine[] = [];
  for (const axis of ["x", "y"] as const) {
    out.push({ axis, at: 0, kind: "frame" }, { axis, at: 100, kind: "frame" }, { axis, at: 50, kind: "centre" });
    const m = SAFE_MARGIN[guides];
    if (m > 0) out.push({ axis, at: m, kind: "margin" }, { axis, at: 100 - m, kind: "margin" });
    for (const o of others) {
      const a = axis === "x" ? o.x : o.y, s = axis === "x" ? o.w : o.h;
      out.push({ axis, at: a, kind: "box" }, { axis, at: r2(a + s / 2), kind: "box" }, { axis, at: r2(a + s), kind: "box" });
    }
  }
  return out;
}

/**
 * Magnet while moving: on each axis, the start, centre or end of the box comes onto the nearest line closer than `threshold` percent. Returns the guides
 * to draw. Shift (no magnet) simply does not call this.
 */
export function snapMove(r: PRect, lines: readonly SnapLine[], threshold: { x: number; y: number }): { rect: PRect; guides: SnapLine[] } {
  const guides: SnapLine[] = [];
  const axis = (a: "x" | "y") => {
    const pos = a === "x" ? r.x : r.y, size = a === "x" ? r.w : r.h, t = a === "x" ? threshold.x : threshold.y;
    let best: { d: number; to: number; line: SnapLine } | null = null;
    for (const line of lines) {
      if (line.axis !== a) continue;
      for (const offset of [0, size / 2, size]) {
        const d = Math.abs(pos + offset - line.at);
        if (d <= t && (!best || d < best.d)) best = { d, to: line.at - offset, line };
      }
    }
    if (!best) return pos;
    guides.push(best.line);
    return best.to;
  };
  const x = axis("x"), y = axis("y");
  return { rect: clampRect({ ...r, x, y }), guides };
}

/** Magnet while resizing: the moving edges come onto the nearest line. */
export function snapResize(r: PRect, handle: Handle, lines: readonly SnapLine[], threshold: { x: number; y: number }): { rect: PRect; guides: SnapLine[] } {
  const guides: SnapLine[] = [];
  let x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
  const near = (v: number, a: "x" | "y") => {
    const t = a === "x" ? threshold.x : threshold.y;
    let best: SnapLine | null = null;
    for (const l of lines) if (l.axis === a && Math.abs(l.at - v) <= t && (!best || Math.abs(l.at - v) < Math.abs(best.at - v))) best = l;
    if (best) guides.push(best);
    return best ? best.at : v;
  };
  if (handle.includes("w")) x0 = near(x0, "x");
  if (handle.includes("e")) x1 = near(x1, "x");
  if (handle.includes("n")) y0 = near(y0, "y");
  if (handle.includes("s")) y1 = near(y1, "y");
  if (x1 - x0 < MIN || y1 - y0 < MIN) return { rect: r, guides: [] };
  return { rect: clampRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), guides };
}

/** The keyboard: arrows move by 1 % (Shift 0.1 %, Ctrl 10 %); with Alt they resize (right and down grow, left and up shrink). */
export function nudge(r: PRect, key: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean }): PRect | null {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!d) return null;
  const step = mods.shift ? 0.1 : mods.ctrl ? 10 : 1;
  if (mods.alt) return clampRect({ ...r, w: Math.max(MIN, Math.min(100 - r.x, r.w + d[0]! * step)), h: Math.max(MIN, Math.min(100 - r.y, r.h + d[1]! * step)) });
  return moveRect(r, d[0]! * step, d[1]! * step);
}

/** Where a box sits, in words for the live region: "bc" = bottom centre. */
export function placeOf(r: PRect): string {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const v = cy < 100 / 3 ? "t" : cy > 200 / 3 ? "b" : "m";
  const h = cx < 100 / 3 ? "l" : cx > 200 / 3 ? "r" : "c";
  return v === "m" && h === "c" ? "c" : `${v}${h}`;
}

/** Overlap of two boxes, as a share of the smaller one (0 to 1): above 0.1 the editor says "Covers text box 1". */
export function overlapShare(a: PRect, b: PRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

// ── Zoom of the canvas ─────────────────────────────────────────────────────────────────────────────────────────────────
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;
export const clampZoom = (z: number): number => clamp(Math.round((Number.isFinite(z) ? z : 1) * 100) / 100, ZOOM_MIN, ZOOM_MAX);
/** The next zoom step up or down (25 % steps). */
export function stepZoom(z: number, dir: 1 | -1): number {
  const n = dir > 0 ? Math.floor(z / ZOOM_STEP + 1e-6) + 1 : Math.ceil(z / ZOOM_STEP - 1e-6) - 1;
  return clampZoom(n * ZOOM_STEP);
}
/** "Fit": the zoom at which the whole frame is visible in the viewport (never above 100 %... unless the file is tiny: up to 400 %). */
export function fitZoom(frame: { width: number; height: number }, viewport: { width: number; height: number }): number {
  if (!(frame.width > 0 && frame.height > 0 && viewport.width > 0 && viewport.height > 0)) return 1;
  return clamp(Math.floor(Math.min(viewport.width / frame.width, viewport.height / frame.height) * 100) / 100, 0.05, ZOOM_MAX);
}
/** Zoom around a point: the point under the cursor (viewport coordinates) stays under the cursor. Returns the new scroll position. */
export function zoomAround(scroll: { left: number; top: number }, point: { x: number; y: number }, from: number, to: number): { left: number; top: number } {
  const k = to / from;
  return { left: Math.max(0, (scroll.left + point.x) * k - point.x), top: Math.max(0, (scroll.top + point.y) * k - point.y) };
}

/** The size of the frame at 100 %: the file's own height (1080 when unknown), the width following the format. */
export function baseFrame(ratio: number, media?: { width: number; height: number } | null): { width: number; height: number } {
  const h = media && media.height > 0 ? media.height : 1080;
  return { width: Math.round(h * ratio), height: Math.round(h) };
}

/** A box as a plain rectangle, and back. */
export const rectOf = (b: Pick<Box, "x" | "y" | "w" | "h">): PRect => ({ x: b.x, y: b.y, w: b.w, h: b.h });
