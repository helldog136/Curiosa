import { blockToBlocks, CORE_INSTANCE, CORE_SECTION, normalizeBlockDef } from "../homeBlocks";
import type { Block, Slot } from "../blocks";
import { pickName } from "../instances";
import { getSiteConfig } from "../settings";
import { boxed, STALLED } from "./budget";
import { buildContext } from "./context";
import { currentVisit, hasNewEntries } from "../visit";
import { getActiveInstances, sectionsOf, type ActiveInstance } from "./registry";
import type { PageResult, SlotContext } from "./types";

type SlotExtras = Pick<SlotContext, "page" | "entry">;

/**
 * Rassemble les blocs de toutes les instances actives pour un emplacement donné. Les modules sont interrogés EN MÊME TEMPS (l'ordre des blocs reste celui des
 * instances) et chacun a son temps imparti (voir budget.ts) : un module qui ne répond pas est omis, il ne retient ni les autres ni la page.
 */
export async function runSlot(slot: Slot, locale: string, extras: SlotExtras = {}): Promise<Block[]> {
  const parts = await Promise.all((await getActiveInstances()).map(async ({ instance, mod }): Promise<Block[]> => {
    const fn = mod.def.slots?.[slot];
    if (!fn) return [];
    try {
      const ctx: SlotContext = { ...(await buildContext(mod, instance, locale)), ...extras };
      const blocks = await boxed({ kind: "slot", moduleId: mod.manifest.id, instanceKey: instance.key, name: slot }, () => fn(ctx));
      return blocks && blocks !== STALLED ? blocks : [];
    } catch (error) {
      console.error(`[modules] ${instance.key} failed on slot ${slot}:`, error);
      return [];
    }
  }));
  return parts.flat();
}

/** Applique en chaîne le filtre `entryBody` de chaque instance active. */
export async function filterEntryBody(body: string, locale: string, extras: SlotExtras): Promise<string> {
  let result = body;
  for (const { instance, mod } of await getActiveInstances()) {
    const fn = mod.def.filters?.entryBody;
    if (!fn) continue;
    try {
      const ctx: SlotContext = { ...(await buildContext(mod, instance, locale)), ...extras };
      const filtered = await boxed({ kind: "filter", moduleId: mod.manifest.id, instanceKey: instance.key, name: "entryBody" }, () => fn(result, ctx));
      if (filtered !== STALLED) result = filtered;
    } catch (error) {
      console.error(`[modules] ${instance.key} failed on entryBody filter:`, error);
    }
  }
  return result;
}

/** Le nom d'une section pour le journal : son libellé français (sinon anglais) tel que le module le déclare, sinon son identifiant. */
function sectionName(manifest: ActiveInstance["mod"]["manifest"], sectionId: string): string {
  const label = sectionsOf(manifest).find((s) => s.id === sectionId)?.label;
  const text = typeof label === "string" ? label : label?.fr ?? label?.en;
  return text || sectionId;
}

/** Rend une section d'accueil proposée par une instance. Le module a un temps imparti (voir budget.ts) : sans réponse, la section est omise. */
export async function runSection(
  instanceKey: string,
  sectionId: string,
  options: Record<string, unknown>,
  locale: string,
): Promise<Block[]> {
  // Blocs de page du cœur (créés dans Page d'accueil) : aucune instance de module.
  if (instanceKey === CORE_INSTANCE) {
    if (sectionId !== CORE_SECTION) return [];
    const config = await getSiteConfig();
    return blockToBlocks(normalizeBlockDef(options.block, config.locales), locale, config.defaultLocale);
  }
  const active = (await getActiveInstances()).find((a) => a.instance.key === instanceKey);
  if (!active) return [];
  const { instance, mod } = active;
  try {
    const custom = mod.def.sections?.[sectionId];
    if (custom) {
      const ctx = await buildContext(mod, instance, locale);
      const unit = { kind: "section" as const, moduleId: mod.manifest.id, instanceKey: instance.key, name: sectionName(mod.manifest, sectionId) };
      const blocks = await boxed(unit, () => custom(ctx, options));
      return blocks === STALLED ? [] : blocks ?? [];
    }
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
export async function runPage(instanceKey: string, segments: string[], locale: string, purpose?: "sitemap"): Promise<PageResult | null | undefined> {
  const active = (await getActiveInstances()).find((a) => a.instance.key === instanceKey);
  if (!active?.mod.def.page) return undefined;
  try {
    const ctx = await buildContext(active.mod, active.instance, locale);
    const page = active.mod.def.page;
    const result = await boxed({ kind: "page", moduleId: active.mod.manifest.id, instanceKey: instanceKey, name: "page" }, () => page(ctx, purpose ? { segments, for: purpose } : { segments }));
    return result === STALLED ? { notFound: true, blocks: [] } : result;   // sans réponse : comme une page en erreur (404 sobre), jamais une page qui n'en finit pas
  } catch (error) {
    console.error(`[modules] ${instanceKey} failed rendering its page:`, error);
    return { notFound: true, blocks: [] };
  }
}

/**
 * Pastille de nouveauté d'une instance : la règle du module (`news`) si elle en a une, sinon celle du cœur (entrées publiées depuis la dernière visite).
 * Jamais de pastille pour un visiteur inconnu, et une erreur du module n'en affiche pas non plus.
 */
export async function instanceHasNews({ instance, mod }: ActiveInstance, locale: string): Promise<boolean> {
  const { lastVisit, isFirstVisit } = await currentVisit().catch(() => ({ lastVisit: new Date(0), isFirstVisit: true }));
  if (isFirstVisit) return false;
  try {
    if (mod.def.news) {
      const rule = mod.def.news;
      const ctx = await buildContext(mod, instance, locale, lastVisit);
      const answer = await boxed({ kind: "news", moduleId: mod.manifest.id, instanceKey: instance.key, name: "news" }, () => rule(ctx));
      return answer === STALLED ? false : Boolean(answer);
    }
    return await hasNewEntries(instance.id, lastVisit);
  } catch (error) {
    console.error(`[modules] ${instance.key} failed on news:`, error);
    return false;
  }
}
