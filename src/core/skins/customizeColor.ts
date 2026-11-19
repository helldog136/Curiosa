/** Small colour maths for the free-colour range of a customization colour (OKLCH, sRGB). PURE. */

export type Rgb = { r: number; g: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number): number => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = (v: number): number => { const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return s * 255; };

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) } : null;
}
export const rgbToHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  return { l: L, c, h: c < 1e-6 ? 0 : (Math.atan2(B, A) * 180) / Math.PI };
}

/** Unclamped linear sRGB of an OKLCH colour (used to test the gamut). */
function linearOf({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
}
const inGamut = (v: [number, number, number]): boolean => v.every((x) => x >= -0.0005 && x <= 1.0005);

/** The colour in sRGB; a colour outside the gamut loses chroma (never hue or lightness) until it fits. */
export function oklchToRgb(color: Oklch): Rgb {
  let c = color.c;
  let lin = linearOf({ ...color, c });
  if (!inGamut(lin)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(linearOf({ ...color, c: mid }))) lo = mid; else hi = mid; }
    c = lo;
    lin = linearOf({ ...color, c });
  }
  return { r: fromLinear(Math.min(1, Math.max(0, lin[0]))), g: fromLinear(Math.min(1, Math.max(0, lin[1]))), b: fromLinear(Math.min(1, Math.max(0, lin[2]))) };
}
