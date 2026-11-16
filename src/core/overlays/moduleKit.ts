/**
 * `ctx.overlay` for overlay ELEMENTS (core 0.24.0): the shared helpers fifteen modules used to copy by hand. Pure functions: nothing is read or written.
 *
 *  - `tokens(query, selector?)`: the common-style tokens of an element page (`--ov-fg`, `--ov-surface`, `--ov-radius`, `--ov-border`), from the `ov-text`,
 *    `ov-surface` and `ov-corners` parameters the core adds to the element's address, as ONE css rule on `:root` (or the selector given). Empty when the page
 *    was opened by hand without them: the module's own fallbacks apply. Same values as the core page (`tokens.ts`), so they follow the core when it changes.
 *  - `tvFactor(query)`: the `ov-tv` factor (px of the 1080 canvas -> px of this window), 1 when absent or out of bounds.
 *  - `tvTokens(query)`: `--ov-tv` and the TV type scale `--ov-text-xs` to `--ov-text-2xl` as declarations, to put in the same rule.
 *
 * The composition kit of 0.19.0 (`composeScript`, `checkComposition`…) stays in `ctx.overlay` next to these. An older core has no `ctx.overlay.tokens`:
 * a module tests `typeof ctx.overlay?.tokens === "function"` and keeps its own copy otherwise.
 */
import { composeKit } from "../compose/kit";
import { tokenValues } from "./tokens";
import { TV_TYPE_SCALE } from "./textScale";
import type { OverlayStyle } from "./model";

type Query = URLSearchParams | string | Readonly<Record<string, string | undefined>> | null | undefined;
const params = (q: Query): URLSearchParams => (q instanceof URLSearchParams ? q : typeof q === "string" ? new URLSearchParams(q.startsWith("?") ? q.slice(1) : q) : new URLSearchParams(Object.entries(q ?? {}).filter((e): e is [string, string] => typeof e[1] === "string")));
/** Only plain selectors (`:root`, `[data-ov-region="element"]`, `#stage`): anything that could close the rule is refused. */
const SAFE_SELECTOR = /^[\w\s:#.,>*="'()[\]-]{1,120}$/;

/** The common style the address carries, or null when it does not (page opened by hand, or an element that does not follow the style). */
export function styleOf(q: Query): Pick<OverlayStyle, "text" | "corners"> & { background: "transparent" | "soft" } | null {
  const p = params(q);
  if (!p.has("ov-text")) return null;
  return { text: p.get("ov-text") === "dark" ? "dark" : "light", background: p.get("ov-surface") === "soft" ? "soft" : "transparent", corners: p.get("ov-corners") === "square" ? "square" : "round" };
}

export function elementTokens(q: Query, selector = ":root"): string {
  const style = styleOf(q);
  if (!style || !SAFE_SELECTOR.test(selector) || /[{};]/.test(selector)) return "";
  const v = tokenValues(style);
  return `${selector}{${Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";")}}`;
}

export function tvFactor(q: Query): number {
  const t = Number(params(q).get("ov-tv"));
  return t > 0 && t < 20 ? t : 1;
}

export function tvTokens(q: Query): string {
  return `--ov-tv:${tvFactor(q)};${Object.entries(TV_TYPE_SCALE).map(([step, px]) => `--ov-text-${step}:calc(${px}px*var(--ov-tv))`).join(";")};`;
}

export const elementKit = Object.freeze({ tokens: elementTokens, tvFactor, tvTokens, styleOf });
/** What `ctx.overlay` is: the composition kit (0.19.0) and the element helpers (0.24.0). */
export const overlayKit = Object.freeze({ ...composeKit, ...elementKit });
export type OverlayKit = typeof overlayKit;
