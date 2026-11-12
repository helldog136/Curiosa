import { isPlainObject } from "./model";

/**
 * TEXT SIZE OF OVERLAY ELEMENTS (core 0.11.0). Pure: no database, no Next.
 *
 * An overlay is watched like TV, from a distance, so text must stay readable on a 1920x1080 canvas. The owner sets a text size (a percentage) per page
 * (the default of every element) and optionally per element. 100 % means "no change": an element and a page at the default render byte for byte as before 0.11.0.
 *
 * HOW IT IS APPLIED (core side, universal, no change needed in any module): the core shows the element's page in a virtual window that is `100 / percent`
 * times smaller and scales that window up by `percent`. Everything inside (text, bars, icons, spacing) grows together, the layout reflows in the smaller window
 * exactly like a responsive page does when the window is smaller, and the frame on the canvas does not move. Text stays vector text, re-rasterised at its
 * final size (never a blurred bitmap). Modules that want finer control opt in with `tvScale` (see `tvFactor`).
 */
export const TEXT_SCALE_MIN = 50;
export const TEXT_SCALE_MAX = 300;
export const TEXT_SCALE_DEFAULT = 100;

/** The ready-made choices (percent). "tv" is the recommended one for a stream: the smallest text of the official elements is 10 to 13 px, which a 200 % size brings to 24 px or more. */
export const TEXT_SCALE_PRESETS = [
  { id: "small", percent: 75 },
  { id: "normal", percent: 100 },
  { id: "large", percent: 150 },
  { id: "tv", percent: 200 },
] as const;
export type TextScalePresetId = (typeof TEXT_SCALE_PRESETS)[number]["id"];

/** Broadcast legibility on a 1920x1080 canvas (px of the canvas, never of an element's own window). */
export const TV_REFERENCE_HEIGHT = 1080;
export const TV_MIN_TEXT_PX = 24;
/** The shared TV type scale, in px on a 1080 canvas (it follows the canvas height and the text size). Modules read it as `--ov-text-<step>` computed from `ov-tv`. */
export const TV_TYPE_SCALE = { xs: 24, sm: 28, md: 32, lg: 40, xl: 56, "2xl": 72 } as const;
export type TvStep = keyof typeof TV_TYPE_SCALE;

/** A percentage read from stored or received data: an integer in bounds, else null (no setting). An element may store 100 on purpose (it then ignores a larger page size); the page drops it (tokens.ts). */
export function parseTextScale(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{2,3}$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < TEXT_SCALE_MIN || n > TEXT_SCALE_MAX) return null;
  return n;
}

export type TextScaleCheck = { ok: true; value: number | null } | { ok: false };
/** Strict reading for what the editor or an AI sends: absent, null or "" means "no setting"; anything else out of bounds is refused (the form shows an error). */
export function checkTextScale(raw: unknown): TextScaleCheck {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < TEXT_SCALE_MIN || n > TEXT_SCALE_MAX) return { ok: false };
  return { ok: true, value: n };
}

/** The size an element really gets: its own setting, else the page's, else 100. */
export const effectiveTextScale = (element: number | null | undefined, page: number | null | undefined): number => element ?? page ?? TEXT_SCALE_DEFAULT;

/** Which ready-made choice a percentage is (null: "other"). */
export const presetOf = (percent: number): TextScalePresetId | null => TEXT_SCALE_PRESETS.find((p) => p.percent === percent)?.id ?? null;

/**
 * `ov-tv`: the factor an opted-in element multiplies a 1080-canvas px value by to get CSS px in its own window, so that the text is exactly that size on the canvas
 * whatever the frame scale: `px_in_window * frameScale = px_on_canvas`. Includes the canvas height (a 1280x720 canvas is watched full screen too) and the text size.
 * Four decimals, never zero.
 */
export function tvFactor(pageHeight: number, percent: number, frameScale: number): number {
  const f = (pageHeight / TV_REFERENCE_HEIGHT) * (percent / 100) / Math.max(frameScale, 0.0001);
  return Math.round(f * 10000) / 10000;
}

/** Size of a TV step in CSS px of an element's window (what `calc(<px> * var(--ov-tv))` gives). */
export const tvStepPx = (step: TvStep, factor: number): number => Math.round(TV_TYPE_SCALE[step] * factor * 100) / 100;

/** Reads the percentage of an element object coming from stored data (never throws). */
export function elementScaleOf(raw: unknown): number | null {
  return isPlainObject(raw) ? parseTextScale(raw.textScale) : null;
}
