import { getSetting } from "../settings";
import { listInstances } from "../instances";
import { buildContext } from "./context";
import { getInstanceLabeler } from "./labels";
import { effectiveType } from "./manifest";
import { platformOf } from "./platform";
import { getInstalledModules } from "./registry";
import { parseMenuPath, type GroupLabels, type MenuSegment } from "./menuPath";
import { defaultPlacement, defaultSection, parsePlacement, placementSettingKey, placementsFor, resolvePlacement, type MenuEntry, type Placement } from "./menuPlacement";

export type AdminNavItem = MenuEntry & {
  key: string;
  moduleId: string;
  name: string;
  icon: string;
  /** Choix de l'utilisateur (null = la règle par défaut s'applique). */
  pinned: Placement | null;
  /** Ce que donnerait la règle par défaut, pour l'afficher à côté du choix. */
  defaultPlacement: Placement;
  /** Plateforme déclarée par le module (« twitch »…), pour les regroupements à l'écran ; null = aucune. */
  platform: string | null;
  /** Rangements possibles pour cette instance (« overlays » seulement pour un overlay). */
  placements: Placement[];
  /** Le module sait servir une source navigateur OBS (page /overlays/<clé>). */
  overlay: boolean;
  /** (0.13.0) Menu path declared by the module (`adminMenu`), canonical; null = the entry keeps its section. */
  menuPath: MenuSegment[] | null;
  /** (0.13.0) `adminMenuOrder`, 0 to 999 (default 100). */
  menuOrder: number;
  /** (0.13.0) A connector or connection (type integration): first in its group. */
  connector: boolean;
  /** (0.13.0) `adminMenuLabels` of the module. */
  groupLabels: GroupLabels;
};

/** Pastille d'une instance : la valeur du hook `adminBadge` du module (0 sans hook, ou en cas d'erreur). */
async function badgeOf(mod: Parameters<typeof buildContext>[0], instance: Parameters<typeof buildContext>[1], locale: string): Promise<number> {
  if (!mod.def.adminBadge) return 0;
  try {
    const n = Number(await mod.def.adminBadge(await buildContext(mod, instance, locale)));
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0;
  } catch (error) {
    console.error(`[modules] ${instance.key} failed on adminBadge:`, error);
    return 0;
  }
}

/**
 * Toutes les instances des modules installés, avec où les ranger (épinglée au menu, dans quelle rubrique, ou seulement dans Extensions : voir menuPlacement.ts), leur pastille et leur état.
 * Le rangement en groupes se fait dans `buildMenuLayout`.
 */
export async function getAdminNav(locale: string, defaultLocale: string): Promise<AdminNavItem[]> {
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  const mods = await getInstalledModules();
  const out: AdminNavItem[] = [];
  for (const instance of await listInstances()) {
    const mod = mods.find((m) => m.manifest.id === instance.moduleId);
    if (!mod) continue;
    // Une instance dont la migration de données a échoué ne tourne pas (comme sur le site) : elle n'a ni pastille ni place dans le menu, mais reste dans Extensions avec son erreur.
    const error = !!(await getSetting<{ status?: string }>(`instance.${instance.id}.__dataStatus`))?.status;
    const stored = await getSetting(placementSettingKey(instance.id));
    const parsed = parsePlacement(stored);
    const pinned = parsed && placementsFor(mod.manifest).includes(parsed) ? parsed : null;
    out.push({
      id: instance.id,
      key: instance.key,
      moduleId: instance.moduleId,
      name: labeler.label(instance),
      icon: mod.manifest.icon ?? "🧩",
      content: !!mod.manifest.content,
      section: defaultSection(mod.manifest),
      type: effectiveType(mod.manifest),
      error,
      pinned,
      placement: resolvePlacement(mod.manifest, pinned),
      defaultPlacement: defaultPlacement(mod.manifest),
      platform: platformOf(mod.manifest),
      placements: placementsFor(mod.manifest),
      overlay: !!mod.def.overlay,
      menuPath: parseMenuPath(mod.manifest.adminMenu),
      menuOrder: mod.manifest.adminMenuOrder ?? 100,
      connector: effectiveType(mod.manifest) === "integration",
      groupLabels: mod.manifest.adminMenuLabels ?? {},
      badge: !error ? await badgeOf(mod, instance, locale) : 0,
    });
  }
  return out;
}
