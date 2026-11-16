/**
 * `ctx.overlay` (core 0.19.0): what a module needs to show compositions, without importing the core. Pure functions only: nothing is read or written.
 *
 *  - `composeScript()` / `composeCss()`: the engine (render.ts) as page script and sheet, for a module's overlay page;
 *  - `checkComposition(raw, opts)`: the same checker as the form and the editor (codes by path, every problem at once);
 *  - `resolveComposition(composition, { phrase, values })`: the texts filled, what the page receives;
 *  - `copyPlacement(composition, src, { seconds })`: "Apply to the other files";
 *  - (0.21.0) `features`: what this core's engine and editor can do (`"video"`: video backdrops, how they play, their sound, the alert as long as the video);
 *    `alertSeconds(composition)`: how long the alert lasts when the composition says so (null: as before); `isVideoSrc(src)`.
 *
 * An older core has no `ctx.overlay`: a module tests `typeof ctx.overlay?.composeScript === "function"` and, without it, shows the media alone as before.
 */
import { COMPOSE_CSS, composeScript } from "./render";
import { COMPOSE_VERSION, LIMITS, alertSeconds, checkComposition, copyPlacement, defaultComposition, defaultVideoComposition, isVideoSrc, resolveComposition, type ComposeCheckOptions, type Composition } from "./model";

/** What the compositions of this core can do (modules test it before they offer more: an older core lacks a word, and the module keeps to what it knows). */
export const COMPOSE_FEATURES = Object.freeze(["video"] as const);

export const composeKit = Object.freeze({
  composeVersion: COMPOSE_VERSION,
  limits: LIMITS,
  composeScript,
  composeCss: () => COMPOSE_CSS,
  checkComposition: (raw: unknown, opts?: ComposeCheckOptions) => checkComposition(raw, opts),
  resolveComposition: (c: Composition, fill?: { phrase?: string; values?: Record<string, unknown> }) => resolveComposition(c, fill),
  copyPlacement: (c: Composition, src: string, opts?: { seconds?: number | null }) => copyPlacement(c, src, opts),
  defaultComposition: (src: string, opts?: { seconds?: number | null }) => (isVideoSrc(src) ? defaultVideoComposition(src, opts) : defaultComposition(src)),
  features: COMPOSE_FEATURES as readonly string[],
  alertSeconds: (c: Pick<Composition, "duration"> | null | undefined) => alertSeconds(c),
  isVideoSrc: (src: string) => isVideoSrc(src),
});
export type ComposeKit = typeof composeKit;
