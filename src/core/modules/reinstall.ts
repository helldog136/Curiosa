import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Module } from "@prisma/client";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { readUpdateState } from "../updates/service";
import { compareVersions } from "../updates/versions";
import { listBundled } from "./catalogue";
import { incompatWithThisCore, requirementOf } from "./compat";
import { migrateModuleInstances, type MigrationOutcome } from "./dataMigrations";
import { CoreTooOld, dirSize, git, isCommitRef, isInside, copyModuleFiles, subdirTarget } from "./installer";
import { parseManifest, type ParsedManifest } from "./manifest";
import { getRecognized } from "./recognized";
import { bumpImportStamp, forgetModule, moduleDir, readGitManifest } from "./registry";

/**
 * RÉINSTALLATION D'UN MODULE (maintenance). Remet le CODE d'un module installé à neuf depuis sa source, même si le numéro de version est identique
 * (le cas qui piège la mise à jour : un module « livré » n'est comparé que par son numéro). Tout le reste est conservé : instances, réglages,
 * données, état activé/désactivé, rangement, placements d'accueil, droits MCP (rien de cela n'est touché : seule la ligne `Module` et son dossier le sont).
 *
 * Sources : livré avec le framework (copie du serveur) ; dépôt git (en sous-dossier ou à la racine : même référence que la mise à jour, voir
 * `subdirTarget`) ; sinon refus. « Réinstaller = remettre la version actuellement proposée par la source du module », jamais plus.
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

const bundledDir = (id: string): string | undefined => listBundled().find((e) => e.id === id)?.dir;
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
  /** Empreinte du dossier installé, calculée à la demande. */
  installedHash: string | null;
  /** Null : pas comparé (la source est sur le réseau et on n'a pas demandé la comparaison). */
  comparison: Comparison | null;
};

/**
 * Ce que le propriétaire voit : version, source, empreinte du code installé. `compare: "local"` compare avec la copie livrée (aucun réseau) ;
 * `compare: "network"` compare aussi avec un dépôt git (téléchargement explicite). Ne lève jamais.
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
  const compareTo = (root: string, cleanup?: () => void): Comparison => {
    try {
      const src = fingerprintDir(root);
      const sv = readManifestAt(root)?.version;
      return { state: installed && installed.hash === src.hash ? "identical" : "different", sourceHash: src.hash, ...(sv ? { sourceVersion: sv } : {}) };
    } catch { return { state: "unavailable" }; } finally { cleanup?.(); }
  };
  if (kind === "bundled" && mode !== "none") {
    const dir = bundledDir(id);
    out.comparison = dir ? compareTo(dir) : { state: "unavailable" };
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
    /** Des fichiers secondaires du module (pas le fichier principal) ont changé : Node peut en garder l'ancienne copie en mémoire jusqu'au redémarrage du site. */
    restartAdvised: boolean;
    /** Le catalogue reconnu propose une version plus récente de ce module : la réinstallation ne la prend PAS (elle remet la version de la source actuelle). */
    catalogueNewer?: string;
  }
  | { ok: false; id: string; error: string; detail?: string; needsCore?: string; /** L'échange avait commencé : l'ancien code a été remis tel quel. */ rolledBack: boolean };

export type ReinstallOptions = {
  /** Dossier de l'état des mises à jour du site (tests). */
  dataDir?: string;
  /** Index du catalogue reconnu (tests, sans réseau). */
  recognized?: () => Promise<{ id: string; version?: string }[]>;
  /** Appelé juste après l'échange des fichiers, avant la base (tests : simule un échec en cours d'échange). */
  afterSwap?: () => Promise<void> | void;
};

const fail = (id: string, error: string, extra: { detail?: string; needsCore?: string; rolledBack?: boolean } = {}): ReinstallResult => ({ ok: false, id, error, rolledBack: false, ...extra });

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
  try {
    // 1. La source : copie livrée ou dépôt git.
    if (kind === "bundled") {
      const dir = bundledDir(id);
      if (!dir) return fail(id, "modules.error.reinstallNoSource");
      source = { root: dir, commit: null, tree: null, ref: null, cleanup: () => {} };
    } else {
      source = await fetchGitSource(row);
    }

    // 2. Contrôles, AVANT de toucher à quoi que ce soit.
    const manifest = readManifestAt(source.root);
    if (!manifest) return fail(id, "modules.error.nomanifest");
    if (manifest.id !== id) return fail(id, "modules.error.idmismatch");
    if (manifest.main && !fs.existsSync(path.join(source.root, manifest.main))) return fail(id, "modules.error.nomain");
    if (dirSize(source.root) > MAX_MODULE_BYTES) return fail(id, "modules.error.size");
    const inc = incompatWithThisCore(requirementOf(manifest));
    if (inc) return fail(id, "modules.error.core", { detail: inc.needs, needsCore: inc.needs });
    // Jamais de permission accordée en silence : une version qui en demande de nouvelles passe par la mise à jour / le catalogue (où elles sont montrées).
    const installedManifest = readGitManifest(id);
    if (installedManifest) {
      const added = manifest.permissions.filter((p) => !installedManifest.permissions.includes(p));
      if (added.length) return fail(id, "modules.error.reinstallPerms", { detail: added.join(", ") });
    }

    const oldFp = tryFingerprint(target);
    const newFp = fingerprintDir(source.root);
    const before: Snapshot = { version: row.version, hash: oldFp?.hash ?? null, commit: row.commit };
    const after: Snapshot = { version: manifest.version, hash: newFp.hash, commit: source.commit ?? row.commit };
    const catalogueNewer = kind === "bundled" ? await newerInCatalogue(id, manifest.version, opts) : undefined;
    const extra = catalogueNewer ? { catalogueNewer } : {};

    // 3. Déjà identique : rien à échanger (on vide seulement la mémoire du module, au cas où le processus en garderait une autre copie).
    if (oldFp && oldFp.hash === newFp.hash && row.version === manifest.version) {
      if (source.commit && (source.commit !== row.commit || (source.tree ?? null) !== (row.tree ?? null))) {
        await prisma.module.update({ where: { id }, data: { commit: source.commit, tree: source.tree } });
      }
      bumpImportStamp(id);
      forgetModule(id);
      return { ok: true, id, changed: false, before, after: { ...after, commit: source.commit ?? row.commit }, migrations: [], restartAdvised: false, ...extra };
    }

    // 4. Échange : l'ancien dossier est mis de côté, et revient tel quel au moindre échec.
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    swapped = true;
    if (source.wholeDir) fs.renameSync(source.wholeDir, target);   // module à la racine d'un dépôt : le dossier garde son .git
    else copyModuleFiles(source.root, target);
    await opts.afterSwap?.();
    const data = kind === "git" ? { version: manifest.version, commit: source.commit, tree: source.tree } : { version: manifest.version };
    await prisma.module.update({ where: { id }, data });
    dbChanged = true;
    bumpImportStamp(id);
    forgetModule(id);
    const migrations = await migrateModuleInstances(id);
    swapped = false;

    const mainOf = manifest.main;
    const restartAdvised = !!oldFp && Object.keys({ ...oldFp.files, ...newFp.files }).some((f) => /\.(m?js|cjs)$/.test(f) && f !== mainOf && oldFp.files[f] !== newFp.files[f]);
    return { ok: true, id, changed: true, before, after, migrations, restartAdvised, ...extra };
  } catch (error) {
    let rolledBack = false;
    if (swapped) {
      fs.rmSync(target, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, target);
      if (dbChanged) await prisma.module.update({ where: { id }, data: { version: row.version, commit: row.commit, tree: row.tree } }).catch(() => {});
      rolledBack = true;
    }
    bumpImportStamp(id);   // si le nouveau code a été chargé le temps d'un essai, le rétabli ne doit pas en hériter
    forgetModule(id);
    console.error("[modules] reinstall failed:", (error as Error)?.message);
    if (error instanceof CoreTooOld) return fail(id, "modules.error.core", { detail: error.needs, needsCore: error.needs, rolledBack });
    return fail(id, (error as { code?: string })?.code ?? "modules.error.clone", { rolledBack });
  } finally {
    source?.cleanup();
    fs.rmSync(backup, { recursive: true, force: true });
    busy.delete(id);
  }
}

async function newerInCatalogue(id: string, current: string, opts: ReinstallOptions): Promise<string | undefined> {
  try {
    const items = await (opts.recognized ?? (() => getRecognized()))();
    const v = items.find((i) => i.id === id)?.version;
    return v && compareVersions(v, current) > 0 ? v : undefined;
  } catch { return undefined; }
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
  if (r.catalogueNewer) lines.push(t("maintenance.result.catalogue", { version: r.catalogueNewer }));
  return { ok: !r.migrations.some((m) => m.status === "failed" || m.status === "newer"), lines };
}
