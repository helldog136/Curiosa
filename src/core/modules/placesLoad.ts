import { cache } from "react";
import type { AdminUser } from "@/core/auth/access";
import { can, hasRole } from "@/core/auth/access";
import { buildContext, forViewer } from "./context";
import { getInstanceLabeler } from "./labels";
import { effectiveType } from "./manifest";
import { peekPlacesVocabulary } from "./recognized";
import { getActiveInstances, type ActiveInstance } from "./registry";
import { panelTab, planTabs } from "./tabs";
import { localized, type Block } from "./types";
import { scopeBlocks } from "./placeScope";
import {
  BUILTIN_VOCABULARY, buildPlaceIndex, fullyPlaced, isCorePage, mergeVocabulary, moduleSections, type Contribution, type PlaceIndex, type PlaceSection, type Vocabulary,
} from "./places";

/**
 * PLACES, server side: who contributes what to which place, for this person, and the content of one section (core 0.31.0). The decisions are in places.ts (pure).
 * The sidebar reads only manifests and the vocabulary already in memory (never the network, never a module's code): same cost as the module menu of before.
 */

/** The vocabulary in force: the core's own places, then `catalogue/places.json` as last read (memory or disk copy). */
export function currentVocabulary(): Vocabulary {
  return mergeVocabulary(BUILTIN_VOCABULARY, peekPlacesVocabulary());
}

export type ModulePlaces = { active: ActiveInstance; sections: PlaceSection[]; fullyPlaced: boolean };

/** The sections each active instance declares (manifests only). */
export const modulePlaces = cache(async (): Promise<ModulePlaces[]> => {
  const vocab = currentVocabulary();
  return (await getActiveInstances()).flatMap((active) => {
    const sections = moduleSections(active.mod.manifest, vocab.aliases);
    if (!sections.length) return [];
    return [{ active, sections, fullyPlaced: fullyPlaced(active.mod.manifest, sections, (s) => isCorePage(s.place, vocab)) }];
  });
});

/** Can this person see this section? Settings: administrators (as on a module page). Panel blocks and code sections: the right to open the module. */
export function sectionVisible(section: PlaceSection, moduleId: string, user: AdminUser | null, advanced: boolean): boolean {
  if (section.advancedOnly && !advanced) return false;
  const manage = hasRole(user, "admin");
  const open = can(user, `${moduleId}:open`);
  return (manage && section.settings.length > 0) || (open && (section.panelTabs.length > 0 || section.blocks));
}

/** Every contribution, with what this person may see. */
export const placeContributions = cache(async (user: AdminUser | null, advanced: boolean, locale: string, defaultLocale: string): Promise<Contribution[]> => {
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  return (await modulePlaces()).flatMap(({ active, sections }) => sections.map((section) => ({
    instanceId: active.instance.id, instanceKey: active.instance.key, moduleId: active.mod.manifest.id,
    moduleName: localized(active.mod.manifest.name, locale, defaultLocale), instanceLabel: labeler.label(active.instance), siblings: labeler.hasSiblings(active.instance.moduleId),
    connector: effectiveType(active.mod.manifest) === "integration",
    section, visible: sectionVisible(section, active.mod.manifest.id, user, advanced),
  })));
});

/** The place index for this person (groups, pages, tabs, sections in order). */
export const placeIndexFor = cache(async (user: AdminUser | null, advanced: boolean, locale: string, defaultLocale: string): Promise<PlaceIndex> =>
  buildPlaceIndex(await placeContributions(user, advanced, locale, defaultLocale), currentVocabulary(), locale));

/** Instances whose module places everything it shows: their own sidebar entry goes (dual mode, docs/PLACES.md). */
export async function fullyPlacedInstances(): Promise<Set<string>> {
  return new Set((await modulePlaces()).filter((m) => m.fullyPlaced).map((m) => m.active.instance.id));
}

/** Re-resolves a section from the server's own data before saving it (never trusts the browser beyond the two ids). */
export async function resolvePlaceSection(instanceId: string, sectionId: string): Promise<{ mod: ActiveInstance["mod"]; instanceKey: string; section: PlaceSection } | null> {
  const found = (await modulePlaces()).find((m) => m.active.instance.id === instanceId);
  const section = found?.sections.find((s) => s.id === sectionId);
  return found && section ? { mod: found.active.mod, instanceKey: found.active.instance.key, section } : null;
}

/** Time budget of one section (as the dashboard cards): after it, "Section unavailable" and the rest of the page shows. */
export const SECTION_BUDGET_MS = 1500;

export type SectionContent = { blocks: Block[]; state: "ok" | "failed" | "timeout" };

export const withBudget = <T,>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false; reason: "failed" | "timeout" }> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), ms);
    p.then((value) => { clearTimeout(timer); resolve({ ok: true, value }); }, (error) => { clearTimeout(timer); console.error("[places] section failed:", error); resolve({ ok: false, reason: "failed" }); });
  });

/**
 * The blocks of one section: the blocks of the module's own panel that target the section's tabs (`adminPanel`, called once per instance and request), then the
 * blocks of its place code (`placeSections`). Errors and slowness are contained: the section says it is unavailable, the page goes on.
 */
export async function loadSectionBlocks(active: ActiveInstance, section: PlaceSection, viewer: AdminUser, opts: { locale: string; advanced: boolean; query: Record<string, string>; budgetMs?: number }): Promise<SectionContent> {
  const run = async (): Promise<Block[]> => {
    const out: Block[] = [];
    const ctx = forViewer(await buildContext(active.mod, active.instance, opts.locale), viewer);
    if (section.panelTabs.length && active.mod.def.adminPanel) {
      const plan = planTabs(active.mod.manifest.tabs);
      const panel = await panelOf(active, viewer, opts.locale, JSON.stringify(opts.query));
      out.push(...panel.filter((b) => section.panelTabs.includes(panelTab(plan, b as { tab?: string }, true))));
    }
    const code = section.blocks ? active.mod.def.placeSections?.[section.id] : undefined;
    if (code && typeof code.render === "function") out.push(...(await code.render(ctx, { advanced: opts.advanced, query: opts.query })));
    return out;
  };
  const got = await withBudget(run(), opts.budgetMs ?? SECTION_BUDGET_MS);
  // (0.34.0) Every `?…` link of the module is moved to its own namespace: two modules on one page never read each other's parameters.
  return got.ok ? { blocks: Array.isArray(got.value) ? scopeBlocks(got.value, active.instance.key) : [], state: "ok" } : { blocks: [], state: got.reason };
}

/** One call of a module's `adminPanel` per request, shared by its sections. */
const panelOf = cache(async (active: ActiveInstance, viewer: AdminUser, locale: string, queryJson: string): Promise<Block[]> => {
  const query = JSON.parse(queryJson) as Record<string, string>;
  const blocks = await active.mod.def.adminPanel!(forViewer(await buildContext(active.mod, active.instance, locale), viewer), { query });
  return Array.isArray(blocks) ? (blocks as Block[]) : [];
});
