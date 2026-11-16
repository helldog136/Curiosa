/**
 * `ctx.overlay` (core 0.19.0): what a module needs to show compositions, without importing the core. Pure functions only: nothing is read or written.
 *
 *  - `composeScript()` / `composeCss()`: the engine (render.ts) as page script and sheet, for a module's overlay page;
 *  - `checkComposition(raw, opts)`: the same checker as the form and the editor (codes by path, every problem at once);
 *  - `resolveComposition(composition, { phrase, values })`: the texts filled, what the page receives;
 *  - `copyPlacement(composition, src, { seconds })`: "Apply to the other files";
 *  - (0.21.0) `features`: what this core's engine and editor can do (`"video"`: video backdrops, how they play, their sound, the alert as long as the video);
 *    `alertSeconds(composition)`: how long the alert lasts when the composition says so (null: as before); `isVideoSrc(src)`.
 *  - (0.25.0, feature `"preview"`) for an assistant: `preview(resolved, opts)` (async: an approximate still picture made with sharp, preview.ts),
 *    `renderKit(resolved, opts)` (a self-contained HTML page for the assistant's own browser, kitPage.ts), `explainErrors(errors)` (one plain English sentence
 *    per problem) and `mcpImage(bytes, mimeType, info)` (a tool result the MCP server sends as an image, services/mcp/image.ts).
 *
 * An older core has no `ctx.overlay`: a module tests `typeof ctx.overlay?.composeScript === "function"` and, without it, shows the media alone as before.
 */
import { COMPOSE_CSS, composeScript } from "./render";
import { renderKitPage, type KitOptions } from "./kitPage";
import { explainComposeErrors } from "./explain";
import { mcpImage } from "@/core/services/mcp/image";
import type { PreviewOptions, PreviewResult } from "./preview";
import type { ComposeError, ResolvedComposition } from "./model";
import { COMPOSE_VERSION, LIMITS, alertSeconds, checkComposition, copyPlacement, defaultComposition, defaultVideoComposition, isVideoSrc, resolveComposition, type ComposeCheckOptions, type Composition } from "./model";

/** What the compositions of this core can do (modules test it before they offer more: an older core lacks a word, and the module keeps to what it knows). */
export const COMPOSE_FEATURES = Object.freeze(["video", "preview"] as const);

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
  // sharp is loaded only when a preview is asked (never by an overlay page, nor by a module that does not preview)
  preview: async (c: ResolvedComposition, opts?: PreviewOptions): Promise<PreviewResult> => (await import("./preview")).previewComposition(c, opts),
  renderKit: (c: ResolvedComposition, opts: KitOptions) => renderKitPage(c, opts),
  explainErrors: (errors: ComposeError[], opts?: { variables?: readonly string[] }) => explainComposeErrors(errors, opts),
  mcpImage: (data: Uint8Array, mimeType: string, info?: unknown) => mcpImage(data, mimeType, info),
});
export type ComposeKit = typeof composeKit;
