import type { Block, Slot } from "../blocks";
import { pickName } from "../instances";
import { getSiteConfig } from "../settings";
import { buildContext } from "./context";
import { getActiveInstances, sectionsOf } from "./registry";
import type { PageResult, SlotContext } from "./types";

type SlotExtras = Pick<SlotContext, "page" | "entry">;

/** Rassemble les blocs de toutes les instances actives pour un emplacement donné. */
export async function runSlot(slot: Slot, locale: string, extras: SlotExtras = {}): Promise<Block[]> {
  const out: Block[] = [];
  for (const { instance, mod } of await getActiveInstances()) {
    const fn = mod.def.slots?.[slot];
    if (!fn) continue;
    try {
      const ctx: SlotContext = { ...(await buildContext(mod, instance, locale)), ...extras };
      const blocks = await fn(ctx);
      if (blocks) out.push(...blocks);
    } catch (error) {
      console.error(`[modules] ${instance.key} failed on slot ${slot}:`, error);
    }
  }
  return out;
}

/** Applique en chaîne le filtre `entryBody` de chaque instance active. */
export async function filterEntryBody(body: string, locale: string, extras: SlotExtras): Promise<string> {
  let result = body;
  for (const { instance, mod } of await getActiveInstances()) {
    const fn = mod.def.filters?.entryBody;
    if (!fn) continue;
    try {
      const ctx: SlotContext = { ...(await buildContext(mod, instance, locale)), ...extras };
      result = await fn(result, ctx);
    } catch (error) {
      console.error(`[modules] ${instance.key} failed on entryBody filter:`, error);
    }
  }
  return result;
}

/** Rend une section d'accueil proposée par une instance. */
export async function runSection(
  instanceKey: string,
  sectionId: string,
  options: Record<string, unknown>,
  locale: string,
): Promise<Block[]> {
  const active = (await getActiveInstances()).find((a) => a.instance.key === instanceKey);
  if (!active) return [];
  const { instance, mod } = active;
  try {
    const custom = mod.def.sections?.[sectionId];
    if (custom) return (await custom(await buildContext(mod, instance, locale), options)) ?? [];
    // Section par défaut des modules à contenu : les dernières entrées.
    if (sectionId === "latest" && mod.manifest.content) {
      const config = await getSiteConfig();
      const limit = Math.min(50, Math.max(1, Number(options.count) || 3));
      return [{ type: "entries", instance: instance.key, limit, title: pickName(instance, locale, config.defaultLocale), link: true }];
    }
    // Entrée(s) au hasard : proposée aux modules dont les entrées portent un code (codes promo…).
    if (sectionId === "random" && mod.manifest.content && sectionsOf(mod.manifest).some((s) => s.id === "random")) {
      const limit = Math.min(10, Math.max(1, Number(options.count) || 1));
      return [{ type: "entries", instance: instance.key, limit, pick: "random" }];
    }
  } catch (error) {
    console.error(`[modules] ${instanceKey} failed on section ${sectionId}:`, error);
  }
  return [];
}

/** Page publique d'un module qui définit la sienne (sinon le cœur affiche liste + entrées). */
export async function runPage(instanceKey: string, segments: string[], locale: string): Promise<PageResult | null | undefined> {
  const active = (await getActiveInstances()).find((a) => a.instance.key === instanceKey);
  if (!active?.mod.def.page) return undefined;
  try {
    return await active.mod.def.page(await buildContext(active.mod, active.instance, locale), { segments });
  } catch (error) {
    console.error(`[modules] ${instanceKey} failed rendering its page:`, error);
    return { notFound: true, blocks: [] };
  }
}
