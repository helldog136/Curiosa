import { prisma } from "@/core/db";
import { bulkUpdateCopy } from "@/core/backup/files";
import { listModuleRows, loadModule } from "./registry";
import { localized } from "./types";
import { checkForUpdateDetailed, updateModule } from "./installer";
import { clearRecognizedCache } from "./recognized";
import { collectReport, createReportCache, orderForUpdate, updateSequentially, type ModulesReport, type Summary, type UpdateLinks } from "./bulkUpdate";
import { getCatalogue, type CatalogueEntry } from "./catalogue";
import { getModule } from "./registry";
import { normalizeNeeds, normalizeOffers } from "./serviceVersions";
import { opUnit } from "../operations/tracker";

/** Modules qui ont une source où chercher une mise à jour : un dépôt, ou le catalogue pour une ligne `bundled` d'un ancien site (compatibilité, à retirer en 0.3.0). */
async function sourcedModules() {
  const rows = await prisma.module.findMany({ orderBy: { id: "asc" } });
  return rows.filter((r) => r.source === "bundled" || (r.source === "git" && !!r.repoUrl)).map((r) => ({ id: r.id, version: r.version }));
}

const cache = createReportCache(async () => collectReport(await sourcedModules(), (id) => checkForUpdateDetailed(id)));

/** Modules en retard (vérification réelle, gardée quelques minutes). Ne lève jamais : un échec global donne un rapport vide. */
export async function getModulesReport(force = false): Promise<ModulesReport> {
  // « Revérifier » relit aussi l'index du catalogue (gardé 15 min) : sans cela, une version publiée depuis moins de 15 minutes resterait invisible.
  if (force) clearRecognizedCache();
  try { return await cache.get(force); } catch { return { checkedAt: Date.now(), checked: 0, outdated: [], unchecked: [] }; }
}

/** Sans attendre le réseau (menu d'admin) : le dernier rapport connu, et une vérification en arrière-plan s'il est périmé. */
export const peekModulesReport = () => cache.peek();

/** Offres et besoins de la version visée : l'entrée du catalogue (version proposée), à défaut le manifeste installé. */
async function updateLinks(ids: string[]): Promise<UpdateLinks[]> {
  const market = await getCatalogue().catch((): CatalogueEntry[] => []);
  const out: UpdateLinks[] = [];
  for (const id of ids) {
    const entry = market.find((e) => e.id === id);
    const mod = await getModule(id).catch(() => null);
    out.push({ id, offers: entry?.offers ?? normalizeOffers(mod?.manifest.offers), needs: entry?.needs ?? normalizeNeeds(mod?.manifest.requires) });
  }
  return out;
}

/** Met à jour ces modules un par un, fournisseurs avant consommateurs (voir orderForUpdate, updateSequentially), puis retire du rapport ceux qui ont réussi. */
export async function updateModules(ids: string[], onEach?: (id: string, ok: boolean, result: Awaited<ReturnType<typeof updateModule>>) => Promise<void>, nameOf: (id: string) => string = (id) => id): Promise<Summary> {
  // UNE copie de la base avant le premier module (jamais une par module). Pas de place ou copie impossible : on ne touche à rien.
  if (ids.length) {
    const copy = await bulkUpdateCopy().catch((): { ok: false; error: "failed" } => ({ ok: false, error: "failed" }));
    if (!copy.ok) return { updated: [], failed: ids.map((id) => ({ id, error: copy.error === "no-space" ? "modules.error.noSpace" : "modules.error.copyFailed", migration: false })), skipped: [], stoppedOn: null };
  }
  const ordered = orderForUpdate(await updateLinks(ids));
  const cascaded = new Set<string>();   // fournisseurs déjà mis à jour par la cascade d'un module précédent (cycle) : « déjà à jour » n'est pas un échec
  let position = 0;
  const summary = await updateSequentially(ordered, async (id) => {
    opUnit(++position, ordered.length, nameOf(id));   // « module 2 sur 5 » pour le suivi d'opération (sans effet hors d'une opération suivie)
    const r = await updateModule(id);
    if (r.ok) for (const p of r.provided ?? []) cascaded.add(p);
    if (!r.ok && r.error === "modules.error.uptodate" && cascaded.has(id)) return { ok: true };
    await onEach?.(id, r.ok, r);
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
