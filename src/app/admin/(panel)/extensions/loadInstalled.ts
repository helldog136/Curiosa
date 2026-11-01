import type { Translator } from "@/core/i18n/dictionary";
import { siteUrl } from "@/core/config";
import { listInstances } from "@/core/instances";
import { getSetting } from "@/core/settings";
import { cleanupSuggestions, readAuto } from "@/core/modules/autoInstalled";
import { buildNames, missingByModule } from "@/core/modules/dependencyView";
import { duplicateServices } from "@/core/modules/dependencies";
import { ATTENTION_ORDER, EXTENSION_FAMILIES, extensionFamily, worstState, type ExtensionFamily } from "@/core/modules/extensionFamilies";
import { getAdminNav } from "@/core/modules/adminNav";
import { buildModuleGroups, moduleSearchText } from "@/core/modules/installedList";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { getInstanceLabeler } from "@/core/modules/labels";
import { effectiveType } from "@/core/modules/manifest";
import { isPinned, placementSettingKey, placementsFor, resolvePlacement, unpinnedPlacementFor, type IntegrationState, type Placement } from "@/core/modules/menuPlacement";
import { summarizeMissing, summarizeMissingAcross, type MissingSummary } from "@/core/modules/missingSettings";
import { overlayUrl } from "@/core/modules/overlayUrl";
import { platformLabel, platformOf } from "@/core/modules/platform";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { localized } from "@/core/modules/types";
import { listRetired } from "@/core/modules/retired";

export type InstalledInstance = {
  id: string; key: string; name: string; state: IntegrationState; badge: number; content: boolean;
  /** Ce qu'il reste à renseigner (état « à configurer ») : rien, un réglage nommé, ou leur nombre. */
  setup: MissingSummary;
  pinned: boolean;
  /** Le rangement qu'applique « Retirer du menu » ; null = ce module ne se range pas (module illisible ou sans épinglage possible). */
  unpinTo: Placement | null;
  /** Adresse à coller dans OBS (overlay seulement). */
  obsUrl: string | null;
};

export type InstalledModule = {
  id: string; name: string; family: ExtensionFamily | "broken"; type: string; platform: string | null; version: string; loaded: boolean; icon: string; description: string;
  instances: InstalledInstance[]; count: number; /** Instances retirées dont les données sont gardées de côté. */ kept: number; update: boolean; missing: boolean; auto: boolean; attention: IntegrationState; /** Motif de la pastille « à configurer » du module (voir `summarizeMissingAcross`). */ setup: MissingSummary; search: string;
};

/** Les modules installés avec leurs instances, rangés par famille (les plus à regarder d'abord : erreur, puis à configurer). Sans réseau : le dernier rapport de mises à jour connu. */
export async function loadInstalled(opts: { t: Translator; locale: string; defaultLocale: string; advanced: boolean; isOwner: boolean; family: ExtensionFamily | null }) {
  const { t, locale, defaultLocale, advanced, isOwner, family } = opts;
  const rows = await listModuleRows();
  const mods = await Promise.all(rows.map(async (row) => ({ row, mod: await loadModule(row) })));
  const instances = await listInstances();
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  const behind = new Set((isOwner ? peekModulesReport()?.outdated ?? [] : []).map((o) => o.id));
  const statuses = await loadInstanceStatuses(locale, defaultLocale);
  const missingMap = await missingByModule();
  const auto = await readAuto();
  const badges = new Map((await getAdminNav(locale, defaultLocale)).map((n) => [n.id, n.badge]));
  const keptBy = new Map<string, number>();
  for (const r of await listRetired()) keptBy.set(r.moduleId, (keptBy.get(r.moduleId) ?? 0) + 1);

  const all: InstalledModule[] = [];
  for (const { row, mod } of mods) {
    const mine = instances.filter((i) => i.moduleId === row.id);
    const modName = mod ? localized(mod.manifest.name, locale, defaultLocale) : row.id;
    const type = mod ? effectiveType(mod.manifest) : "broken";
    const platform = mod ? platformOf(mod.manifest) : null;
    const list: InstalledInstance[] = [];
    const missingBy = new Map<string, string[]>();
    for (const i of mine) {
      const placement = mod ? resolvePlacement(mod.manifest, await getSetting(placementSettingKey(i.id))) : "integrations";
      const missing = statuses.get(i.id)?.missing ?? [];
      missingBy.set(i.id, missing);
      list.push({
        setup: summarizeMissing(missing),
        id: i.id, key: i.key, name: labeler.label(i), state: statuses.get(i.id)?.state ?? "on", badge: badges.get(i.id) ?? 0, content: !!mod?.manifest.content,
        pinned: isPinned(placement),
        unpinTo: mod && placementsFor(mod.manifest).includes("menu") ? unpinnedPlacementFor(mod.manifest) : null,
        obsUrl: mod?.def.overlay ? overlayUrl(siteUrl, i.key) : null,
      });
    }
    list.sort((a, b) => ATTENTION_ORDER[a.state] - ATTENTION_ORDER[b.state] || a.name.localeCompare(b.name));
    const fam = mod ? extensionFamily(mod.manifest) : "broken";
    all.push({
      id: row.id, family: fam, type, platform: platform ? platformLabel(platform) : null, version: row.version, loaded: !!mod, icon: mod?.manifest.icon ?? "🧩",
      description: mod ? localized(mod.manifest.description, locale, defaultLocale) : t("modules.broken"),
      // Une seule instance en mode simple : la carte porte le nom que l'admin lui a donné (comme le menu de gauche).
      name: !advanced && mine.length === 1 ? labeler.label(mine[0]!) : modName,
      instances: list, count: list.length, kept: keptBy.get(row.id) ?? 0, update: behind.has(row.id), missing: missingMap.has(row.id), auto: !!auto[row.id]?.module,
      attention: worstState(list.map((i) => i.state)),
      setup: summarizeMissingAcross(list.filter((i) => i.state === "setup").map((i) => missingBy.get(i.id) ?? [])),
      search: moduleSearchText([modName, mod ? localized(mod.manifest.description, locale, defaultLocale) : "", row.id, platform ? platformLabel(platform) : null, fam === "broken" ? null : t(`family.${fam}`), ...mine.flatMap((i) => [labeler.label(i), i.nickname, i.key]), ...list.map((i) => t(`integrations.state.${i.state}`))]),
    });
  }
  const present = EXTENSION_FAMILIES.filter((f) => all.some((m) => m.family === f));
  const shown = family ? all.filter((m) => m.family === family) : all;
  // Dans une famille : ce qui demande de l'attention d'abord, puis par ordre alphabétique.
  const groups = buildModuleGroups(shown, EXTENSION_FAMILIES, "", (m) => m.family).map((g) => ({ ...g, items: [...g.items].sort((a, b) => ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention] || a.name.localeCompare(b.name)) }));
  return { total: all.length, present, groups };
}

/** Données des encadrés de la page (doublons de services, nettoyage des modules posés automatiquement), réservés au propriétaire. */
export async function loadNotices(locale: string, defaultLocale: string, isOwner: boolean) {
  return {
    duplicates: isOwner ? await duplicateServices() : [],
    cleanup: isOwner ? await cleanupSuggestions() : [],
    names: await buildNames(locale, defaultLocale),
  };
}
