import type { Module } from "@prisma/client";
import { classify, compareVersions } from "../updates/versions";
import type { CatalogueEntry } from "./catalogue";
import type { ModuleUpdateCheck, InstallResult } from "./installer";

/**
 * MODULE DE BASE INSTALLÉ DEPUIS L'INSTANTANÉ HORS LIGNE (ligne `source: bundled`) : le catalogue (dépôt de modules, version épinglée) est sa source de vérité.
 * Dès qu'il propose une version plus récente, la mise à jour CONVERTIT le module en module du catalogue (source git épinglée), sans toucher à ses instances,
 * réglages, données, état activé, placements ni droits (voir reinstall.ts : échange avec sauvegarde et retour arrière complet).
 */

const fromCatalogue = (entry: CatalogueEntry | undefined): entry is CatalogueEntry & { version: string } => entry?.source === "recognized" && !!entry.version;

/** Vérification d'un module `bundled` : compare à l'entrée du catalogue ; sans entrée de catalogue, à l'instantané hors ligne (ancien comportement). */
export function checkBundledRow(row: Pick<Module, "version">, entry: CatalogueEntry | undefined): { check: ModuleUpdateCheck; failed: boolean } {
  if (fromCatalogue(entry)) {
    const newer = entry.compatible && compareVersions(entry.version, row.version) > 0;
    if (!newer) return { check: { available: false, remote: entry.version }, failed: false };
    return { check: { available: true, remote: entry.version, target: entry.version, level: classify(row.version, entry.version) ?? undefined, ...(entry.needsNewerCore ? { needsCore: entry.needsNewerCore } : {}) }, failed: false };
  }
  const available = !!entry?.dir && !!entry.version && entry.version !== row.version;
  return { check: { available, remote: entry?.version, target: available ? entry?.version : undefined, level: available ? classify(row.version, entry!.version!) ?? undefined : undefined }, failed: !entry };
}

/** Texte du journal d'audit d'une conversion : identifiant, versions, sources avant → après (jamais d'adresse de dépôt). */
export const conversionAuditTarget = (id: string, from: string, to: string) => `${id} ${from} -> ${to} (bundled -> catalogue)`;

/** Convertit un module `bundled` vers la version du catalogue (échange sûr, voir reinstall.ts). Pas de version plus récente : rien à faire. */
export async function convertToCatalogue(row: Module, entry: CatalogueEntry): Promise<InstallResult> {
  if (!entry.compatible) return { ok: false, error: "modules.error.incompatible" };
  if (entry.needsNewerCore) return { ok: false, error: "modules.error.core", detail: entry.needsNewerCore, needsCore: entry.needsNewerCore };
  if (!entry.version || compareVersions(entry.version, row.version) <= 0) return { ok: false, error: "modules.error.uptodate" };
  const { reinstallModule } = await import("./reinstall");   // import tardif : reinstall.ts dépend de ce fichier-ci par installer.ts
  const r = await reinstallModule(row.id, { catalogueOnly: true });
  if (!r.ok) return { ok: false, error: r.error, ...(r.detail ? { detail: r.detail } : {}), ...(r.needsCore ? { needsCore: r.needsCore } : {}) };
  return { ok: true, id: row.id, migrations: r.migrations, auditTarget: conversionAuditTarget(row.id, row.version, r.after.version) };
}
