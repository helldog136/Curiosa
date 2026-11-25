/**
 * VIEW TOOLS OF THE OVERLAY PAGE EDITOR (core 0.20.0). Pure: no database, no Next, no browser. These are editor views, never page data: nothing here is
 * stored on the page or sent to OBS. The public page stays transparent and its security rules (`img-src 'none'`) do not change.
 *
 *  - preview backgrounds: what the editor shows BEHIND the page preview (checkerboard, dark video, bright video, game scene, the person's own screenshot);
 *  - safe margins: the action zone (3.5 % of each edge) and the text zone (5 %), plus the "Vertical format" bands where phone apps put their buttons;
 *  - colour-blind simulation: colour matrices applied to the preview only (Machado, Oliveira and Fernandes 2009, full severity, linear RGB).
 */
import type { Size } from "./layout";

export const PREVIEW_BACKDROPS = ["checker", "dark", "bright", "game", "own"] as const;
export type PreviewBackdrop = (typeof PREVIEW_BACKDROPS)[number];

/** The colour scheme the overlay page declares for itself (`color-scheme:normal`, see `BASE_CSS` in render.ts). The editor's preview frame must declare the
 * same one: if the schemes differ, the browser paints an opaque sheet behind the transparent page and the preview background disappears. */
export const PREVIEW_FRAME_SCHEME = "light";

/** CSS backgrounds drawn by the core: no file, no address, nothing loaded. The game scene mixes a bright sky, a sun, hills and a dark HUD corner, so a
 * readable element must read over bright AND dark parts. */
export const BACKDROP_CSS: Record<Exclude<PreviewBackdrop, "own">, { backgroundColor: string; backgroundImage?: string; backgroundSize?: string; backgroundPosition?: string; backgroundRepeat?: string }> = {
  checker: {
    backgroundColor: "#ffffff",
    backgroundImage: "linear-gradient(45deg,#d6d6d6 25%,transparent 25%),linear-gradient(-45deg,#d6d6d6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d6d6d6 75%),linear-gradient(-45deg,transparent 75%,#d6d6d6 75%)",
    backgroundSize: "20px 20px", backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
  },
  dark: {
    backgroundColor: "#0d0f14",
    backgroundImage: "radial-gradient(circle at 28% 38%,#34466a 0,transparent 38%),radial-gradient(circle at 76% 68%,#5a2636 0,transparent 34%),radial-gradient(circle at 60% 18%,#1f3a3a 0,transparent 30%)",
  },
  bright: {
    backgroundColor: "#fbfbf6",
    backgroundImage: "radial-gradient(circle at 24% 30%,#ffffff 0,transparent 45%),radial-gradient(circle at 72% 66%,#ffe7b0 0,transparent 42%),linear-gradient(135deg,#e6f0ff,#fdfdf6 60%,#fff4d6)",
  },
  game: {
    backgroundColor: "#7ec8f0",
    backgroundImage: [
      "linear-gradient(#0b0e14d9,#0b0e14d9)",                                                   // HUD corner (dark)
      "radial-gradient(circle at 80% 20%,#fffbe0 0 5%,#ffe58a 6%,transparent 12%)",          // sun
      "radial-gradient(ellipse 45% 26% at 22% 82%,#3f8f3f 0 98%,transparent 100%)",            // hills
      "radial-gradient(ellipse 60% 30% at 78% 92%,#2d6b2d 0 98%,transparent 100%)",
      "linear-gradient(transparent 74%,#5a432b 74%)",                                          // ground
      "linear-gradient(#5fb4ea,#d9f1ff 70%)",                                                  // sky
    ].join(","),
    backgroundSize: "26% 12%,100% 100%,100% 100%,100% 100%,100% 100%,100% 100%",
    backgroundPosition: "3% 94%,0 0,0 0,0 0,0 0,0 0",
    backgroundRepeat: "no-repeat",
  },
};

/** "Your screenshot" stays in the person's browser (never uploaded, never on the public page). Larger files are shown but not remembered. */
export const OWN_BACKDROP_MAX_BYTES = 2_000_000;
export const isPreviewBackdrop = (v: unknown): v is PreviewBackdrop => typeof v === "string" && (PREVIEW_BACKDROPS as readonly string[]).includes(v);

// ── Safe margins ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const SAFE_MODES = ["none", "broadcast", "vertical"] as const;
export type SafeMode = (typeof SAFE_MODES)[number];
export const isSafeMode = (v: unknown): v is SafeMode => typeof v === "string" && (SAFE_MODES as readonly string[]).includes(v);
/** Share of each edge (usual broadcast values for 16:9): actions stay inside 3.5 %, text inside 5 %. */
export const ACTION_SAFE = 0.035;
export const TEXT_SAFE = 0.05;
/** "Vertical format": a band at the bottom and a column on the right where phone apps put their buttons and captions. */
export const VERTICAL_BOTTOM = 0.2;
export const VERTICAL_RIGHT = 0.12;

export type SafeRect = { kind: "action" | "text" | "app"; x: number; y: number; w: number; h: number };
/** Rectangles to draw, in page pixels. "action" and "text" are frames (the inside is safe); "app" is a reserved band (the inside is covered). */
export function safeAreas(mode: SafeMode, page: Size): SafeRect[] {
  if (mode === "none") return [];
  const inset = (share: number, kind: "action" | "text"): SafeRect => {
    const dx = Math.round(page.width * share), dy = Math.round(page.height * share);
    return { kind, x: dx, y: dy, w: page.width - 2 * dx, h: page.height - 2 * dy };
  };
  const out = [inset(ACTION_SAFE, "action"), inset(TEXT_SAFE, "text")];
  if (mode === "vertical") {
    const bh = Math.round(page.height * VERTICAL_BOTTOM), rw = Math.round(page.width * VERTICAL_RIGHT);
    out.push({ kind: "app", x: 0, y: page.height - bh, w: page.width, h: bh }, { kind: "app", x: page.width - rw, y: 0, w: rw, h: page.height - bh });
  }
  return out;
}

/** The lines a frame snaps to, besides the page edges and centre: the edges of the safe zones. */
export function safeLines(mode: SafeMode, page: Size): { x: number[]; y: number[] } {
  const xs = new Set<number>(), ys = new Set<number>();
  for (const r of safeAreas(mode, page)) {
    if (r.kind === "app") { if (r.y > 0) ys.add(r.y); if (r.x > 0) xs.add(r.x); continue; }
    xs.add(r.x); xs.add(r.x + r.w); ys.add(r.y); ys.add(r.y + r.h);
  }
  return { x: [...xs].sort((a, b) => a - b), y: [...ys].sort((a, b) => a - b) };
}

/** True when a frame leaves the text zone (or covers a phone band): the editor shows "Near the edge" on it. A hint, never a block. */
export function nearEdge(rect: { x: number; y: number; w: number; h: number }, mode: SafeMode, page: Size): boolean {
  if (mode === "none") return false;
  const zones = safeAreas(mode, page);
  const text = zones.find((z) => z.kind === "text")!;
  if (rect.x < text.x || rect.y < text.y || rect.x + rect.w > text.x + text.w || rect.y + rect.h > text.y + text.h) return true;
  return zones.some((z) => z.kind === "app" && rect.x < z.x + z.w && rect.x + rect.w > z.x && rect.y < z.y + z.h && rect.y + rect.h > z.y);
}

// ── Colour-blind simulation ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const CVD_MODES = ["none", "deuteranopia", "protanopia", "tritanopia"] as const;
export type CvdMode = (typeof CVD_MODES)[number];
export const isCvdMode = (v: unknown): v is CvdMode => typeof v === "string" && (CVD_MODES as readonly string[]).includes(v);
/** 3×3 matrices in linear RGB (SVG filters work in linear RGB by default). Each row sums to about 1: white stays white, black stays black. */
export const CVD_MATRICES: Record<Exclude<CvdMode, "none">, readonly [number, number, number, number, number, number, number, number, number]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
/** The `values` of an SVG `feColorMatrix type="matrix"` (4 rows of 5: red, green, blue, alpha, offset). */
export function cvdFilterValues(mode: Exclude<CvdMode, "none">): string {
  const m = CVD_MATRICES[mode];
  return [[m[0], m[1], m[2], 0, 0], [m[3], m[4], m[5], 0, 0], [m[6], m[7], m[8], 0, 0], [0, 0, 0, 1, 0]].map((r) => r.join(" ")).join("  ");
}
/** Applies a matrix to one sRGB colour (0-255), through linear RGB, as the browser filter does. For tests and the readability check. */
export function simulateCvd(rgb: [number, number, number], mode: CvdMode): [number, number, number] {
  if (mode === "none") return rgb;
  const lin = rgb.map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const m = CVD_MATRICES[mode];
  const out = [0, 1, 2].map((i) => m[i * 3]! * lin[0]! + m[i * 3 + 1]! * lin[1]! + m[i * 3 + 2]! * lin[2]!);
  return out.map((v) => { const c = Math.min(1, Math.max(0, v)); return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)); }) as [number, number, number];
}

// ── Editor history document ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One step of undo: the size, the common style and the elements (the name has the text field's own undo). Compared by value, so a click that changes
 * nothing is not a step. */
export const sameDoc = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
