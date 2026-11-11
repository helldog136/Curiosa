import { boxed, STALLED } from "../modules/budget";
import { buildContext } from "../modules/context";
import { getInstanceLabeler } from "../modules/labels";
import { getActiveInstances } from "../modules/registry";
import { localized } from "../modules/types";

/**
 * OVERLAY CONTEXTS (core 0.8.0): asks the active module instances that declare a context for its value, WITHOUT ever naming a module (docs/OVERLAY-SKINS.md).
 * Never throws: no provider, inactive module, slow module, bad answer all give "no value" (the default skin applies). Answers are bounded and cleaned.
 */
export type ContextRef = { instance: string; context: string };
export type AvailableContext = ContextRef & { instanceLabel: string; label: string; switchLabel: string; example: string };
export type ContextValue = { id: string; name: string };

export const VALUE_ID_MAX = 120;
export const VALUE_NAME_MAX = 120;
export const PICKER_LIMIT = 50;
const CURRENT_TTL_MS = 4000;

/** A value as a module answered it: kept only if it has a printable id and a name; text is trimmed and cut. */
export function cleanValue(raw: unknown): ContextValue | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" || typeof o.id === "number" ? String(o.id).trim() : "";
  const name = typeof o.name === "string" ? o.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!id || id.length > VALUE_ID_MAX || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return { id, name: (name || id).slice(0, VALUE_NAME_MAX) };
}

export async function listContexts(lang: string, defaultLocale: string): Promise<AvailableContext[]> {
  const active = await getActiveInstances();
  const labeler = await getInstanceLabeler(lang, defaultLocale);
  const out: AvailableContext[] = [];
  for (const a of active) {
    for (const d of a.mod.manifest.overlayContexts ?? []) {
      const provider = a.mod.def.overlayContexts?.[d.id];
      if (!provider || typeof provider.current !== "function") continue;
      out.push({
        instance: a.instance.key, context: d.id, instanceLabel: labeler.label(a.instance), label: localized(d.label, lang, defaultLocale),
        switchLabel: localized(d.switchLabel, lang, defaultLocale), example: d.example ? localized(d.example, lang, defaultLocale) : "",
      });
    }
  }
  return out;
}

async function provider(ref: ContextRef) {
  const a = (await getActiveInstances()).find((x) => x.instance.key === ref.instance);
  const decl = a?.mod.manifest.overlayContexts?.find((d) => d.id === ref.context);
  const p = a?.mod.def.overlayContexts?.[ref.context];
  return a && decl && p && typeof p.current === "function" ? { a, p } : null;
}

const memo = new Map<string, { at: number; value: ContextValue | null }>();
export const clearContextCache = (): void => memo.clear();

/** The value now, or null. Cached a few seconds: every open overlay page polls, the module is not asked each time. */
export async function readContextValue(ref: ContextRef, now = Date.now()): Promise<ContextValue | null> {
  const key = `${ref.instance}\u0000${ref.context}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < CURRENT_TTL_MS) return hit.value;
  let value: ContextValue | null = null;
  try {
    const found = await provider(ref);
    if (found) {
      const ctx = await buildContext(found.a.mod, found.a.instance, "en");
      const answer = await boxed({ kind: "overlay", moduleId: found.a.mod.manifest.id, instanceKey: found.a.instance.key, name: `context:${ref.context}` }, () => found.p.current(ctx));
      value = answer === STALLED ? null : cleanValue(answer);
    }
  } catch (error) {
    console.error(`[overlays] context ${ref.instance}/${ref.context} failed (${error instanceof Error ? error.name : "error"})`);
  }
  memo.set(key, { at: now, value });
  if (memo.size > 40) memo.delete(memo.keys().next().value!);
  return value;
}

/** Known values for the picker (searchable), cleaned and bounded. */
export async function listContextValues(ref: ContextRef, search = "", limit = PICKER_LIMIT): Promise<ContextValue[]> {
  try {
    const found = await provider(ref);
    const fn = found?.p.values;
    if (!found || typeof fn !== "function") return [];
    const n = Math.max(1, Math.min(200, Math.round(limit)));
    const ctx = await buildContext(found.a.mod, found.a.instance, "en");
    const answer = await boxed({ kind: "overlay", moduleId: found.a.mod.manifest.id, instanceKey: found.a.instance.key, name: `context-values:${ref.context}` }, () => fn(ctx, { search: search.slice(0, 80), limit: n }));
    if (answer === STALLED || !Array.isArray(answer)) return [];
    const seen = new Set<string>();
    const out: ContextValue[] = [];
    for (const raw of answer) { const v = cleanValue(raw); if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); if (out.length >= n) break; } }
    return out;
  } catch { return []; }
}
