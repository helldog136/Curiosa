import { pickName } from "../instances";
import { getActiveInstances } from "./registry";

export type AdminNav = {
  /** Instances qui gèrent des entrées : éditeur du cœur. */
  content: { key: string; name: string; icon: string }[];
  /** Les autres instances : réglages et panneau du module. */
  other: { id: string; name: string; icon: string }[];
};

/** Entrées du menu d'admin : une par instance active, regroupées selon qu'elles portent du contenu. */
export async function getAdminNav(locale: string, defaultLocale: string): Promise<AdminNav> {
  const nav: AdminNav = { content: [], other: [] };
  for (const { instance, mod } of await getActiveInstances()) {
    const name = pickName(instance, locale, defaultLocale);
    const icon = mod.manifest.icon ?? "🧩";
    if (mod.manifest.content) nav.content.push({ key: instance.key, name, icon });
    else nav.other.push({ id: instance.id, name, icon });
  }
  return nav;
}
