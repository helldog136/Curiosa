import type { Module } from "@prisma/client";
import { classify, compareVersions } from "../updates/versions";
import type { CatalogueEntry } from "./catalogue";
import type { ModuleUpdateCheck, InstallResult } from "./installer";
import type { Journal, Missing } from "./dependencyInstaller";
import type { ParsedManifest } from "./manifest";

/**
 * COMPATIBILITÉ SITES ANCIENS, À RETIRER EN 0.3.0. Les anciennes versions du cœur embarquaient des modules et les copiaient sur le serveur (ligne `source: bundled`) ;
 * le cœur n'en embarque plus aucun. Une telle ligne continue de fonctionner (son dossier est déjà sur le disque) et le catalogue (dépôt de modules, version épinglée)
 * est désormais sa seule source : dès qu'il propose une version plus récente, la mise à jour CONVERTIT le module en module du catalogue (source git épinglée),
 * sans toucher à ses instances, réglages, données, état activé, placements ni droits (voir reinstall.ts : échange avec sauvegarde et retour arrière complet).
 * Jamais de repli local : catalogue injoignable → erreur claire, le module installé reste tel quel.
 */

/** Vérification d'une ligne `bundled` : compare à l'entrée du catalogue. Sans entrée (catalogue injoignable ou module non listé), la vérification est signalée comme échouée : rien n'est supposé. */
export function checkBundledRow(row: Pick<Module, "version">, entry: CatalogueEntry | undefined): { check: ModuleUpdateCheck; failed: boolean } {
  if (!entry?.version) return { check: { available: false }, failed: true };
  const newer = entry.compatible && compareVersions(entry.version, row.version) > 0;
  if (!newer) return { check: { available: false, remote: entry.version }, failed: false };
  return { check: { available: true, remote: entry.version, target: entry.version, level: classify(row.version, entry.version) ?? undefined, ...(entry.needsNewerCore ? { needsCore: entry.needsNewerCore } : {}) }, failed: false };
}

/** Texte du journal d'audit d'une conversion : identifiant, versions, sources avant → après (jamais d'adresse de dépôt). */
export const conversionAuditTarget = (id: string, from: string, to: string) => `${id} ${from} -> ${to} (bundled -> catalogue)`;

/** Satisfait les `requires` durs d'un manifeste avant ses migrations (voir installer.ts, `settleBeforeMigrations`). */
export type Settle = (manifest: ParsedManifest) => Promise<{ ok: true; journal: Journal } | { ok: false; missing: Missing[] }>;

/**
 * Convertit une ligne `bundled` vers la version du catalogue (échange sûr, voir reinstall.ts). Pas de version plus récente : rien à faire.
 * `settle` : les `requires` de la nouvelle version sont satisfaits APRÈS l'échange et AVANT les migrations ; s'il manque quelque chose, l'échange est défait.
 */
export async function convertToCatalogue(row: Module, entry: CatalogueEntry, settle?: Settle): Promise<InstallResult> {
  if (!entry.compatible) return { ok: false, error: "modules.error.incompatible" };
  if (entry.needsNewerCore) return { ok: false, error: "modules.error.core", detail: entry.needsNewerCore, needsCore: entry.needsNewerCore };
  if (!entry.version || compareVersions(entry.version, row.version) <= 0) return { ok: false, error: "modules.error.uptodate" };
  const { reinstallModule } = await import("./reinstall");   // import tardif : reinstall.ts dépend de ce fichier-ci par installer.ts
  let journal: Journal | null = null;
  let missing: Missing[] | null = null;
  const r = await reinstallModule(row.id, {
    catalogueOnly: true,
    beforeMigrate: settle && (async (manifest) => {
      const s = await settle(manifest);
      if (!s.ok) { missing = s.missing; throw Object.assign(new Error("requires"), { code: "modules.error.requires", detail: s.missing.map((m) => m.service).join(", ") }); }
      journal = s.journal;
    }),
  });
  if (!r.ok && journal) { const { unwind } = await import("./dependencyInstaller"); await unwind(journal); }   // échange défait après la mise en place : on défait aussi la cascade
  if (!r.ok) return { ok: false, error: r.error, ...(r.detail ? { detail: r.detail } : {}), ...(r.needsCore ? { needsCore: r.needsCore } : {}), ...(r.loadError ? { loadError: r.loadError, rolledBack: true } : {}), ...(missing ? { missing } : {}) };
  const done = journal as Journal | null;
  if (done) await (await import("./dependencyInstaller")).commitJournal(done);
  return { ok: true, id: row.id, migrations: r.migrations, auditTarget: conversionAuditTarget(row.id, row.version, r.after.version), ...(r.warnings ? { warnings: r.warnings } : {}), ...(done?.provided.length ? { provided: done.provided } : {}) };
}
