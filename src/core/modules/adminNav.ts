import { buildContext } from "./context";
import { getInstanceLabeler } from "./labels";
import { effectiveType } from "./manifest";
import { getActiveInstances } from "./registry";
import { MODULE_TYPES, type ModuleType } from "./types";

export type AdminNavItem = { id: string; key: string; name: string; icon: string; content: boolean; badge: number };
export type AdminNav = { type: ModuleType; items: AdminNavItem[] }[];

/**
 * Barre latérale de l'admin : UNE interface pour tout le site. Chaque instance de module
 * configurée y a sa propre entrée (nommée comme l'utilisateur l'a nommée), regroupée par
 * type de module ; la page de l'instance est une sous-page de cet admin unique.
 */
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

export async function getAdminNav(locale: string, defaultLocale: string): Promise<AdminNav> {
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  const byType = new Map<ModuleType, AdminNavItem[]>();
  for (const { instance, mod } of await getActiveInstances()) {
    const type = effectiveType(mod.manifest);
    const list = byType.get(type) ?? [];
    list.push({
      id: instance.id,
      key: instance.key,
      name: labeler.label(instance),
      icon: mod.manifest.icon ?? "🧩",
      content: !!mod.manifest.content,
      badge: await badgeOf(mod, instance, locale),
    });
    byType.set(type, list);
  }
  return MODULE_TYPES.filter((t) => byType.has(t)).map((type) => ({ type, items: byType.get(type)! }));
}
