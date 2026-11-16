/**
 * "Auto" text colour of a box (core 0.19.0): the editor reads the pixels of the picture UNDER the box and keeps the text colour (white or near black) whose
 * contrast is the best in the darkest-to-lightest worst case. Pure: pixels in (RGBA, as a canvas gives them), a colour out. Tested alone.
 */
import { ratio, type Rgb } from "@/core/overlays/appearance";
import { RESOLVED, type Box } from "./model";

const WHITE: Rgb = { r: 255, g: 255, b: 255 }, DARK: Rgb = { r: 17, g: 17, b: 17 };

/**
 * The text colour for the pixels under a box: for each candidate, the contrast that 95 % of the pixels reach at least (the 5th percentile: one stray
 * pixel does not decide); the best candidate wins. No pixel (picture not readable): white, the colour with an outline that reads everywhere.
 */
export function pickTextColour(rgba: ArrayLike<number>, step = 1): { colour: (typeof RESOLVED)[number]; ratio: number } {
  const white: number[] = [], dark: number[] = [];
  let clear = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4 * Math.max(1, step)) {
    if (rgba[i + 3]! < 16) { clear++; continue; }   // transparent: the checkerboard of the editor, not the picture
    const px = { r: rgba[i]!, g: rgba[i + 1]!, b: rgba[i + 2]! };
    white.push(ratio(WHITE, px)); dark.push(ratio(DARK, px));
  }
  // (0.21.0) mostly see-through under the box (a transparent video): what shows there is the stream, unknown here; white with its outline reads everywhere
  if (!white.length || clear > white.length) return { colour: "#ffffff", ratio: 0 };
  const p5 = (list: number[]) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length * 0.05)]!; };
  const w = p5(white), d = p5(dark);
  return w >= d ? { colour: "#ffffff", ratio: Math.round(w * 10) / 10 } : { colour: "#111111", ratio: Math.round(d * 10) / 10 };
}

/** Whether "auto" needs a measure: only for a box with (almost) no panel; a panel decides its text colour itself, and "element" follows the element's colours. */
export const needsMeasure = (b: Pick<Box, "look" | "color" | "pill">): boolean =>
  b.color === "auto" && (b.look === "bare" || (b.look === "custom" && (b.pill?.opacity ?? 85) < 30));
