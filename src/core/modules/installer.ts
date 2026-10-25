import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Module } from "@prisma/client";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { parseManifest, type ParsedManifest } from "./manifest";
import { forgetModule, getModule, moduleDir, readGitManifest, verifyModuleLoad } from "./registry";
import { LoadCheckFailed, preflightModule } from "./loadCheck";
import { clearBlockedUpdate, noteBlockedUpdate as noteBlocked } from "./blockedUpdate";
import { staticImportsWarning } from "./staticImports";
import { catalogueUnreachable, findCatalogueEntry, getCatalogue, type CatalogueEntry } from "./catalogue";
import { hardNeeds, offerVersionOf, satisfiesVersion } from "./serviceVersions";
import { checkBundledRow, convertToCatalogue } from "./bundledUpdate";
import { dependentsOf } from "./dependencies";
import { eraseRetired, restoreModuleInstances, retireModuleInstances } from "./retired";
import { commitJournal, newJournal, satisfyRequirements, unwind, type DepOps, type Journal, type Missing } from "./dependencyInstaller";
import { forgetAuto } from "./autoInstalled";
import { migrateModuleInstances, type MigrationOutcome } from "./dataMigrations";
import { incompatWithThisCore, requirementOf, type CoreRequirement } from "./compat";
import { classify, compareVersions, pickLatestTag, TAG_RE, type UpdateLevel } from "../updates/versions";
import { opStep } from "../operations/tracker";

const run = promisify(execFile);

const MAX_MODULE_BYTES = 10 * 1024 * 1024;
const DEFAULT_HOSTS = "github.com,gitlab.com,codeberg.org,bitbucket.org";

/** Remarque sur un module qui s'installe : ses fichiers voisins sont importés de façon statique (fragile hors du cœur 0.2.13+, voir staticImports.ts). */
export type LoadWarning = { code: "staticImports"; files: string[] };

export type InstallResult = {
  ok: true; id: string; migrations?: MigrationOutcome[];
  /** Ligne du journal d'audit quand la mise à jour a changé la SOURCE du module (module de base converti en module du catalogue). */
  auditTarget?: string;
  /** Modules apportés d'office par la cascade des dépendances (installés ou activés). */
  provided?: string[];
  /** Réinstallation d'un module dont les données avaient été gardées : clés des instances retrouvées telles quelles. */
  restored?: string[];
  /** Désinstallation en gardant les données : combien d'instances ont été rangées. */
  kept?: number;
  /** Mise à jour réussie, mais il manque encore de quoi faire fonctionner le module : à dire à l'administrateur. */
  missing?: Missing[];
  /** Réussite avec une remarque (jamais un refus) : voir staticImports.ts. */
  warnings?: LoadWarning[];
} | { ok: false; error: string; /** Erreur « modules.error.loadCheck » : raison courte (anglais, sans chemin) pour le journal et l'assistant ; JAMAIS à montrer telle quelle à la propriétaire. */ loadError?: string; /** Le contrôle de chargement a refusé la nouvelle version ET l'ancienne a été remise : le module tourne comme avant. */ rolledBack?: boolean; /** Détail structuré de ce qui manque (service, version, cause) quand l'erreur est « modules.error.requires ». */ missing?: Missing[]; /** Précision lisible (ex. les services manquants). */ detail?: string; /** Erreur « modules.error.core » : version du cœur que le module demande (voir compat.ts). */ needsCore?: string };

/** Le module demande un cœur plus récent que celui-ci : on refuse d'entrer ou de monter de version (jamais de désactiver un module déjà là). */
export class CoreTooOld extends Error {
  readonly needs: string;
  constructor(needs: string) { super("core too old"); this.needs = needs; }
}
const coreRefusal = (e: CoreTooOld): InstallResult => ({ ok: false, error: "modules.error.core", detail: e.needs, needsCore: e.needs });
/** Le contrôle de chargement (loadCheck.ts) a refusé le code. `rolledBack` : une ancienne version était en place et a été remise. */
const loadCheckRefusal = (e: LoadCheckFailed, rolledBack: boolean): InstallResult => ({ ok: false, error: "modules.error.loadCheck", loadError: e.reason, rolledBack });
/** Lève CoreTooOld si CE cœur ne satisfait pas l'exigence. */
function assertCore(requires: CoreRequirement | undefined): void {
  const inc = incompatWithThisCore(requires);
  if (inc) throw new CoreTooOld(inc.needs);
}

/** Dépôt d'un module : `subdir` = dossier du module dans un dépôt qui en regroupe plusieurs (absent = module à la racine). */
export type ParsedRepo = { url: string; ref?: string; subdir?: string };

/** Dossier d'un module dans un dépôt : 1 à 3 niveaux, noms simples, jamais « .. » ni chemin absolu. */
export const SUBDIR_RE = /^[A-Za-z0-9][\w.-]{0,60}(\/[A-Za-z0-9][\w.-]{0,60}){0,2}$/;
export const isSubdir = (v: unknown): v is string => typeof v === "string" && SUBDIR_RE.test(v);

/**
 * Accepte https://hôte/propriétaire/dépôt[.git][#ref]. Seuls les hôtes de
 * MODULES_ALLOWED_HOSTS sont autorisés ("*" = tous). Un module peut vivre dans un DOSSIER d'un dépôt qui en regroupe plusieurs :
 * `https://hôte/propriétaire/dépôt#étiquette:dossier` (ou `#:dossier` pour la branche par défaut). Les dépôts locaux
 * (file://) ne sont acceptés que si CURIOSA_ALLOW_LOCAL_MODULES=1, pour le
 * développement d'un module.
 */
export function parseRepoUrl(input: string): { ok: true; repo: ParsedRepo } | { ok: false; error: string } {
  const [rawUrl = "", fragment] = input.trim().split("#");
  const [rawRef, subdir] = fragment === undefined ? [undefined, undefined] : fragment.split(":");
  const ref = rawRef === "" ? undefined : rawRef;
  if (ref !== undefined && !/^[\w./-]{1,100}$/.test(ref)) return { ok: false, error: "modules.error.ref" };
  if (subdir !== undefined && !isSubdir(subdir)) return { ok: false, error: "modules.error.subdir" };
  if (fragment !== undefined && fragment.split(":").length > 2) return { ok: false, error: "modules.error.ref" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "modules.error.url" };
  }
  if (url.protocol === "file:") {
    if (process.env.CURIOSA_ALLOW_LOCAL_MODULES !== "1") return { ok: false, error: "modules.error.local" };
    return { ok: true, repo: { url: url.href, ref, ...(subdir ? { subdir } : {}) } };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search) {
    return { ok: false, error: "modules.error.url" };
  }
  const allowed = (process.env.MODULES_ALLOWED_HOSTS || DEFAULT_HOSTS).split(",").map((h) => h.trim().toLowerCase());
  if (!allowed.includes("*") && !allowed.includes(url.hostname.toLowerCase())) {
    return { ok: false, error: "modules.error.host" };
  }
  if (!/^\/[\w.-]+(\/[\w.-]+){1,3}(\.git)?\/?$/.test(url.pathname)) return { ok: false, error: "modules.error.url" };
  url.hash = "";
  return { ok: true, repo: { url: url.href.replace(/\/$/, ""), ref, ...(subdir ? { subdir } : {}) } };
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };

function gitArgs(args: string[]): string[] {
  const protocolFile = process.env.CURIOSA_ALLOW_LOCAL_MODULES === "1" ? "always" : "never";
  return [
    "-c", "protocol.ext.allow=never",
    "-c", `protocol.file.allow=${protocolFile}`,
    "-c", "core.hooksPath=/dev/null",
    ...args,
  ];
}

export async function git(args: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
  const { stdout } = await run("git", gitArgs(args), { cwd, timeout: 90_000, env: env ? { ...GIT_ENV, ...env } : GIT_ENV, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

export function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("symlinks are not allowed in a module");
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

/** `child` est-il bien DANS `parent` (liens symboliques résolus) ? Empêche un dossier de module qui pointerait hors du dépôt. */
export function isInside(parent: string, child: string): boolean {
  try {
    const p = fs.realpathSync(parent);
    const c = fs.realpathSync(child);
    return c.startsWith(p + path.sep) && fs.lstatSync(child).isDirectory();
  } catch { return false; }
}

/** Copie les fichiers d'un module (sans .git ni node_modules) vers son dossier d'installation, par un dossier intermédiaire : jamais à moitié copié. */
export function copyModuleFiles(from: string, target: string): void {
  const staging = `${target}.incoming-${process.pid}`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(from, staging, { recursive: true, filter: (src) => path.basename(src) !== ".git" && path.basename(src) !== "node_modules" });
    if (dirSize(staging) > MAX_MODULE_BYTES) throw new Error("size");
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Pose le contenu de `FETCH_HEAD` (dépôt du module déjà récupéré dans `dir`) dans un dossier temporaire, SANS toucher au dossier du module, à son index ni à sa branche :
 * c'est là que le contrôle de chargement essaie le nouveau code avant tout échange. `cleanup` efface le dossier temporaire.
 */
async function stageFetchHead(dir: string): Promise<{ root: string; cleanup: () => void }> {
  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-stage-"));
  const root = path.join(tmp, "tree");
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.mkdirSync(root);
    const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
    await git(["read-tree", "FETCH_HEAD"], dir, env);
    await git(["checkout-index", "-a", "-f", `--prefix=${root}/`], dir, env);
    return { root, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Contrôle de chargement dans un processus tout neuf (loadCheck.ts) du code posé dans `root`. Lève LoadCheckFailed. */
async function preflightOrThrow(root: string, manifest: ParsedManifest): Promise<void> {
  const r = await preflightModule(root, manifest);
  if (!r.ok) throw new LoadCheckFailed(r.reason);
}

/** Contrôle de chargement dans le processus du site, depuis une copie neuve, de la version décrite par `row` (fichiers déjà posés, ligne pas encore changée). Lève LoadCheckFailed. */
async function verifyOrThrow(row: { id: string; version: string; commit: string | null }): Promise<void> {
  const r = await verifyModuleLoad(row);
  if (!r.ok) throw new LoadCheckFailed(r.reason);
}

/**
 * Installe un module depuis un dépôt git. « Installé » = « actif » : il n'y a pas d'état intermédiaire, c'est pourquoi l'accord de l'administrateur se donne AVANT
 * (case « je fais confiance » pour un dépôt personnel, fiche du catalogue). Si les données d'une désinstallation précédente avaient été gardées, elles reviennent.
 */
export async function installModule(input: string, opts: {
  expectId?: string;
  /** false : ne pas installer les fournisseurs (restauration, cascade elle-même). */ dependencies?: boolean;
  /** false : ne pas remettre les données gardées (restauration d'une sauvegarde, graine, cascade : elles ont leur propre chemin). */ restoreKept?: boolean;
} = {}): Promise<InstallResult> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return parsed;
  const { url, ref, subdir } = parsed.repo;

  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-"));
  const checkout = path.join(tmp, "repo");
  let deps: Journal | null = null;
  let candidate: { id: string; version: string } | null = null;
  try {
    opStep("download");
    if (ref && isCommitRef(ref)) {
      // Épinglé sur un commit : `clone --branch` n'accepte qu'une branche ou une étiquette. On récupère ce commit précis
      // (récupération superficielle si le serveur l'autorise, sinon tout l'historique), puis on s'y place.
      await git(["init", "-q", checkout]);
      await git(["remote", "add", "origin", url], checkout);
      await git(["fetch", "-q", "--depth", "1", "origin", ref], checkout).catch(() => git(["fetch", "-q", "origin"], checkout));
      await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", ref], checkout);
    } else {
      await git(["clone", "--depth", "1", "--single-branch", ...(ref ? ["--branch", ref] : []), "--", url, checkout]);
    }
    const commit = await git(["rev-parse", "HEAD"], checkout);
    opStep("verify");

    // Module dans un dossier d'un dépôt qui en regroupe plusieurs : seul ce dossier est lu, copié et installé.
    const root = subdir ? path.join(checkout, subdir) : checkout;
    if (subdir && !isInside(checkout, root)) return { ok: false, error: "modules.error.nosubdir" };
    const manifestPath = path.join(root, "module.json");
    if (!fs.existsSync(manifestPath)) return { ok: false, error: subdir ? "modules.error.nosubdir" : "modules.error.nomanifest" };
    const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    if (!manifest.ok) return { ok: false, error: manifest.error };
    const m = manifest.manifest;
    candidate = { id: m.id, version: m.version };
    // Un dépôt reconnu ne peut pas servir un autre module que celui annoncé.
    if (opts.expectId && m.id !== opts.expectId) return { ok: false, error: "modules.error.idmismatch" };
    assertCore(requirementOf(m));

    if (m.main && !fs.existsSync(path.join(root, m.main))) return { ok: false, error: "modules.error.nomain" };
    if (dirSize(root) > MAX_MODULE_BYTES) return { ok: false, error: "modules.error.size" };

    const existing = await prisma.module.findUnique({ where: { id: m.id } });
    if (existing) return { ok: false, error: "modules.error.exists" };

    // Contrôle de chargement AVANT de rien installer (ni module, ni fournisseurs) : un code qui ne se charge pas n'entre pas.
    await preflightOrThrow(root, m);

    // Les fournisseurs d'abord : si l'un d'eux ne peut pas être installé, rien n'est laissé (ni lui, ni ce module).
    if (opts.dependencies !== false && m.requires?.length) {
      opStep("deps");
      const r = await satisfyRequirements(m, depOps());
      deps = r.journal;
      if (!r.ok) { await unwind(deps); deps = null; return requirementsRefusal(r.missing); }
    }

    opStep("activate");
    let tree: string | null = null;
    if (subdir) {
      tree = await git(["rev-parse", `HEAD:${subdir}`], checkout);
      copyModuleFiles(root, moduleDir(m.id));
    } else {
      fs.renameSync(checkout, moduleDir(m.id));
    }
    await prisma.module.create({
      data: { id: m.id, source: "git", repoUrl: url, ref: ref ?? null, commit, subdir: subdir ?? null, tree, version: m.version, enabled: true },
    });
    // Et dans le processus du site, depuis une copie neuve : c'est ce que le site exécutera. Échec : rien n'est laissé (ni module, ni fournisseurs).
    const verdict = await verifyModuleLoad({ id: m.id, version: m.version, commit });
    if (!verdict.ok) { await purgeModule(m.id); throw new LoadCheckFailed(verdict.reason); }
    if (deps) await commitJournal(deps);
    opStep("data");
    const kept = opts.restoreKept === false ? null : await restoreModuleInstances(m.id);
    const warning = staticImportsWarning(moduleDir(m.id));
    return {
      ok: true, id: m.id, ...(warning ? { warnings: [warning] } : {}), ...(deps?.provided.length ? { provided: deps.provided } : {}),
      ...(kept?.restored.length ? { restored: kept.restored.map((r) => r.key) } : {}), ...(kept?.migrations.length ? { migrations: kept.migrations } : {}),
    };
  } catch (error) {
    if (deps) await unwind(deps);
    if (error instanceof CoreTooOld) return coreRefusal(error);
    if (error instanceof LoadCheckFailed) { await noteBlocked(candidate?.id ?? "?", "", candidate?.version ?? "?", error, "install"); return loadCheckRefusal(error, false); }
    console.error("[modules] install failed:", error);
    return { ok: false, error: "modules.error.clone" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isStableTag = (ref: string | null | undefined): ref is string => !!ref && TAG_RE.test(ref);
export const isCommitRef = (ref: string | null | undefined): boolean => !!ref && /^[0-9a-f]{7,40}$/i.test(ref);

export type ModuleUpdateCheck = {
  available: boolean;
  /** Version vers laquelle on passerait (étiquette, numéro de version ou commit). */
  target?: string;
  /** Pour un module épinglé sur une étiquette : nature du changement (« major » = à lire avant d'installer). */
  level?: UpdateLevel;
  remote?: string;
  /** La version proposée demande ce cœur (ou plus) et le nôtre est trop ancien : la mise à jour sera refusée. */
  needsCore?: string;
};

/* ───────────── Modules logés dans un dossier d'un dépôt qui en regroupe plusieurs ───────────── */

type Fetched = { root: string; commit: string; tree: string; manifest: ParsedManifest | null; cleanup: () => void };

/**
 * Récupère (superficiellement) un dépôt à une étiquette, une branche ou un commit, et lit le dossier du module. L'empreinte `tree` est celle du CONTENU de ce
 * dossier : elle ne change que si ce module change, pas quand un autre module du même dépôt évolue.
 */
async function fetchSubdirSource(url: string, ref: string | null | undefined, subdir: string): Promise<Fetched> {
  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-"));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const checkout = path.join(tmp, "repo");
    await git(["init", "-q", checkout]);
    await git(["remote", "add", "origin", url], checkout);
    await git(["fetch", "-q", "--depth", "1", "origin", ref || "HEAD"], checkout).catch((e) => {
      if (ref && isCommitRef(ref)) return git(["fetch", "-q", "origin"], checkout);   // certains serveurs refusent de livrer un commit seul
      throw e;
    });
    await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", isCommitRef(ref) ? ref! : "FETCH_HEAD"], checkout);
    const root = path.join(checkout, subdir);
    if (!isInside(checkout, root)) throw Object.assign(new Error("subdir"), { code: "modules.error.nosubdir" });
    const commit = await git(["rev-parse", "HEAD"], checkout);
    const tree = await git(["rev-parse", `HEAD:${subdir}`], checkout);
    let manifest: ParsedManifest | null = null;
    try { const p = parseManifest(JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"))); manifest = p.ok ? p.manifest : null; } catch { manifest = null; }
    return { root, commit, tree, manifest, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export const sameRepo = (a: string | null | undefined, b: string | null | undefined) => {
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return norm(a) === norm(b);
};

/** Quelle étiquette ou quel commit suivre ? Un module installé DEPUIS LE CATALOGUE suit le commit relu que le catalogue épingle ; un module personnel suit la sienne. */
export async function subdirTarget(row: Module): Promise<{ ref: string | null; fromCatalogue: boolean }> {
  const entry = await findCatalogueEntry(row.id).catch(() => undefined);
  const same = !!entry && sameRepo(entry.repo, row.repoUrl) && (entry.subdir ?? null) === row.subdir;
  return { ref: same ? entry!.ref ?? null : row.ref, fromCatalogue: !!same };
}

async function checkSubdirUpdate(row: Module): Promise<ModuleUpdateCheck> {
  const { ref, fromCatalogue } = await subdirTarget(row);
  if (!fromCatalogue && isCommitRef(row.ref)) return { available: false };   // épinglé sur un commit : c'est le but
  const f = await fetchSubdirSource(row.repoUrl!, ref, row.subdir!);
  try {
    const available = f.tree !== row.tree;
    const version = f.manifest?.version;
    return {
      available, remote: f.commit,
      target: available ? (version && version !== row.version ? version : f.commit.slice(0, 7)) : undefined,
      level: available && version ? classify(row.version, version) ?? undefined : undefined,
      needsCore: available ? incompatWithThisCore(f.manifest ? requirementOf(f.manifest) : undefined)?.needs : undefined,
    };
  } finally { f.cleanup(); }
}

async function updateSubdirModule(row: Module, chain: string[]): Promise<InstallResult> {
  const id = row.id;
  const { ref, fromCatalogue } = await subdirTarget(row);
  if (!fromCatalogue && isCommitRef(row.ref)) return { ok: false, error: "modules.error.pinned" };
  const target = moduleDir(id);
  const backup = `${target}.previous-${process.pid}`;
  let fetched: Fetched | null = null;
  let swapped = false;
  let rowChanged = false;
  let pending: Journal | null = null;
  try {
    // 1. Récupérer et valider la nouvelle version (cœur compris), sans rien migrer.
    opStep("download");
    fetched = await fetchSubdirSource(row.repoUrl!, ref, row.subdir!);
    opStep("verify");
    if (fetched.tree === row.tree) return { ok: false, error: "modules.error.uptodate" };
    const manifest = fetched.manifest;
    if (!manifest || manifest.id !== id) throw Object.assign(new Error("manifest"), { code: "modules.error.nomanifest" });
    if (manifest.main && !fs.existsSync(path.join(fetched.root, manifest.main))) throw Object.assign(new Error("main"), { code: "modules.error.nomain" });
    if (dirSize(fetched.root) > MAX_MODULE_BYTES) throw Object.assign(new Error("size"), { code: "modules.error.size" });
    assertCore(requirementOf(manifest));
    // Contrôle de chargement dans un processus tout neuf, AVANT de toucher à quoi que ce soit : un code qui ne se charge pas n'est pas échangé.
    await preflightOrThrow(fetched.root, manifest);
    // 2. Échanger les fichiers : l'ancienne version est mise de côté et revient telle quelle au moindre échec (jusqu'aux migrations).
    fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(target, backup);
    swapped = true;
    copyModuleFiles(fetched.root, target);
    // Puis dans le processus du site, depuis une copie neuve, AVANT de basculer la ligne en base : la version d'avant sert jusque-là.
    const next = { id, version: manifest.version, commit: fetched.commit };
    await verifyOrThrow(next);
    await prisma.module.update({ where: { id }, data: { commit: fetched.commit, tree: fetched.tree, version: manifest.version, ref: ref ?? row.ref } });
    rowChanged = true;
    forgetModule(id, next);
    // 3. Les `requires` durs de la NOUVELLE version, avant toute migration (même journal d'annulation).
    opStep("deps");
    const settled = await settleBeforeMigrations(manifest, chain);
    if (!settled.ok) throw new RequirementsMissing(settled.missing);
    pending = settled.journal;
    // 5. Migrer. Un échec met l'instance à l'écart (« Réessayer ») : les fournisseurs restent (journal validé), « Réessayer » en a besoin.
    opStep("data");
    const migrations = await migrateModuleInstances(id);
    swapped = false;
    rowChanged = false;
    pending = null;
    opStep("activate");
    const after = await afterMigrations(id, settled);
    await clearBlockedUpdate(id);
    const warning = staticImportsWarning(target);
    return { ok: true, id, migrations, ...(warning ? { warnings: [warning] } : {}), ...(after.provided.length ? { provided: after.provided } : {}), ...(after.missing ? { missing: after.missing } : {}) };
  } catch (error) {
    if (pending) await unwind(pending);   // panne exceptionnelle pendant les migrations (elles ne lèvent pas d'ordinaire) : tout est défait
    if (swapped) { fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(backup, target); }
    if (rowChanged) await prisma.module.update({ where: { id }, data: { commit: row.commit, tree: row.tree, version: row.version, ref: row.ref } }).catch(() => {});
    forgetModule(id);
    if (error instanceof RequirementsMissing) return requirementsRefusal(error.missing);
    if (error instanceof CoreTooOld) return coreRefusal(error);
    if (error instanceof LoadCheckFailed) { await noteBlocked(id, row.version, fetched?.manifest?.version ?? "?", error, "update"); return loadCheckRefusal(error, true); }
    console.error("[modules] update failed:", (error as Error)?.message);
    return { ok: false, error: (error as { code?: string })?.code ?? "modules.error.clone" };
  } finally {
    fetched?.cleanup();
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

/** Toutes les versions stables (`vX.Y.Z`) du dépôt, de la plus ancienne à la plus récente. */
async function remoteTags(repoUrl: string): Promise<string[]> {
  const out = await git(["ls-remote", "--tags", "--refs", "--", repoUrl]);
  const tags = out.split("\n").map((l) => l.split("refs/tags/")[1]?.trim()).filter((t): t is string => !!t && TAG_RE.test(t));
  return tags.sort(compareVersions);
}

/** Plus haute version stable (`vX.Y.Z`) du dépôt d'un module. */
async function latestRemoteTag(repoUrl: string): Promise<string | null> {
  return pickLatestTag(await git(["ls-remote", "--tags", "--refs", "--", repoUrl]));
}

/**
 * Y a-t-il une version plus récente ? Le sens dépend de la façon dont le module a été installé :
 *   - épinglé sur une ÉTIQUETTE (`#v1.2.0`, le cas recommandé) : la plus haute version stable du dépôt ;
 *   - épinglé sur un commit : jamais (c'est le but) ;
 *   - sur une branche (ou la branche par défaut) : le dernier commit de cette branche ;
 *   - ligne `bundled` d'un ancien site (compatibilité, à retirer en 0.3.0) : la version du catalogue (qui la convertit en module du catalogue).
 */
export async function checkForUpdate(id: string): Promise<ModuleUpdateCheck> {
  return (await checkForUpdateDetailed(id)).check;
}

/** Comme `checkForUpdate`, mais dit si la vérification elle-même a échoué (réseau, dépôt absent) plutôt que de la confondre avec « à jour ». */
export async function checkForUpdateDetailed(id: string): Promise<{ check: ModuleUpdateCheck; failed: boolean }> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (row?.source === "bundled") {
    return checkBundledRow(row, await findCatalogueEntry(id).catch(() => undefined));
  }
  if (!row || row.source !== "git" || !row.repoUrl) return { check: { available: false }, failed: false };
  const res = await checkGitUpdate(row);
  if (res.check.available && !res.check.needsCore && !row.subdir) {
    // Sans télécharger : l'index du catalogue dit si la version proposée demande un cœur plus récent (sinon le refus viendra à la mise à jour).
    const entry = await findCatalogueEntry(id).catch(() => undefined);
    if (entry && sameRepo(entry.repo, row.repoUrl) && !entry.subdir && entry.needsNewerCore) return { ...res, check: { ...res.check, needsCore: entry.needsNewerCore } };
  }
  return res;
}

async function checkGitUpdate(row: Module): Promise<{ check: ModuleUpdateCheck; failed: boolean }> {
  try {
    if (row.subdir) return { check: await checkSubdirUpdate(row), failed: false };
    if (isCommitRef(row.ref)) return { check: { available: false }, failed: false };
    if (isStableTag(row.ref)) {
      const latest = await latestRemoteTag(row.repoUrl!);
      const level = latest ? classify(row.ref, latest) : null;
      return { check: level ? { available: true, target: latest!, remote: latest!, level } : { available: false, remote: latest ?? undefined }, failed: false };
    }
    const out = await git(["ls-remote", "--", row.repoUrl!, row.ref ? `refs/heads/${row.ref}` : "HEAD"]);
    const remote = out.split(/\s+/)[0];
    return { check: { available: !!remote && remote !== row.commit, remote, target: remote?.slice(0, 7) }, failed: false };
  } catch {
    return { check: { available: false }, failed: true };
  }
}

/**
 * Met un module à jour SANS toucher à ses données : seuls les fichiers du module changent ; ses instances, réglages et données
 * (stockage, entrées) restent tels quels. Épinglé sur une étiquette, il passe à la plus haute version stable. Si la nouvelle version est
 * invalide (manifeste illisible, autre identifiant, API incompatible, trop volumineuse), l'ancienne est rétablie : le module ne casse jamais.
 *
 * ORDRE (contrat 3) : fichiers de la nouvelle version → ses `requires` durs satisfaits (fournisseurs installés ou mis à jour, dans un journal
 * d'annulation) → migrations des données. Un besoin impossible à satisfaire : tout est défait, le module reste dans son ancienne version, ses
 * données intactes (`modules.error.requires` + `missing`). Une migration qui échoue met l'instance à l'écart avec « Réessayer » ; les fournisseurs restent.
 */
export async function updateModule(id: string): Promise<InstallResult> {
  return updateModuleWithin(id, [id]);
}

/** `chain` : chaîne des modules en cours de mise à jour ou d'installation (un fournisseur mis à jour par la cascade ne peut pas redemander l'un d'eux). */
async function updateModuleWithin(id: string, chain: string[]): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (row?.source === "bundled") {
    // Compatibilité sites anciens, à retirer en 0.3.0 : le catalogue est la source, jamais une copie locale.
    const entry = await findCatalogueEntry(id);
    if (entry) {
      const r = await convertToCatalogue(row, entry, (manifest) => settleBeforeMigrations(manifest, chain));   // voir bundledUpdate.ts
      if (!r.ok) return r;
      const late = await settleDependencies(id);   // besoins couverts par un semis : vérifiés après les migrations (voir afterMigrations)
      const provided = [...new Set([...(r.provided ?? []), ...(late.provided ?? [])])];
      return { ...r, ...(provided.length ? { provided } : {}), ...(late.missing?.length ? { missing: late.missing } : {}) };
    }
    return { ok: false, error: (await catalogueUnreachable()) ? "modules.error.catalogue" : "modules.error.unknownSource" };
  }
  if (!row || row.source !== "git" || !row.repoUrl) return { ok: false, error: "modules.error.notfound" };
  if (row.subdir) return updateSubdirModule(row, chain);
  const dir = moduleDir(id);
  let previous: string | null = null;
  /** Dernière version dont les données ont déjà été migrées (versions sautées) : en cas d'échec, on y revient, jamais plus loin en arrière. */
  let reached: { commit: string; version: string; ref: string } | null = null;
  const provided: string[] = [];
  let pending: Journal | null = null;
  let targetVersion = "?";
  try {
    previous = await git(["rev-parse", "HEAD"], dir);
    let newRef = row.ref;
    let fetchRef: string;
    if (isCommitRef(row.ref)) return { ok: false, error: "modules.error.pinned" };
    if (isStableTag(row.ref)) {
      const latest = await latestRemoteTag(row.repoUrl);
      if (!latest || !classify(row.ref, latest)) return { ok: false, error: "modules.error.uptodate" };
      newRef = latest;
      fetchRef = `refs/tags/${latest}`;
    } else {
      fetchRef = row.ref ?? "HEAD";
    }
    // 1. Le cœur est-il assez récent pour la version visée ? On le lit AVANT de toucher au dossier du module (ni retour en arrière, ni migration à défaire).
    opStep("download");
    await git(["fetch", "--depth", "1", "origin", fetchRef], dir);
    opStep("verify");
    const incoming = await git(["show", "FETCH_HEAD:module.json"], dir).then((t) => parseManifest(JSON.parse(t))).catch(() => null);   // illisible : le contrôle habituel plus bas s'en charge
    if (incoming?.ok) {
      assertCore(requirementOf(incoming.manifest));
      targetVersion = incoming.manifest.version;
      // Contrôle de chargement dans un processus tout neuf, AVANT de toucher au dossier du module : le nouveau code est posé à part et essayé là.
      const staged = await stageFetchHead(dir);
      try { await preflightOrThrow(staged.root, incoming.manifest); } finally { staged.cleanup(); }
    }
    // Versions sautées : chacune à son tour, ses `requires` puis SES migrations, avec SON code, avant de passer à la dernière.
    if (isStableTag(row.ref) && newRef !== row.ref) {
      const replay = await replaySkippedReleases(id, dir, row.repoUrl, row.ref, newRef as string, chain, (step) => { reached = step.reached; provided.push(...step.provided); });
      if (replay) return replay;
    }
    // 2. Échanger les fichiers (annulation : `git reset` vers la version d'avant).
    await git(["fetch", "--depth", "1", "origin", fetchRef], dir);
    await git(["reset", "--hard", "FETCH_HEAD"], dir);
    const commit = await git(["rev-parse", "HEAD"], dir);
    const manifest = readGitManifest(id);
    if (!manifest || manifest.id !== id) throw Object.assign(new Error("manifest"), { code: "modules.error.nomanifest" });
    if (manifest.main && !fs.existsSync(path.join(dir, manifest.main))) throw Object.assign(new Error("main"), { code: "modules.error.nomain" });
    if (dirSize(dir) > MAX_MODULE_BYTES) throw Object.assign(new Error("size"), { code: "modules.error.size" });
    targetVersion = manifest.version;
    // Puis dans le processus du site, depuis une copie neuve, AVANT de basculer la ligne en base : la version d'avant sert jusque-là.
    const next = { id, version: manifest.version, commit };
    await verifyOrThrow(next);
    await prisma.module.update({ where: { id }, data: { commit, version: manifest.version, ref: newRef } });
    forgetModule(id, next);
    // 3. Les `requires` durs de la nouvelle version (journal défait en entier s'il manque quelque chose).
    opStep("deps");
    const settled = await settleBeforeMigrations(manifest, chain);
    if (!settled.ok) throw new RequirementsMissing(settled.missing);
    pending = settled.journal;
    // 5. Les données des instances suivent la nouvelle version du module (voir dataMigrations.ts) ; en cas d'échec, l'instance est remise à l'écart.
    opStep("data");
    const migrations = await migrateModuleInstances(id);
    pending = null;
    opStep("activate");
    const after = await afterMigrations(id, settled);
    provided.push(...after.provided);
    await clearBlockedUpdate(id);
    const warning = staticImportsWarning(dir);
    return { ok: true, id, migrations, ...(warning ? { warnings: [warning] } : {}), ...(provided.length ? { provided: [...new Set(provided)] } : {}), ...(after.missing ? { missing: after.missing } : {}) };
  } catch (error) {
    // Retour en arrière : à la version d'avant, ou à la dernière version intermédiaire dont les données ont été migrées (jamais du code plus ancien que les données).
    if (pending) await unwind(pending);   // panne exceptionnelle pendant les migrations (elles ne lèvent pas d'ordinaire) : la cascade est défaite aussi
    const back = reached as { commit: string; version: string; ref: string } | null;
    if (previous || back) {
      await git(["reset", "--hard", back?.commit ?? previous!], dir).catch(() => {});
      await prisma.module.update({ where: { id }, data: back ?? { commit: row.commit, version: row.version, ref: row.ref } }).catch(() => {});
    }
    forgetModule(id);
    if (error instanceof RequirementsMissing) return requirementsRefusal(error.missing);
    if (error instanceof CoreTooOld) return coreRefusal(error);
    if (error instanceof LoadCheckFailed) { await noteBlocked(id, row.version, targetVersion, error, "update"); return loadCheckRefusal(error, true); }
    console.error("[modules] update failed:", (error as Error)?.message);
    return { ok: false, error: (error as { code?: string })?.code ?? "modules.error.clone" };
  }
}

/**
 * Mise à jour 1.2 → 1.6 alors que 1.3, 1.4 et 1.5 existent : chaque version intermédiaire change peut-être le modèle de données. On extrait
 * donc chacune à son tour, on satisfait SES `requires` durs, on exécute SES migrations (jusqu'à sa propre `dataVersion`), puis on passe à la suivante ;
 * la dernière version trouve des données déjà au bon format. Les versions sans changement de données n'ont rien à déclarer.
 * Si une migration échoue, la mise à jour s'arrête sur cette version (données remises comme avant l'étape, instance mise à l'écart, « Réessayer »
 * possible) et on renvoie le résultat ; si un besoin manque, l'erreur est levée (l'appelant revient à la dernière version migrée) ; sinon `null`.
 */
async function replaySkippedReleases(id: string, dir: string, repoUrl: string, from: string, to: string, chain: string[],
  onStep: (step: { reached: { commit: string; version: string; ref: string }; provided: string[] }) => void): Promise<InstallResult | null> {
  const between = (await remoteTags(repoUrl)).filter((t) => compareVersions(t, from) > 0 && compareVersions(t, to) < 0);
  for (const tag of between) {
    await git(["fetch", "--depth", "1", "origin", `refs/tags/${tag}`], dir);
    await git(["reset", "--hard", "FETCH_HEAD"], dir);
    const manifest = readGitManifest(id);
    if (!manifest || manifest.id !== id || (manifest.dataVersion ?? 1) <= 1) continue;   // version illisible ou sans données propres : rien à rejouer
    // Le module « devient » cette version le temps de sa migration (le code est chargé d'après le commit enregistré).
    const commit = await git(["rev-parse", "HEAD"], dir);
    await prisma.module.update({ where: { id }, data: { commit, version: manifest.version, ref: tag } });
    forgetModule(id);
    const settled = await settleBeforeMigrations(manifest, chain);
    if (!settled.ok) throw new RequirementsMissing(settled.missing);
    const migrations = await migrateModuleInstances(id, { skipNewer: true });
    const after = await afterMigrations(id, settled);
    onStep({ reached: { commit, version: manifest.version, ref: tag }, provided: after.provided });
    if (migrations.some((m) => m.status === "failed" || m.status === "newer")) return { ok: true, id, migrations };
  }
  return null;
}

/** Services exigés (durs) qu'offre une cible de `seeds` du module (installée, sinon annoncée par le catalogue). */
async function seededServices(manifest: ParsedManifest): Promise<Set<string>> {
  const out = new Set<string>();
  if (!manifest.seeds?.length) return out;
  const catalogue = await getCatalogue().catch((): CatalogueEntry[] => []);
  for (const seed of manifest.seeds) {
    const offers = (await getModule(seed.module).catch(() => null))?.manifest.offers ?? catalogue.find((e) => e.id === seed.module)?.offers;
    for (const n of hardNeeds(manifest.requires)) if (satisfiesVersion(offerVersionOf(offers, n.service), n.min)) out.add(n.service);
  }
  return out;
}

/**
 * Après les migrations : valide le journal (les fournisseurs restent, « Réessayer » en a besoin), puis, si des besoins couverts par un semis
 * avaient été mis de côté, les vérifie maintenant (la migration n'a peut-être rien semé) : comme avant la 0.2.0, ce qui manque est seulement signalé.
 */
async function afterMigrations(id: string, settled: { journal: Journal; deferred?: true }): Promise<{ provided: string[]; missing?: Missing[] }> {
  await commitJournal(settled.journal);
  const provided = [...settled.journal.provided];
  if (!settled.deferred) return { provided };
  const late = await settleDependencies(id);
  return { provided: [...provided, ...(late.provided ?? [])], ...(late.missing?.length ? { missing: late.missing } : {}) };
}

/** Un besoin dur de la nouvelle version ne peut pas être satisfait : la mise à jour est défaite (voir updateModule). */
class RequirementsMissing extends Error {
  readonly missing: Missing[];
  constructor(missing: Missing[]) { super("requirements missing"); this.missing = missing; }
}

/**
 * Étape 3 d'une mise à jour : satisfaire les `requires` DURS de `manifest` (installer ou mettre à jour les fournisseurs du catalogue officiel, leur
 * instance par défaut), AVANT toute migration. Échec : le journal est déjà défait et `missing` dit quoi. Réussite : le journal est à valider
 * (`commitJournal`) une fois les migrations faites.
 */
export async function settleBeforeMigrations(manifest: ParsedManifest, chain: string[] = [manifest.id]): Promise<{ ok: true; journal: Journal; deferred?: true } | { ok: false; missing: Missing[] }> {
  const journal = newJournal(manifest.id);
  try {
    // Un besoin que la migration elle-même couvrira en SEMANT une instance (`seeds`, voir seeding.ts) attend la fin des migrations :
    // lui créer une instance par défaut avant ferait un doublon de l'instance semée.
    const deferred = await seededServices(manifest);
    const now = deferred.size ? { ...manifest, requires: manifest.requires?.filter((r) => !deferred.has(r.service)) } : manifest;
    const r = await satisfyRequirements(now, depOps(), journal, chain.includes(manifest.id) ? chain : [...chain, manifest.id]);
    if (r.ok) return { ok: true, journal, ...(deferred.size ? { deferred: true as const } : {}) };
    await unwind(journal);
    return { ok: false, missing: r.missing };
  } catch (error) {
    await unwind(journal);
    throw error;
  }
}

/* ───────────── Dépendances : gestes prêtés à dependencyInstaller.ts ───────────── */

/** Refus « il manque quelque chose » : `detail` garde la liste des services (lisible tel quel), `missing` le détail pour l'interface. */
export const requirementsRefusal = (missing: Missing[]): InstallResult => ({ ok: false, error: "modules.error.requires", detail: missing.map((x) => x.service).join(", "), missing });

/** `update: false` : ne jamais mettre à jour un fournisseur trop ancien (restauration : l'état sauvegardé est respecté). */
const depOps = (opts: { update?: boolean } = {}): DepOps => ({
  catalogue: () => getCatalogue(),
  installEntry: async (entry) => {
    // Ses données gardées (s'il y en a) reviennent avec son instance par défaut (voir ensureDefaultInstance), pas ici : le journal sait les défaire.
    const r = await installModule(`${entry.repo}${entry.ref || entry.subdir ? `#${entry.ref ?? ""}${entry.subdir ? `:${entry.subdir}` : ""}` : ""}`, { expectId: entry.id, dependencies: false, restoreKept: false });
    return r.ok ? { ok: true } : { ok: false, error: r.error, detail: r.detail };
  },
  purge: purgeModule,
  ...(opts.update === false ? {} : {
    update: async (id: string, chain: string[]) => {
      const r = await updateModuleWithin(id, chain);
      if (!r.ok) return { ok: false as const, error: r.error, detail: r.detail };
      if (r.migrations?.some((m) => m.status === "failed" || m.status === "newer")) return { ok: false as const, error: "modules.error.migration" };
      return { ok: true as const };
    },
  }),
});

/** « Mettre en place ce qui manque » : les fournisseurs des services dont le module a besoin sont installés d'office (avec leur instance) ; au moindre échec tout est défait. */
export async function repairRequirements(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  const mod = await getModule(id);
  if (!mod) return { ok: false, error: "modules.error.load" };
  const r = await satisfyRequirements(mod.manifest, depOps());
  if (!r.ok) { await unwind(r.journal); return requirementsRefusal(r.missing); }
  try {
    await commitJournal(r.journal);
  } catch (error) {
    await unwind(r.journal);
    throw error;
  }
  return { ok: true, id, ...(r.journal.provided.length ? { provided: r.journal.provided } : {}) };
}

/**
 * Vérifie les `requires` d'un module installé et, s'il manque un fournisseur disponible (catalogue), l'installe d'office avec son instance par défaut.
 * Impossible → rien n'est laissé à moitié et `missing` dit quoi. Sert après une mise à jour et après une restauration. Ne lève jamais.
 */
export async function settleDependencies(id: string): Promise<{ provided?: string[]; missing?: Missing[] }> {
  try {
    const row = await prisma.module.findUnique({ where: { id } });
    const mod = row ? await getModule(id) : null;
    if (!mod?.manifest.requires?.length) return {};
    const r = await satisfyRequirements(mod.manifest, depOps({ update: false }));
    if (!r.ok) { await unwind(r.journal); return { missing: r.missing }; }
    await commitJournal(r.journal);
    return r.journal.provided.length ? { provided: r.journal.provided } : {};
  } catch (error) {
    console.error("[modules] dependency check failed:", (error as Error)?.message);
    return {};
  }
}

/**
 * Installe le module cible d'une graine (`ctx.seedInstance`, voir seeding.ts) quand il manque : depuis le catalogue, SANS lui créer d'instance par défaut
 * (c'est l'instance semée qui fournira le service), avec ses propres dépendances.
 * Renvoie le journal de la cascade (à défaire en bloc si la migration échoue ; ses marques « installé automatiquement » s'écrivent à la réussite).
 */
export async function installSeedTarget(id: string, forModule: string, opts: { auto?: boolean } = {}): Promise<{ ok: true; journal: Journal } | { ok: false; error: string; detail?: string }> {
  const r = await installFromCatalogue(id, { dependencies: false, restoreKept: false });
  if (!r.ok) return { ok: false, error: r.error, detail: r.detail };
  const journal = newJournal(forModule);
  journal.undo.push(() => purgeModule(id));
  if (opts.auto !== false) journal.auto.push({ id, module: true, instances: [] });   // `auto: false` : lien souple (sujet), pas une dépendance — voir seeding.ts
  journal.provided.push(id);
  try {
    const mod = await getModule(id);
    if (!mod) throw new Error("modules.error.load");
    const deps = await satisfyRequirements(mod.manifest, depOps(), journal, [forModule, id]);
    if (!deps.ok) throw new Error(`modules.error.requires:${deps.missing.map((x) => x.service).join(",")}`);
    return { ok: true, journal };
  } catch (error) {
    await unwind(journal);
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

/**
 * Désinstalle un module : plus de page, de menu, de tâche, d'outil MCP ni de route publique. Deux issues, au choix de l'administrateur :
 *   - `keepData: true`  : ses instances (réglages, contenus, stockage) sont RANGÉES, inertes, dans le cœur ; réinstaller le même module les retrouve telles quelles ;
 *   - `keepData: false` : tout est effacé, y compris des données rangées auparavant (irréversible).
 * Refusée tant qu'un autre module a besoin d'un service que celui-ci est seul à fournir.
 */
export async function uninstallModule(id: string, opts: { keepData: boolean }): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  const dependents = await dependentsOf(id);
  if (dependents.length) return { ok: false, error: "modules.error.requiredBy", detail: dependents.join(", ") };
  let kept = 0;
  if (opts.keepData) kept = (await retireModuleInstances(id, "uninstall")).length;
  else await eraseRetired({ moduleId: id });
  await purgeModule(id);
  await forgetAuto(id);
  return { ok: true, id, ...(opts.keepData ? { kept } : {}) };
}

/** Supprime un module, ses instances et leurs données vivantes SANS contrôle des dépendants (le contrôle est dans `uninstallModule` ; ici, l'annulation d'une cascade). Les données gardées ne sont pas touchées. */
export async function purgeModule(id: string): Promise<void> {
  const instances = await prisma.moduleInstance.findMany({ where: { moduleId: id }, select: { id: true } });
  const ids = instances.map((i) => i.id);
  if (ids.length) await prisma.setting.deleteMany({ where: { OR: ids.map((i) => ({ key: { startsWith: `instance.${i}.` } })) } });
  await prisma.moduleRecord.deleteMany({ where: { instanceId: { in: ids } } });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: id } });
  await prisma.module.delete({ where: { id } });
  forgetModule(id);
  await clearBlockedUpdate(id);
  fs.rmSync(moduleDir(id), { recursive: true, force: true });
}

/**
 * Installe un module du catalogue (catalogue) par son identifiant. Le dépôt reconnu doit servir ce module-là.
 * Une entrée de l'index supplémentaire (`origin: "extra"`) exige `confirmExtra: true`, passé SEULEMENT par une action du propriétaire après
 * l'avertissement « Ce module n'est pas vérifié par le catalogue officiel » : jamais par une cascade, une graine, une tâche ou le MCP.
 */
export async function installFromCatalogue(id: string, opts: { dependencies?: boolean; restoreKept?: boolean; confirmExtra?: boolean } = {}): Promise<InstallResult> {
  const entry = await findCatalogueEntry(id);
  if (!entry) return { ok: false, error: "modules.error.notfound" };
  if (!entry.compatible) return { ok: false, error: "modules.error.incompatible" };
  // L'index dit déjà quel cœur il faut : on refuse AVANT de télécharger quoi que ce soit.
  if (entry.needsNewerCore) return { ok: false, error: "modules.error.core", detail: entry.needsNewerCore, needsCore: entry.needsNewerCore };
  if (entry.origin === "extra" && opts.confirmExtra !== true) return { ok: false, error: "modules.error.extraConfirm" };
  const fragment = entry.ref || entry.subdir ? `#${entry.ref ?? ""}${entry.subdir ? `:${entry.subdir}` : ""}` : "";
  const { confirmExtra: _confirmed, ...rest } = opts;
  void _confirmed;
  return installModule(`${entry.repo}${fragment}`, { expectId: id, ...rest });
}
