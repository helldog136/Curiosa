/**
 * THE DRAFT of a customization (docs/SKINS.md "Customization", "Live preview"): values the owner has not saved yet, composed by the SAME pure functions as the public
 * render, so the preview shows what visitors will get. Server side: it reads the installed skin and the modules' parts, never writes anything.
 */
import { getModuleSkinLayer } from "./moduleParts";
import { definitionOf } from "./appearanceView";
import { composeSkin, type Composed } from "./compose";
import { computeSignals, resolveValues, type Resolved, type Signal } from "./customizeResolve";
import { uploadExists } from "./customizeStore";
import { renderTokens } from "./sheet";
import type { StoredCustom } from "./customizeSpec";

export type Draft = { values: Record<string, unknown>; look?: string | null };

export type Composition = { composed: Composed; resolved: Resolved; signals: Signal[]; /** The token sheet (CSS text of validated variables and tokens) for the preview. */ css: string };

/**
 * Composes the skin with `draft` values (and `options` for the skin's own options). Like the preview of a skin, WITHOUT the owner's retouches: the preview page
 * does not carry them either, so the two stay in step. null: the skin is not installed or declares no customization.
 */
export async function composeDraft(skinId: string, draft: Draft, options: Record<string, string> = {}): Promise<Composition | null> {
  const layer = await getModuleSkinLayer();
  const skin = await definitionOf(skinId, layer);
  if (!skin || !skin.customize) return null;
  const stored: StoredCustom = { v: 1, look: draft.look ?? null, values: draft.values };
  const resolved = resolveValues(skin.customize, stored, { skinId: skin.id, version: skin.version, fileExists: uploadExists });
  const composed = composeSkin({ skin, options, moduleTokens: layer.tokens, modulePairs: layer.pairs, custom: { tokens: resolved.tokens, vars: resolved.vars, stills: resolved.stills } });
  const effective = Object.fromEntries(composed.modes.map((m) => [m.mode, m.tokens]));
  return { composed, resolved, signals: computeSignals(skin.customize, resolved, effective), css: renderTokens(composed) };
}
