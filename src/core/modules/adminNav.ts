import { listModuleRows, loadModule } from "./registry";
import { localized } from "./types";

/** Une entrée de menu d'admin par module activé : c'est là qu'on le configure. */
export async function getAdminModuleNav(locale: string, defaultLocale: string) {
  const rows = (await listModuleRows()).filter((r) => r.enabled);
  const out: { id: string; name: string; icon: string }[] = [];
  for (const row of rows) {
    const mod = await loadModule(row);
    if (!mod) continue;
    out.push({ id: row.id, name: localized(mod.manifest.name, locale, defaultLocale), icon: mod.manifest.icon ?? "🧩" });
  }
  return out;
}
