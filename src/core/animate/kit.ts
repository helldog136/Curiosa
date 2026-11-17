/**
 * `ctx.overlay` animation helpers (core 0.30.0): what a module needs to show an animated gauge, levels or counter in an overlay element, without importing
 * the core. Pure functions only: nothing is read or written.
 *
 *  - `animateScript()`: the engine (engine.ts) and its contract table (spec.ts), as ONE self-contained page script. It installs `window.CuriosaAnimate`.
 *  - `animateContract` / `animateVersion` / `animateGenres`: what this core understands (a module tests them before it relies on a genre).
 *  - `checkAnimateState(raw)`: the same checker the engine applies, with the problems listed (a module's tests use it).
 *  - `checkAnimation(raw)`: the checker of a skin's `animation.json` (recipe.ts), for authors' tools.
 *  - `animateOptions()`: the two element options a module copies into its `overlayElements[].options` (effects quality, calm motion) so every animated
 *    element offers the same two settings with the same words.
 *  - `animateKitPage(opts)`: a self-contained HTML page that draws one state with one recipe at a frozen instant (screenshots, measurements, the assistant's
 *    own browser). Nothing runs on the site.
 *
 * An older core has none of these: a module tests `typeof ctx.overlay?.animateScript === "function"` and, without it, shows its numbers as text.
 */
import { animateEngine } from "./engine";
import { ANIMATE_CONTRACT, ANIMATE_SPEC, ANIMATE_VERSION, GENRES } from "./spec";
import { checkAnimation } from "./recipe";
import { checkAnimateState } from "./state";

const jsonForScript = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, "");

/** The engine as page script: `(function(win, SPEC){…})(window, {…});`. */
export function animateScript(): string {
  return `(${animateEngine.toString()})(window,${jsonForScript(ANIMATE_SPEC)});`;
}

/** The two options an animated element offers (copy them into module.json; the engine reads `opt-animQuality` and `opt-animCalm` from its address). */
export function animateOptions(): unknown[] {
  return [
    { id: "animQuality", type: "choice", label: { en: "Effects", fr: "Effets" }, help: { en: "Lighter effects for a slower computer.", fr: "Des effets plus légers pour un ordinateur lent." }, default: "auto", choices: [{ value: "auto", label: { en: "Automatic", fr: "Automatiques" } }, { value: "full", label: { en: "All", fr: "Tous" } }, { value: "light", label: { en: "Light", fr: "Légers" } }, { value: "minimal", label: { en: "None", fr: "Aucun" } }] },
    { id: "animCalm", type: "boolean", label: { en: "Calm motion", fr: "Mouvements calmes" }, help: { en: "No flashes, shakes or flying pieces.", fr: "Sans éclairs, secousses ni éclats qui volent." }, default: false },
  ];
}

export type AnimateKitOptions = {
  state: unknown;
  recipe?: unknown;
  width?: number;
  height?: number;
  /** Instant drawn (ms, the same clock as the state's times). Absent: the page plays live from `startAt` (or now). */
  at?: number | null;
  startAt?: number;
  quality?: "auto" | "full" | "light" | "minimal";
  calm?: boolean;
  lang?: "fr" | "en";
  tokens?: { fg?: string; accent?: string; surface?: string };
  font?: string;
  background?: "checker" | "dark" | "light" | "transparent" | "stream";
  title?: string;
};

const BACKGROUNDS = {
  checker: "background-color:#fff;background-image:linear-gradient(45deg,#d6d6d6 25%,transparent 25%),linear-gradient(-45deg,#d6d6d6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d6d6d6 75%),linear-gradient(-45deg,transparent 75%,#d6d6d6 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0",
  dark: "background:#16181d", light: "background:#f4f4f2", transparent: "background:transparent",
  stream: "background:linear-gradient(135deg,#1d2b53 0%,#7e2553 38%,#ab5236 62%,#2b3a2e 100%)",
} as const;
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A page that draws one frame (`at` given: `<html data-ready="1">` once drawn) or plays live. `window.__anim` is the mounted handle (stats for measurements).
 * The data is embedded as JSON with `<` escaped; no network, no secret.
 */
export function animateKitPage(o: AnimateKitOptions): string {
  const w = Math.min(4096, Math.max(80, Math.round(o.width ?? 1280)));
  const h = Math.min(2160, Math.max(40, Math.round(o.height ?? 360)));
  const bg = BACKGROUNDS[o.background ?? "checker"] ?? BACKGROUNDS.checker;
  const data = jsonForScript({ state: o.state, recipe: o.recipe ?? null, at: typeof o.at === "number" ? o.at : null, startAt: o.startAt ?? null, quality: o.quality ?? "full", calm: !!o.calm, lang: o.lang ?? "en", tokens: o.tokens ?? {}, font: o.font ?? "" });
  return `<!doctype html>
<html lang="${o.lang === "fr" ? "fr" : "en"}"><head><meta charset="utf-8"><title>${escHtml(o.title ?? "Animation")}</title><meta name="viewport" content="width=${w}">
<style>html,body{margin:0;background:transparent}#stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;${bg}}</style></head>
<body><div id="stage"><canvas id="cv" width="${w}" height="${h}" style="position:absolute;inset:0;width:${w}px;height:${h}px"></canvas></div>
<script>${animateScript()}
(function(){var D=${data},A=window.CuriosaAnimate,cv=document.getElementById("cv");
if(D.at!==null){var f=A.frame(D.state,D.recipe,D.at,{w:${w},h:${h}},{quality:D.quality,calm:D.calm,tokens:D.tokens,font:D.font,lang:D.lang});A.draw(cv.getContext("2d"),f,{doc:document,layers:[],keys:[],dpr:1});window.__frame=f;document.documentElement.setAttribute("data-ready","1");return}
var opts={state:D.state,skin:D.recipe,quality:D.quality,calm:D.calm,lang:D.lang};if(D.startAt!==null)opts.serverNow=D.startAt;
window.__anim=A.mount(cv,opts);document.documentElement.setAttribute("data-ready","1")})();
</script></body></html>
`;
}

export const ANIMATE_GENRES = Object.freeze(Object.keys(GENRES));
export const animateKit = Object.freeze({
  animateContract: ANIMATE_CONTRACT,
  animateVersion: ANIMATE_VERSION,
  animateGenres: ANIMATE_GENRES as readonly string[],
  animateScript,
  animateOptions,
  animateKitPage: (o: AnimateKitOptions) => animateKitPage(o),
  checkAnimateState: (raw: unknown) => checkAnimateState(raw),
  checkAnimation: (raw: unknown) => checkAnimation(raw),
});
export type AnimateKit = typeof animateKit;
