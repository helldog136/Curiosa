/**
 * `ctx.overlay` (core 0.19.0): what a module needs to show compositions, without importing the core. Pure functions only: nothing is read or written.
 *
 *  - `composeScript()` / `composeCss()`: the engine (render.ts) as page script and sheet, for a module's overlay page;
 *  - `checkComposition(raw, opts)`: the same checker as the form and the editor (codes by path, every problem at once);
 *  - `resolveComposition(composition, { phrase, values })`: the texts filled, what the page receives;
 *  - `copyPlacement(composition, src)`: "Apply to the other files".
 *
 * An older core has no `ctx.overlay`: a module tests `typeof ctx.overlay?.composeScript === "function"` and, without it, shows the media alone as before.
 */
import { COMPOSE_CSS, composeScript } from "./render";
import { COMPOSE_VERSION, LIMITS, checkComposition, copyPlacement, defaultComposition, resolveComposition, type ComposeCheckOptions, type Composition } from "./model";

export const composeKit = Object.freeze({
  composeVersion: COMPOSE_VERSION,
  limits: LIMITS,
  composeScript,
  composeCss: () => COMPOSE_CSS,
  checkComposition: (raw: unknown, opts?: ComposeCheckOptions) => checkComposition(raw, opts),
  resolveComposition: (c: Composition, fill?: { phrase?: string; values?: Record<string, unknown> }) => resolveComposition(c, fill),
  copyPlacement: (c: Composition, src: string) => copyPlacement(c, src),
  defaultComposition: (src: string) => defaultComposition(src),
});
export type ComposeKit = typeof composeKit;
