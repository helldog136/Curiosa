import { isPlainObject } from "./model";
import type { OverlayStyle } from "./model";
import { OPAQUE_SURFACE } from "./tokens";
import type { SkinColors } from "./skinSheet";

/**
 * APPEARANCE KIT OF AN OVERLAY ELEMENT (core 0.17.0). Pure: no database, no Next, no browser. Used by the editor (client), the page validation and the
 * public page renderer, so what the editor shows is what OBS shows.
 *
 * Every element that follows the common style gets the same kit, without any change in its module: a readability preset, the text colour (auto, light,
 * dark) and, folded, the background (none, soft, solid, glass), its opacity and colour, the text outline and the corners. The core compiles the choice into
 * a small sheet adopted INSIDE the element's frame (the same mechanism as overlay skins and the "Opaque" background, see render.ts): the tokens are forced
 * on the whole document (`html, html *`, `!important`), which also beats a token a module writes inline on its own stage. The core never paints the
 * element's outer frame: a module that hides its panel when idle stays invisible (no empty box).
 *
 * Priority, from the weakest: module fallback < skin < (site retouch: later) < page style < element style. An absent setting means "inherit": nothing is
 * stored at the default. ONE exception, decided by the owner: an element that follows the style on a page with a transparent background and no skin was
 * unreadable over a video (white text, no background, no outline). Such an element gets "Readable everywhere" automatically (`source: "auto"`); the
 * person can pick "No background, outlined text" to go back to a bare look.
 */
export const LOOK_PRESETS = ["readable", "discreet", "bare"] as const;
export type LookPreset = (typeof LOOK_PRESETS)[number];
export const LOOK_TEXT = ["auto", "light", "dark"] as const;
export const LOOK_BACKGROUND = ["none", "soft", "solid", "glass"] as const;
export const LOOK_OUTLINE = ["none", "thin", "thick"] as const;
export const LOOK_CORNERS = ["round", "square"] as const;
export const OPACITY_MIN = 0;
export const OPACITY_MAX = 100;
export const OPACITY_STEP = 5;
/** Below this background opacity, a text outline is always drawn (white text over a black background at 65 % keeps 7:1 even over a white video). */
export const OUTLINE_BELOW = 65;
/** Contrast targets (WCAG): text 4.5:1 (the editor warns below), accent marks 3:1 against the background. */
export const TEXT_MIN_RATIO = 4.5;
export const ACCENT_MIN_RATIO = 3;

export type ElementStyle = {
  preset?: LookPreset;
  text?: (typeof LOOK_TEXT)[number];
  background?: (typeof LOOK_BACKGROUND)[number];
  /** 0 to 100, steps of 5. */
  opacity?: number;
  /** #rrggbb. Absent: a dark panel under light text, a light panel under dark text. */
  color?: string;
  outline?: (typeof LOOK_OUTLINE)[number];
  corners?: (typeof LOOK_CORNERS)[number];
  /** (0.21.0) The background and text colours come from the skin the element wears (its optional kit tokens, or derived). Ignored when `color` is set or no skin is worn. */
  colorFrom?: "skin";
};
/** The fine settings (under "More options"): when one is set, the preset control shows "Custom". */
export const FINE_KEYS = ["background", "opacity", "color", "outline", "corners", "colorFrom"] as const;

type Base = { text: "auto" | "light" | "dark"; background: (typeof LOOK_BACKGROUND)[number]; opacity: number; outline: (typeof LOOK_OUTLINE)[number] };
export const PRESET_VALUES: Record<LookPreset, Base> = {
  readable: { text: "auto", background: "solid", opacity: 85, outline: "thin" },
  discreet: { text: "auto", background: "soft", opacity: 55, outline: "thin" },
  bare: { text: "light", background: "none", opacity: 0, outline: "thick" },
};
/** The opacity a background kind starts with when it is chosen on its own. */
export const KIND_OPACITY: Record<(typeof LOOK_BACKGROUND)[number], number> = { none: 0, soft: 55, solid: 85, glass: 60 };
/** The look new elements start with (owner decision 2), on a page without a readability default. On a page with one, a new element follows the page. */
export const NEW_ELEMENT_STYLE: ElementStyle = { preset: "readable" };
/** (0.21.0) The readability default of a NEW page: it starts readable, and its elements follow it. Pages created before keep no default (no visual change). */
export const NEW_PAGE_READABILITY: ElementStyle = { preset: "readable" };

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly unknown[]).includes(v) ? (v as T) : undefined;

/** Reads a stored element style without ever throwing: unknown values are dropped, an empty result is null (= follows the page). */
export function parseElementStyle(raw: unknown): ElementStyle | null {
  if (!isPlainObject(raw)) return null;
  const out: ElementStyle = {};
  const preset = pick(LOOK_PRESETS, raw.preset); if (preset) out.preset = preset;
  const text = pick(LOOK_TEXT, raw.text); if (text) out.text = text;
  const background = pick(LOOK_BACKGROUND, raw.background); if (background) out.background = background;
  if (typeof raw.opacity === "number" && Number.isInteger(raw.opacity) && raw.opacity >= OPACITY_MIN && raw.opacity <= OPACITY_MAX) out.opacity = raw.opacity;
  if (typeof raw.color === "string" && HEX.test(raw.color)) out.color = raw.color.toLowerCase();
  const outline = pick(LOOK_OUTLINE, raw.outline); if (outline) out.outline = outline;
  const corners = pick(LOOK_CORNERS, raw.corners); if (corners) out.corners = corners;
  if (raw.colorFrom === "skin") out.colorFrom = "skin";
  return Object.keys(out).length ? out : null;
}

export type StyleCheck = { ok: true; value: ElementStyle | null } | { ok: false; field: "preset" | "text" | "background" | "opacity" | "color" | "outline" | "corners" | "colorFrom" | "format" };
/** Strict reading of what the editor or an AI sends: absent/null = follows the page; anything unknown or out of bounds is refused with the field to fix. */
export function checkElementStyle(raw: unknown): StyleCheck {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isPlainObject(raw)) return { ok: false, field: "format" };
  const lists = { preset: LOOK_PRESETS, text: LOOK_TEXT, background: LOOK_BACKGROUND, outline: LOOK_OUTLINE, corners: LOOK_CORNERS } as const;
  for (const [k, list] of Object.entries(lists)) if (raw[k] !== undefined && !(list as readonly unknown[]).includes(raw[k])) return { ok: false, field: k as keyof typeof lists };
  if (raw.opacity !== undefined && (typeof raw.opacity !== "number" || !Number.isInteger(raw.opacity) || raw.opacity < OPACITY_MIN || raw.opacity > OPACITY_MAX)) return { ok: false, field: "opacity" };
  if (raw.color !== undefined && (typeof raw.color !== "string" || !HEX.test(raw.color))) return { ok: false, field: "color" };
  if (raw.colorFrom !== undefined && raw.colorFrom !== "skin") return { ok: false, field: "colorFrom" };
  return { ok: true, value: parseElementStyle(raw) };
}

/** Which preset the control shows: a preset without fine settings, "custom" when a fine setting is set, "page" when nothing is stored. */
export function presetShown(style: ElementStyle | null | undefined): LookPreset | "custom" | "page" {
  if (!style) return "page";
  if (FINE_KEYS.some((k) => style[k] !== undefined)) return "custom";
  return style.preset ?? "readable";
}

// ── Colour maths (WCAG 2.x), kept here so the editor bundle does not pull the skin checker ──────────────────────────────────
export type Rgb = { r: number; g: number; b: number };
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = (c: Rgb): number => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export const ratio = (a: Rgb, b: Rgb): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const hexRgb = (hex: string): Rgb => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
/** A colour at `alpha` (0 to 1) over an opaque base, rounded like a browser does. */
export const over = (c: Rgb, alpha: number, base: Rgb): Rgb => ({ r: Math.round(c.r * alpha + base.r * (1 - alpha)), g: Math.round(c.g * alpha + base.g * (1 - alpha)), b: Math.round(c.b * alpha + base.b * (1 - alpha)) });
const WHITE: Rgb = { r: 255, g: 255, b: 255 }, BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const FG = { light: "#ffffff", dark: "#111111" } as const;
/** Worst contrast of a text colour over a background at `alpha`, the video behind being pure white or pure black. */
export function worstContrast(fg: string, surface: string, alpha: number): number {
  const f = hexRgb(fg), s = hexRgb(surface);
  return Math.min(ratio(f, over(s, alpha, WHITE)), ratio(f, over(s, alpha, BLACK)));
}
/** The minimal opacity of `surface` under `fg` for a worst-case ratio (search by steps of 1 %); null when even 100 % is not enough. */
export function minimalOpacity(fg: string, surface: string, target: number): number | null {
  for (let a = 0; a <= 100; a++) if (worstContrast(fg, surface, a / 100) >= target) return a;
  return null;
}
/** An accent colour that keeps 3:1 against the background: the same hue moved toward white or black until it does (the accent is left as is when it already does). */
export function accentFor(accent: string, surface: string, alpha: number, target = ACCENT_MIN_RATIO): string {
  const a = hexRgb(accent), s = hexRgb(surface);
  const backs = [over(s, alpha, WHITE), over(s, alpha, BLACK)];
  const worst = (c: Rgb) => Math.min(...backs.map((b) => ratio(c, b)));
  if (worst(a) >= target) return accent.toLowerCase();
  const toward = luminance(over(s, alpha, BLACK)) < 0.18 ? WHITE : BLACK;
  for (let k = 1; k <= 20; k++) { const c = over(toward, k / 20, a); if (worst(c) >= target) return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`; }
  return toward === WHITE ? "#ffffff" : "#000000";
}

// ── What applies to an element ───────────────────────────────────────────────────────────────────────────────────────────
export type Applied = {
  /** "element": its own setting; "page" (0.21.0): the readability default of the page; "auto": the readability fix of an element left unreadable by the page (transparent background, no skin). */
  source: "element" | "page" | "auto";
  text: "light" | "dark";
  background: (typeof LOOK_BACKGROUND)[number];
  /** 0 to 100 (0 when there is no background). */
  opacity: number;
  /** #rrggbb of the background (also given with no background: the outline is drawn in the colour opposite to the text). */
  color: string;
  outline: (typeof LOOK_OUTLINE)[number];
  /** The outline was added because the background is under 65 %. */
  outlineForced: boolean;
  corners?: (typeof LOOK_CORNERS)[number];
  /** (0.21.0) Text and outline colours taken from the skin (absent: #ffffff / #111111 and the opposite outline). */
  fg?: string;
  outlineColor?: string;
};
export type PageSide = { style: Pick<OverlayStyle, "text" | "background" | "readability">; /** The page wears an overlay skin (default skin or skin per context). */ skin: boolean };

/** The appearance the core applies to an element, or null: the page style and the skin apply as before 0.17.0, nothing is injected. */
export function appliedLook(style: ElementStyle | null | undefined, page: PageSide, follows: boolean, /** (0.21.0) The kit colours of the skin the element wears now. */ skin?: SkinColors | null): Applied | null {
  if (!follows) return null;
  let s: ElementStyle, source: Applied["source"];
  if (style) { s = style; source = "element"; }
  else if (page.style.readability) { s = page.style.readability; source = "page"; }
  else if (!page.skin && page.style.background === "transparent") { s = { preset: "readable", ...(page.style.text === "dark" ? { text: "dark" } : {}) }; source = "auto"; }
  else return null;
  const base = PRESET_VALUES[s.preset ?? "readable"];
  const background = s.background ?? base.background;
  const opacity = background === "none" ? 0 : s.opacity ?? (s.background !== undefined && s.background !== base.background ? KIND_OPACITY[background] : base.opacity);
  const want = s.text ?? base.text;
  const kit = !s.color && s.colorFrom === "skin" && skin ? skin : null;
  const color = s.color ?? (kit ? (background === "soft" ? kit.soft : kit.solid) : want === "dark" ? OPAQUE_SURFACE.dark : OPAQUE_SURFACE.light);
  const pair = kit ? { light: kit.onDark, dark: kit.onLight } : FG;
  const text: "light" | "dark" = want !== "auto" ? want : background === "none" ? "light" : worstContrast(pair.light, color, opacity / 100) >= worstContrast(pair.dark, color, opacity / 100) ? "light" : "dark";
  const chosen = s.outline ?? base.outline;
  const outlineForced = chosen === "none" && opacity < OUTLINE_BELOW;
  return { source, text, background, opacity, color, outline: outlineForced ? "thin" : chosen, outlineForced, ...(s.corners ? { corners: s.corners } : {}), ...(kit ? { fg: pair[text], ...(kit.outline ? { outlineColor: kit.outline } : {}) } : {}) };
}

export type Readability = { ok: boolean; ratio: number | null };
/** Worst-case readability of an applied look (null look: decided by the page or its skin, which the skin checker already guarantees). */
export function readabilityOf(a: Applied | null): Readability {
  if (!a) return { ok: true, ratio: null };
  const r = a.background === "none" ? null : Math.round(worstContrast(a.fg ?? FG[a.text], a.color, a.opacity / 100) * 10) / 10;
  return { ok: a.outline !== "none" || (r !== null && r >= TEXT_MIN_RATIO), ratio: r };
}

// ── The sheet ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Same reserved parts as the skin mapping (skinSheet.ts): containers take the background, text parts the text colour. */
export const CONTAINER_PARTS = ["panel", "card", "bubble", "quote"] as const;
export const TEXT_PARTS = ["title", "name", "body", "text", "message", "detail", "content", "summary", "value", "stat", "list", "label", "status", "game", "clock"] as const;
/** The `:not(#…)` raises the specificity above any skin or "Opaque" rule (they never use an id), so the element setting wins (priority above). */
const ROOT = 'html[data-ov-look]:not(#ov-look)';
/** (0.19.0) The region a composition is drawn in (compose/render.ts): the kit gives it its tokens, never its text colours or outline. */
export const COMPOSITION = '[data-ov-region="composition"]';
const rgba = (hex: string, alpha: number) => { const c = hexRgb(hex); return `rgba(${c.r},${c.g},${c.b},${Math.round(alpha * 100) / 100})`; };
export function outlineShadow(kind: Applied["outline"], text: Applied["text"], colour?: string): string {
  if (kind === "none") return "none";
  const c = colour ? rgba(colour, 0.92) : text === "light" ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.95)";
  const d = kind === "thick" ? 2 : 1, blur = kind === "thick" ? 6 : 4;
  return `${-d}px ${-d}px 0 ${c},${d}px ${-d}px 0 ${c},${-d}px ${d}px 0 ${c},${d}px ${d}px 0 ${c},0 0 ${blur}px ${c}`;
}

/** The tokens of an applied look. */
export function lookTokens(a: Applied): Record<string, string> {
  const fg = a.fg ?? FG[a.text];
  const none = a.background === "none";
  return {
    "--ov-fg": fg,
    "--ov-muted": fg,
    "--ov-surface": none ? "transparent" : rgba(a.color, a.opacity / 100),
    "--ov-border": none ? "transparent" : a.text === "light" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)",
    "--ov-text-shadow": outlineShadow(a.outline, a.text, a.outlineColor),
    ...(a.corners ? { "--ov-radius": a.corners === "round" ? "12px" : "0px" } : {}),
  };
}

/** The sheet adopted into the element's frame. Never touches the frame outside the element, nor `html`/`body` backgrounds. */
export function lookCss(a: Applied): string {
  const t = lookTokens(a);
  const parts = (list: readonly string[]) => list.map((p) => `${ROOT} [data-ov-part="${p}"]`).join(",");
  return [
    `${ROOT},${ROOT} *{${Object.entries(t).map(([k, v]) => `${k}:${v}!important`).join(";")}}`,
    `${ROOT}{color:var(--ov-fg)${a.outline !== "none" ? ";text-shadow:var(--ov-text-shadow)" : ""}}`,
    `${parts(CONTAINER_PARTS)}{background-color:var(--ov-surface);color:var(--ov-fg);border-color:var(--ov-border)${a.background === "glass" ? ";-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)" : ""}${a.corners ? ";border-radius:var(--ov-radius)" : ""}}`,
    `${parts(TEXT_PARTS)}{color:var(--ov-fg)}`,
    // Under 65 % the video shows through: every text (a module's own coloured title too) gets the outline, which then carries the contrast.
    // (0.19.0) Except the texts of a composition: each box carries its own colour and outline (compose/render.ts), which this rule would override.
    ...(a.outline !== "none" && a.opacity < OUTLINE_BELOW ? [`${ROOT} *:not(${COMPOSITION},${COMPOSITION} *){text-shadow:var(--ov-text-shadow)!important}`] : []),
  ].join("\n");
}

