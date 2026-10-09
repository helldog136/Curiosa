import { prisma } from "@/core/db";
import { listModuleRows, loadModule } from "./registry";
import { localized } from "./types";
import { checkForUpdateDetailed, updateModule } from "./installer";
import { collectReport, createReportCache, updateSequentially, type ModulesReport, type Summary } from "./bulkUpdate";

/** Modules qui ont une source où chercher une mise à jour : livrés avec le catalogue, ou installés depuis un dépôt. */
async function sourcedModules() {
  const rows = await prisma.module.findMany({ orderBy: { id: "asc" } });
  return rows.filter((r) => r.source === "bundled" || (r.source === "git" && !!r.repoUrl)).map((r) => ({ id: r.id, version: r.version }));
}

const cache = createReportCache(async () => collectReport(await sourcedModules(), (id) => checkForUpdateDetailed(id)));

/** Modules en retard (vérification réelle, gardée quelques minutes). Ne lève jamais : un échec global donne un rapport vide. */
export async function getModulesReport(force = false): Promise<ModulesReport> {
  try { return await cache.get(force); } catch { return { checkedAt: Date.now(), checked: 0, outdated: [], unchecked: [] }; }
}

/** Sans attendre le réseau (menu d'admin) : le dernier rapport connu, et une vérification en arrière-plan s'il est périmé. */
export const peekModulesReport = () => cache.peek();

/** Met à jour ces modules un par un (voir updateSequentially) puis retire du rapport ceux qui ont réussi. */
export async function updateModules(ids: string[], onEach?: (id: string, ok: boolean) => Promise<void>): Promise<Summary> {
  const summary = await updateSequentially(ids, async (id) => {
    const r = await updateModule(id);
    await onEach?.(id, r.ok);
    return r;
  });
  cache.markUpdated(summary.updated);
  if (summary.stoppedOn) cache.clear();   // fichiers changés mais données en retard : on revérifie plutôt que de deviner
  return summary;
}

/** Nom lisible de chaque module installé (dans la langue de l'admin), à défaut son identifiant. */
export async function moduleNames(locale: string, fallback: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const row of await listModuleRows()) {
    const mod = await loadModule(row).catch(() => null);
    names.set(row.id, mod ? localized(mod.manifest.name, locale, fallback) : row.id);
  }
  return names;
}
