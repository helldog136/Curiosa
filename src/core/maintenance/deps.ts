import fs from "node:fs";
import { DATA_DIR } from "@/core/config";
import { safetyCopy } from "@/core/backup/files";
import type { ModulesReport, Summary } from "@/core/modules/bulkUpdate";
import { checkForUpdateDetailed, installFromCatalogue, uninstallModule, type ModuleUpdateCheck, type InstallResult } from "@/core/modules/installer";
import { getCatalogue, getCatalogueSource, type CatalogueEntry } from "@/core/modules/catalogue";
import { getModulePreview, type ModulePreview } from "@/core/modules/readme";
import { retryInstanceMigration, type MigrationOutcome } from "@/core/modules/dataMigrations";
import { reinstallModule, type ReinstallResult } from "@/core/modules/reinstall";
import { getModulesReport, updateModules } from "@/core/modules/updateStatus";
import { sendMail, type MailResult } from "@/core/services/mail";
import { checkForUpdate, findLatestStable, startUpdate, type JsonFetcher, type Spawner } from "@/core/updates/service";

/**
 * Tout ce que la maintenance fait AU DEHORS (réseau, fichiers, mises à jour, e-mail) passe par cet objet : les vraies fonctions du cœur par défaut,
 * remplaçables dans les tests (aucun réseau, aucun processus lancé). Le reste du code ne les appelle jamais directement.
 */
export type MaintenanceDeps = {
  now(): number;
  /** Dossier de l'application et des données (tests) ; par défaut ceux du processus. */
  appDir?: string;
  dataDir?: string;
  fetchJson?: JsonFetcher;
  spawner?: Spawner;
  modulesReport(force: boolean): Promise<ModulesReport>;
  checkModule(id: string): Promise<{ check: ModuleUpdateCheck; failed: boolean }>;
  updateModules(ids: string[]): Promise<Summary>;
  reinstall(id: string): Promise<ReinstallResult>;
  uninstall(id: string, opts: { keepData: boolean }): Promise<InstallResult>;
  retryInstance(instanceId: string): Promise<MigrationOutcome | null>;
  /** Plus haute release STABLE du cœur (jamais une candidate ni un instantané), ou null. */
  latestStable(force?: boolean): Promise<{ tag: string; notes: string } | null>;
  /** « Revérifier » : relit les versions du cœur. */
  recheckCore(): Promise<void>;
  startCoreUpdate(tag: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Copie de la base sur le serveur ; renvoie son chemin (jamais montré à l'IA). */
  backup(): string | null;
  mail(subject: string, text: string): Promise<MailResult>;
  /** Place libre et totale du disque des données, en octets ; null si inconnue. */
  disk(): { freeBytes: number; totalBytes: number } | null;
  /**
   * Le catalogue des modules : le MÊME chemin et le MÊME cache (15 min) que la page « Ajouter » de l'admin (adresse du dépôt, hôtes permis, copie de la
   * dernière réception). `source: "none"` = injoignable et jamais reçu.
   */
  catalogue(): Promise<{ entries: CatalogueEntry[]; source: "repository" | "cache" | "none"; fetchedAt: number | null }>;
  /** Le module.json d'un module du catalogue, lu SANS l'installer (clone superficiel, 10 min de cache, comme la fiche de l'admin). Lève si le dépôt est refusé ou injoignable. */
  preview(entry: Pick<CatalogueEntry, "repo" | "ref" | "subdir">): Promise<ModulePreview | null>;
  /** Installe un module du catalogue (jamais d'une source non vérifiée : `confirmExtra` n'est jamais passé), avec les fournisseurs qui lui manquent. */
  installFromCatalogue(id: string): Promise<InstallResult>;
  /** Borne dure (ms) des lectures réseau du catalogue : au-delà, la réponse dit « injoignable pour l'instant ». */
  catalogTimeoutMs: number;
};

const STABLE_CACHE_MS = 10 * 60_000;
let stableCache: { at: number; value: { tag: string; notes: string } | null } | null = null;

export const realDeps = (): MaintenanceDeps => ({
  now: () => Date.now(),
  modulesReport: (force) => getModulesReport(force),
  checkModule: (id) => checkForUpdateDetailed(id),
  updateModules: (ids) => updateModules(ids),
  reinstall: (id) => reinstallModule(id),
  uninstall: (id, opts) => uninstallModule(id, opts),
  async catalogue() {
    const [entries, source] = await Promise.all([getCatalogue(), getCatalogueSource()]);
    return { entries, source: source.source, fetchedAt: source.fetchedAt };
  },
  async preview(entry) {
    return entry.repo ? getModulePreview({ kind: "repo", url: entry.repo, ref: entry.ref, subdir: entry.subdir }) : null;
  },
  installFromCatalogue: (id) => installFromCatalogue(id),
  catalogTimeoutMs: 20_000,
  retryInstance: (instanceId) => retryInstanceMigration(instanceId),
  async latestStable(force = false) {
    if (!force && stableCache && Date.now() - stableCache.at < STABLE_CACHE_MS) return stableCache.value;
    const value = await findLatestStable({ appDir: deps.appDir, fetchJson: deps.fetchJson });
    stableCache = { at: Date.now(), value };
    return value;
  },
  async recheckCore() {
    stableCache = null;
    await checkForUpdate({ appDir: deps.appDir, fetchJson: deps.fetchJson });
  },
  startCoreUpdate: (tag, actor) => startUpdate(tag, actor, { appDir: deps.appDir, dataDir: deps.dataDir, fetchJson: deps.fetchJson, spawner: deps.spawner, stableOnly: true }),
  backup: () => safetyCopy("maintenance", deps.dataDir),
  mail: (subject, text) => sendMail({ to: "owner", subject, text }, "core"),
  disk() {
    try {
      const s = fs.statfsSync(deps.dataDir ?? DATA_DIR);
      return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
    } catch { return null; }
  },
});

export const deps: MaintenanceDeps = realDeps();

/** Tests : remplace une partie des dépendances. `resetMaintenanceDeps()` remet les vraies. */
export function setMaintenanceDeps(patch: Partial<MaintenanceDeps>): void {
  Object.assign(deps, patch);
}
export function resetMaintenanceDeps(): void {
  for (const key of Object.keys(deps)) delete (deps as Record<string, unknown>)[key];
  Object.assign(deps, realDeps());
  stableCache = null;
}
