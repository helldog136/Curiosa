/**
 * Analyse de couleurs CSS pour le contrôle de lisibilité (docs/SKINS.md §7) et l'assainisseur.
 *
 * Formes acceptées : `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (syntaxe à virgules ou à espaces,
 * nombres ou pourcentages, opacité après `/`), `hsl()`/`hsla()`, `oklch()` (§6.3 l'autorise) et une trentaine de noms
 * CSS courants plus `transparent`. Tout le reste (`var()`, `color-mix()`, `currentcolor`, dégradés…) est refusé
 * proprement (`null`), jamais par une exception : c'est à l'appelant de fournir des couleurs déjà résolues.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Readonly<Record<string, string>> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  cyan: "#00ffff", aqua: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", olive: "#808000", lime: "#00ff00", teal: "#008080", navy: "#000080",
  purple: "#800080", orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700", indigo: "#4b0082",
  violet: "#ee82ee", tomato: "#ff6347", salmon: "#fa8072", coral: "#ff7f50", crimson: "#dc143c", khaki: "#f0e68c",
  ivory: "#fffff0", beige: "#f5f5dc", tan: "#d2b48c", orchid: "#da70d6", plum: "#dda0dd", turquoise: "#40e0d0",
  skyblue: "#87ceeb", steelblue: "#4682b4", royalblue: "#4169e1", slategray: "#708090", slategrey: "#708090",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", dimgray: "#696969", dimgrey: "#696969",
  darkred: "#8b0000", darkgreen: "#006400", darkblue: "#00008b", lightblue: "#add8e6", lightgreen: "#90ee90",
  whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", lavender: "#e6e6fa", linen: "#faf0e6", snow: "#fffafa",
  chocolate: "#d2691e", firebrick: "#b22222", hotpink: "#ff69b4", deeppink: "#ff1493", rebeccapurple: "#663399",
  forestgreen: "#228b22", seagreen: "#2e8b57", midnightblue: "#191970", darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f",
};

/** Longueur maximale acceptée avant toute analyse (évite de travailler sur de gros textes). */
const MAX_COLOR_LENGTH = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(clamp(v, 0, 255));

function parseHex(s: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (!m) return null;
  let h = m[1]!;
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;

/** Nombre ou pourcentage → { value, pct }, ou null. */
function num(token: string): { value: number; pct: boolean } | null {
  const pct = token.endsWith("%");
  const body = pct ? token.slice(0, -1) : token;
  if (!NUM.test(body)) return null;
  const value = Number(body);
  return Number.isFinite(value) ? { value, pct } : null;
}

/** Sépare « a b c / d » ou « a, b, c, d » en canaux et opacité. */
function channels(inner: string): { parts: string[]; alpha: string | null } | null {
  const s = inner.trim();
  if (s.includes(",")) {
    if (s.includes("/")) return null;
    const parts = s.split(",").map((p) => p.trim());
    if (parts.length === 3) return { parts, alpha: null };
    if (parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3]! };
    return null;
  }
  const [main, alpha, extra] = s.split("/").map((p) => p.trim());
  if (extra !== undefined || main === undefined) return null;
  const parts = main.split(/\s+/);
  if (parts.length !== 3) return null;
  return { parts, alpha: alpha ?? null };
}

function parseAlpha(token: string | null): number | null {
  if (token === null) return 1;
  const n = num(token);
  if (!n) return null;
  return clamp(n.pct ? n.value / 100 : n.value, 0, 1);
}

function parseRgb(inner: string): Rgba | null {
  const ch = channels(inner);
  if (!ch) return null;
  const vals = ch.parts.map(num);
  if (vals.some((v) => v === null)) return null;
  const v = vals as { value: number; pct: boolean }[];
  const c = v.map((x) => (x.pct ? (x.value / 100) * 255 : x.value));
  const a = parseAlpha(ch.alpha);
  if (a === null) return null;
  return { r: round(c[0]!), g: round(c[1]!), b: round(c[2]!), a };
}

function hueOf(token: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? "deg";
  const deg = unit === "deg" ? n : unit === "grad" ? n * 0.9 : unit === "rad" ? (n * 180) / Math.PI : n * 360;
  return ((deg % 360) + 360) % 360;
}

function parseHsl(inner: string): Rgba | null {
  const ch = channels(inner);
  if (!ch) return null;
  const h = hueOf(ch.parts[0]!);
  const s = num(ch.parts[1]!);
  const l = num(ch.parts[2]!);
  const a = parseAlpha(ch.alpha);
  if (h === null || !s || !l || a === null) return null;
  const sat = clamp(s.pct ? s.value / 100 : s.value / 100, 0, 1);
  const lig = clamp(l.pct ? l.value / 100 : l.value / 100, 0, 1);
  const k = (n: number) => (n + h / 30) % 12;
  const amp = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - amp * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: round(f(0) * 255), g: round(f(8) * 255), b: round(f(4) * 255), a };
}

const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parseOklch(inner: string): Rgba | null {
  const ch = channels(inner);
  if (!ch) return null;
  const l = num(ch.parts[0]!);
  const c = num(ch.parts[1]!);
  const h = hueOf(ch.parts[2]!);
  const a = parseAlpha(ch.alpha);
  if (!l || !c || h === null || a === null) return null;
  const L = clamp(l.pct ? l.value / 100 : l.value, 0, 1);
  const C = Math.max(0, c.pct ? (c.value / 100) * 0.4 : c.value);
  const hr = (h * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => encode(clamp(v, 0, 1)) * 255);
  return { r: round(lin[0]!), g: round(lin[1]!), b: round(lin[2]!), a };
}

/** Analyse une couleur CSS. `null` si elle n'est pas comprise (jamais d'exception). */
export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_COLOR_LENGTH) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) return parseHex(s);
  const named = NAMED[s];
  if (named) return parseHex(named);
  const fn = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/.exec(s);
  if (!fn) return null;
  const [, name, inner] = fn;
  if (name === "rgb" || name === "rgba") return parseRgb(inner!);
  if (name === "hsl" || name === "hsla") return parseHsl(inner!);
  return parseOklch(inner!);
}

/** Les noms CSS reconnus (pour les tests et l'aide). */
export const NAMED_COLORS: readonly string[] = Object.keys(NAMED);

const hex2 = (n: number) => round(n).toString(16).padStart(2, "0");
/** `#rrggbb` (opaque) ou `#rrggbbaa` si l'opacité est inférieure à 1. */
export function toHex({ r, g, b, a }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;
}
