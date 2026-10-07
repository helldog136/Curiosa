import type { Block, Slot } from "../blocks";
import { buildContext } from "./context";
import { getEnabledModules } from "./registry";
import type { SlotContext } from "./types";

type SlotExtras = Pick<SlotContext, "collection" | "entry">;

/** Rassemble les blocs de tous les modules actifs pour un emplacement donné. */
export async function runSlot(slot: Slot, locale: string, extras: SlotExtras = {}): Promise<Block[]> {
  const modules = await getEnabledModules();
  const out: Block[] = [];
  for (const mod of modules) {
    const fn = mod.def.slots?.[slot];
    if (!fn) continue;
    try {
      const ctx: SlotContext = { ...(await buildContext(mod, locale)), ...extras };
      const blocks = await fn(ctx);
      if (blocks) out.push(...blocks);
    } catch (error) {
      console.error(`[modules] ${mod.manifest.id} failed on slot ${slot}:`, error);
    }
  }
  return out;
}

/** Applique en chaîne le filtre `entryBody` de chaque module actif. */
export async function filterEntryBody(body: string, locale: string, extras: SlotExtras): Promise<string> {
  const modules = await getEnabledModules();
  let result = body;
  for (const mod of modules) {
    const fn = mod.def.filters?.entryBody;
    if (!fn) continue;
    try {
      const ctx: SlotContext = { ...(await buildContext(mod, locale)), ...extras };
      result = await fn(result, ctx);
    } catch (error) {
      console.error(`[modules] ${mod.manifest.id} failed on entryBody filter:`, error);
    }
  }
  return result;
}
