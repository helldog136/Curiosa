import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Module } from "@prisma/client";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { readUpdateState } from "../updates/service";
import { opStep } from "../operations/tracker";
import { catalogueUnreachable, findCatalogueEntry } from "./catalogue";
import { incompatWithThisCore, requirementOf } from "./compat";
import { migrateModuleInstances, type MigrationOutcome } from "./dataMigrations";
import { CoreTooOld, dirSize, git, isCommitRef, isInside, copyModuleFiles, subdirTarget } from "./installer";
import { parseManifest, type ParsedManifest } from "./manifest";
import { bumpImportStamp, forgetModule, moduleDir, readGitManifest, verifyModuleLoad } from "./registry";
import { LoadCheckFailed, preflightModule } from "./loadCheck";
import { clearBlockedUpdate, noteBlockedUpdate } from "./blockedUpdate";
import { staticImportsWarning } from "./staticImports";
import type { LoadWarning } from "./installer";

/**
 * RÉINSTALLATION D'UN MODULE (maintenance). Remet le CODE d'un module installé à neuf depuis sa source, même si le numéro de version est identique
 * (le cas qui piège la mise à jour : un module de base n'était comparé que par son numéro). Tout le reste est conservé : instances, réglages,
 * données, état activé/désactivé, rangement, placements d'accueil, droits MCP (rien de cela n'est touché : seule la ligne `Module` et son dossier le sont).
 *
 * Sources : dépôt git (en sous-dossier ou à la racine : même référence que la mise à jour, voir `subdirTarget`) ; le catalogue pour une ligne `bundled` d'un ancien site
 * (compatibilité, à retirer en phase 3 d'entretien : réinstaller la CONVERTIT en module du catalogue, version épinglée, sans AUCUN repli local : catalogue injoignable → erreur claire) ; sinon refus. « Réinstaller = remettre la version actuellement proposée par la source du module », jamais plus.
 * Sécurité : l'ancien dossier est mis de côté pendant l'échange (`.previous-<pid>`) et revient tel quel au moindre échec ; jamais de nouvelle permission accordée en silence.
 */

const MAX_MODULE_BYTES = 10 * 1024 * 1024;
const globalBusy = globalThis as unknown as { curiosaReinstalling?: Set<string> };
const busy = (globalBusy.curiosaReinstalling ??= new Set<string>());

/* ───────────── Empreinte du contenu d'un dossier ───────────── */

export type Fingerprint = { hash: string; files: Record<string, string> };
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

/** Empreinte du contenu d'un dossier (chemins + contenus, sans .git ni node_modules) : deux dossiers identiques ont la même, la moindre ligne changée la modifie. */
export function fingerprintDir(dir: string): Fingerprint {
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("symlinks are not allowed in a module");
      if (entry.isDirectory()) walk(r);
      else files[r] = sha(fs.readFileSync(path.join(dir, r)));
    }
  };
  walk("");
  return { hash: sha(Object.entries(files).map(([k, v]) => `${k}\0${v}\n`).join("")), files };
}
const tryFingerprint = (dir: string): Fingerprint | null => { try { return fingerprintDir(dir); } catch { return null; } };
/** Empreinte courte, comme on l'affiche. */
export const shortHash = (h: string | null | undefined): string => (h ? h.slice(0, 7) : "?");

/* ───────────── Source d'un module ───────────── */

type Source = { root: string; wholeDir?: string; commit: string | null; tree: string | null; ref: string | null; cleanup: () => void };

export const sourceKind = (row: Pick<Module, "source" | "repoUrl">): "bundled" | "git" | "none" => (row.source === "bundled" ? "bundled" : row.source === "git" && row.repoUrl ? "git" : "none");

/** Récupère la source d'un module installé par git (dépôt temporaire, supprimé par `cleanup`). */
async function fetchGitSource(row: Module): Promise<Source> {
  const { ref } = await subdirTarget(row);
  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-"));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const checkout = path.join(tmp, "repo");
    await git(["init", "-q", checkout]);
    await git(["remote", "add", "origin", row.repoUrl!], checkout);
    await git(["fetch", "-q", "--depth", "1", "origin", ref || "HEAD"], checkout).catch((e) => {
      if (ref && isCommitRef(ref)) return git(["fetch", "-q", "origin"], checkout);
      throw e;
    });
    await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", isCommitRef(ref) ? ref! : "FETCH_HEAD"], checkout);
    const root = row.subdir ? path.join(checkout, row.subdir) : checkout;
    if (row.subdir && !isInside(checkout, root)) throw Object.assign(new Error("subdir"), { code: "modules.error.nosubdir" });
    const commit = await git(["rev-parse", "HEAD"], checkout);
    const tree = row.subdir ? await git(["rev-parse", `HEAD:${row.subdir}`], checkout) : null;
    return { root, wholeDir: row.subdir ? undefined : checkout, commit, tree, ref, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Ligne `bundled` d'un ancien site (compatibilité, à retirer en phase 3 d'entretien) que le catalogue liste : la ligne telle qu'elle serait une fois convertie (dépôt, étiquette épinglée, dossier). Sinon null. */
async function catalogueSource(row: Module): Promise<{ row: Module; version?: string } | null> {
  if (row.source !== "bundled") return null;
  const entry = await findCatalogueEntry(row.id).catch(() => undefined);
  if (!entry?.repo || !entry.compatible) return null;
  return { row: { ...row, source: "git", repoUrl: entry.repo, ref: entry.ref ?? null, subdir: entry.subdir ?? null }, version: entry.version };
}

function readManifestAt(dir: string): ParsedManifest | null {
  try { const p = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"))); return p.ok ? p.manifest : null; } catch { return null; }
}

/* ───────────── Diagnostic ───────────── */

export type Comparison = { state: "identical" | "different" | "unavailable"; sourceVersion?: string; sourceHash?: string };
export type Diagnostic = {
  id: string;
  version: string;
  kind: "bundled" | "git" | "none";
  repoUrl?: string;
  ref?: string;
  subdir?: string;
  commit?: string;
  /** Ligne `bundled` d'un ancien site que le catalogue liste : sa source est le catalogue (dépôt, étiquette). */
  catalogue?: { repoUrl: string; ref?: string; subdir?: string; version?: string };
  /** Empreinte du dossier installé, calculée à la demande. */
  installedHash: string | null;
  /** Null : pas comparé (la source est sur le réseau et on n'a pas demandé la comparaison). */
  comparison: Comparison | null;
};

/**
 * Ce que le propriétaire voit : version, source, empreinte du code installé. `compare: "local"` ne compare à rien (aucun réseau) ;
 * `compare: "network"` compare avec le dépôt git de la source (téléchargement explicite). Ne lève jamais.
 */
export async function diagnoseModule(id: string, opts: { compare?: "none" | "local" | "network" } = {}): Promise<Diagnostic | null> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return null;
  const kind = sourceKind(row);
  const installed = tryFingerprint(moduleDir(id));
  const out: Diagnostic = {
    id, version: row.version, kind, installedHash: installed?.hash ?? null, comparison: null,
    ...(kind === "git" ? { repoUrl: row.repoUrl!, ...(row.ref ? { ref: row.ref } : {}), ...(row.subdir ? { subdir: row.subdir } : {}), ...(row.commit ? { commit: row.commit } : {}) } : {}),
  };
  const mode = opts.compare ?? "none";
  const cat = await catalogueSource(row);
  if (cat) out.catalogue = { repoUrl: cat.row.repoUrl!, ...(cat.row.ref ? { ref: cat.row.ref } : {}), ...(cat.row.subdir ? { subdir: cat.row.subdir } : {}), ...(cat.version ? { version: cat.version } : {}) };
  const compareTo = (root: string, cleanup?: () => void): Comparison => {
    try {
      const src = fingerprintDir(root);
      const sv = readManifestAt(root)?.version;
      return { state: installed && installed.hash === src.hash ? "identical" : "different", sourceHash: src.hash, ...(sv ? { sourceVersion: sv } : {}) };
    } catch { return { state: "unavailable" }; } finally { cleanup?.(); }
  };
  if (cat && mode === "network") {
    try { const s = await fetchGitSource(cat.row); out.comparison = compareTo(s.root, s.cleanup); } catch { out.comparison = { state: "unavailable" }; }
  } else if (kind === "git" && mode === "network") {
    try { const s = await fetchGitSource(row); out.comparison = compareTo(s.root, s.cleanup); } catch { out.comparison = { state: "unavailable" }; }
  }
  return out;
}

/* ───────────── Réinstallation ───────────── */

export type Snapshot = { version: string; hash: string | null; commit: string | null };
export type ReinstallResult =
  | {
    ok: true; id: string;
    /** Faux : le code installé était déjà identique à celui de la source, rien n'a changé. */
    changed: boolean;
    before: Snapshot; after: Snapshot;
    migrations: MigrationOutcome[];
    /** Toujours faux depuis le cœur 0.2.13 (champ gardé pour compatibilité) : les fichiers secondaires sont rechargés avec le fichier principal, depuis une copie neuve (snapshot.ts). */
    restartAdvised: boolean;
    /** Remarque (jamais un refus) : voir staticImports.ts. */
    warnings?: LoadWarning[];
  }
  | { ok: false; id: string; error: string; detail?: string; needsCore?: string; /** Erreur « modules.error.loadCheck » : raison courte (anglais, sans chemin) pour le journal et l'assistant. */ loadError?: string; /** L'échange avait commencé : l'ancien code a été remis tel quel. */ rolledBack: boolean };

export type ReinstallOptions = {
  /** Dossier de l'état des mises à jour du site (tests). */
  dataDir?: string;
  /** Mise à jour d'une ligne `bundled` vers le catalogue : suit le manifeste du catalogue, même avec de nouvelles permissions (montrées par la mise à jour). */
  catalogueOnly?: boolean;
  /** Appelé juste après l'échange des fichiers, avant la base (tests : simule un échec en cours d'échange). */
  afterSwap?: () => Promise<void> | void;
  /**
   * Appelé après l'échange des fichiers et de la base, AVANT les migrations (mise à jour : satisfaire les `requires` de la nouvelle version).
   * Une erreur levée ici défait l'échange (ancien code et ancienne ligne remis) ; son `code` devient l'erreur renvoyée, son `detail` la précision.
   */
  beforeMigrate?: (manifest: ParsedManifest) => Promise<void>;
};

const fail = (id: string, error: string, extra: { detail?: string; needsCore?: string; rolledBack?: boolean; loadError?: string } = {}): ReinstallResult => ({ ok: false, id, error, rolledBack: false, ...extra });

export async function reinstallModule(id: string, opts: ReinstallOptions = {}): Promise<ReinstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return fail(id, "modules.error.notfound");
  const kind = sourceKind(row);
  if (kind === "none") return fail(id, "modules.error.reinstallNoSource");
  if (busy.has(id) || readUpdateState(opts.dataDir).status === "running") return fail(id, "modules.error.reinstallBusy");
  busy.add(id);

  const target = moduleDir(id);
  const backup = `${target}.previous-${process.pid}`;
  let source: Source | null = null;
  let swapped = false;
  let dbChanged = false;
  let viaCatalogue: { row: Module; version?: string } | null = null;
  let targetVersion = "?";
  try {
    // 1. La source : le dépôt git du module ; pour une ligne `bundled`, le catalogue (jamais une copie locale).
    opStep("download");
    if (kind === "bundled") {
      viaCatalogue = await catalogueSource(row);
      if (!viaCatalogue) return fail(id, (await catalogueUnreachable()) ? "modules.error.catalogue" : "modules.error.unknownSource");
      try { source = await fetchGitSource(viaCatalogue.row); } catch (error) {
        console.error("[modules] catalogue repository unreachable:", (error as Error)?.message);
        return fail(id, "modules.error.catalogue");
      }
    } else {
      source = await fetchGitSource(row);
    }

    // 2. Contrôles, AVANT de toucher à quoi que ce soit.
    opStep("verify");
    const manifest = readManifestAt(source.root);
    if (!manifest) return fail(id, "modules.error.nomanifest");
    if (manifest.id !== id) return fail(id, "modules.error.idmismatch");
    targetVersion = manifest.version;
    if (manifest.main && !fs.existsSync(path.join(source.root, manifest.main))) return fail(id, "modules.error.nomain");
    if (dirSize(source.root) > MAX_MODULE_BYTES) return fail(id, "modules.error.size");
    const inc = incompatWithThisCore(requirementOf(manifest));
    if (inc) return fail(id, "modules.error.core", { detail: inc.needs, needsCore: inc.needs });
    // Réinstaller ne doit jamais élargir les permissions en silence : une version qui en demande de nouvelles passe par la mise à jour / le catalogue (où elles sont montrées).
    // La mise à jour vers le catalogue (`catalogueOnly`) EST ce chemin : comme toute mise à jour, elle suit le manifeste du catalogue.
    const installedManifest = readGitManifest(id);
    if (installedManifest && !opts.catalogueOnly) {
      const added = manifest.permissions.filter((p) => !installedManifest.permissions.includes(p));
      if (added.length) return fail(id, "modules.error.reinstallPerms", { detail: added.join(", ") });
    }

    const oldFp = tryFingerprint(target);
    const newFp = fingerprintDir(source.root);
    const before: Snapshot = { version: row.version, hash: oldFp?.hash ?? null, commit: row.commit };
    const after: Snapshot = { version: manifest.version, hash: newFp.hash, commit: source.commit ?? row.commit };
    // Données de la ligne `Module` après l'opération : un module de base lu dans le catalogue DEVIENT un module du catalogue (source git épinglée).
    const data = viaCatalogue
      ? { source: "git", repoUrl: viaCatalogue.row.repoUrl, ref: viaCatalogue.row.ref, subdir: viaCatalogue.row.subdir, version: manifest.version, commit: source.commit, tree: source.tree }
      : kind === "git" ? { version: manifest.version, commit: source.commit, tree: source.tree } : { version: manifest.version };

    // 3. Déjà identique : rien à échanger (on vide seulement la mémoire du module, au cas où le processus en garderait une autre copie).
    if (oldFp && oldFp.hash === newFp.hash && row.version === manifest.version) {
      if (viaCatalogue || (source.commit && (source.commit !== row.commit || (source.tree ?? null) !== (row.tree ?? null)))) {
        await prisma.module.update({ where: { id }, data: viaCatalogue ? data : { commit: source.commit, tree: source.tree } });
      }
      bumpImportStamp(id);
      forgetModule(id);
      return { ok: true, id, changed: false, before, after: { ...after, commit: source.commit ?? row.commit }, migrations: [], restartAdvised: false };
    }

    // Contrôle de chargement dans un processus tout neuf, AVANT de toucher au dossier installé : un code qui ne se charge pas n'est pas échangé.
    const pre = await preflightModule(source.root, manifest);
    if (!pre.ok) { await noteBlockedUpdate(id, row.version, manifest.version, { reason: pre.reason }, "reinstall"); return fail(id, "modules.error.loadCheck", { loadError: pre.reason, rolledBack: true }); }

    // 4. Échange : l'ancien dossier est mis de côté, et revient tel quel au moindre échec.
    opStep("activate");
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    swapped = true;
    if (source.wholeDir) fs.renameSync(source.wholeDir, target);   // module à la racine d'un dépôt : le dossier garde son .git
    else copyModuleFiles(source.root, target);
    await opts.afterSwap?.();
    // Puis dans le processus du site, depuis une copie neuve, AVANT de basculer la ligne en base.
    const next = { id, version: manifest.version, commit: (data as { commit?: string | null }).commit ?? row.commit };
    const verdict = await verifyModuleLoad(next);
    if (!verdict.ok) throw new LoadCheckFailed(verdict.reason);
    await prisma.module.update({ where: { id }, data });
    dbChanged = true;
    bumpImportStamp(id);
    forgetModule(id, next);
    await opts.beforeMigrate?.(manifest);
    const migrations = await migrateModuleInstances(id);
    swapped = false;

    await clearBlockedUpdate(id);
    const warning = staticImportsWarning(target);
    // Plus jamais « redémarrez le site » pour des fichiers secondaires : chaque chargement part d'une copie neuve de tout le dossier (snapshot.ts). Le champ reste (compatibilité).
    const restartAdvised = false;
    return { ok: true, id, changed: true, before, after, migrations, restartAdvised, ...(warning ? { warnings: [warning] } : {}) };
  } catch (error) {
    let rolledBack = false;
    if (swapped) {
      fs.rmSync(target, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, target);
      if (dbChanged) await prisma.module.update({ where: { id }, data: { source: row.source, repoUrl: row.repoUrl, ref: row.ref, subdir: row.subdir, version: row.version, commit: row.commit, tree: row.tree } }).catch(() => {});
      rolledBack = true;
    }
    bumpImportStamp(id);   // si le nouveau code a été chargé le temps d'un essai, le rétabli ne doit pas en hériter
    forgetModule(id);
    console.error("[modules] reinstall failed:", (error as Error)?.message);
    if (error instanceof CoreTooOld) return fail(id, "modules.error.core", { detail: error.needs, needsCore: error.needs, rolledBack });
    if (error instanceof LoadCheckFailed) { await noteBlockedUpdate(id, row.version, targetVersion, error, "reinstall"); return fail(id, "modules.error.loadCheck", { loadError: error.reason, rolledBack }); }
    const detail = (error as { detail?: unknown })?.detail;
    return fail(id, (error as { code?: string })?.code ?? "modules.error.clone", { rolledBack, ...(typeof detail === "string" ? { detail } : {}) });
  } finally {
    source?.cleanup();
    fs.rmSync(backup, { recursive: true, force: true });
    busy.delete(id);
  }
}

/** Ligne du journal d'audit : identifiants, versions et empreintes seulement (jamais d'adresse de dépôt, de jeton ni de réglage). */
export function reinstallAuditTarget(r: Extract<ReinstallResult, { ok: true }>): string {
  const s = (x: Snapshot) => `${x.version}@${shortHash(x.hash)}`;
  return `${r.id} ${s(r.before)} -> ${s(r.after)}${r.changed ? "" : " (identique)"}`;
}

/* ───────────── Texte du bilan ───────────── */

type T = (key: string, params?: Record<string, string | number>) => string;

/** Le bilan lisible d'une réinstallation (une ligne par information). Les clés de traduction sont toutes dans `maintenance.*` et `modules.error.*`. */
export function describeReinstall(r: ReinstallResult, t: T): { ok: boolean; lines: string[] } {
  if (!r.ok) {
    const lines = [t(r.error.startsWith("modules.error.") ? r.error : "error.generic", { permissions: r.detail ?? "", services: r.detail ?? "", modules: r.detail ?? "" })];
    if (r.rolledBack) lines.push(t("maintenance.rolledBack"));
    return { ok: false, lines };
  }
  const s = (x: Snapshot) => `${x.version} · ${shortHash(x.hash)}`;
  const lines = [r.changed ? t("maintenance.result.changed", { before: s(r.before), after: s(r.after) }) : t("maintenance.result.same")];
  if (r.migrations.some((m) => m.status === "failed" || m.status === "newer")) lines.push(t("maintenance.result.migration"));
  if (r.restartAdvised) lines.push(t("maintenance.result.restart"));
  return { ok: !r.migrations.some((m) => m.status === "failed" || m.status === "newer"), lines };
}
