import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Module } from "@prisma/client";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { parseManifest, type ParsedManifest } from "./manifest";
import { forgetModule, getModule, moduleDir, readGitManifest } from "./registry";
import { catalogueUnreachable, findCatalogueEntry, getCatalogue } from "./catalogue";
import { checkBundledRow, convertToCatalogue } from "./bundledUpdate";
import { dependentsOf } from "./dependencies";
import { commitJournal, satisfyRequirements, unwind, type DepOps, type Journal, type Missing } from "./dependencyInstaller";
import { forgetAuto } from "./autoInstalled";
import { migrateModuleInstances, type MigrationOutcome } from "./dataMigrations";
import { incompatWithThisCore, requirementOf, type CoreRequirement } from "./compat";
import { classify, compareVersions, pickLatestTag, TAG_RE, type UpdateLevel } from "../updates/versions";

const run = promisify(execFile);

const MAX_MODULE_BYTES = 10 * 1024 * 1024;
const DEFAULT_HOSTS = "github.com,gitlab.com,codeberg.org,bitbucket.org";

export type InstallResult = {
  ok: true; id: string; migrations?: MigrationOutcome[];
  /** Ligne du journal d'audit quand la mise à jour a changé la SOURCE du module (module de base converti en module du catalogue). */
  auditTarget?: string;
  /** Modules apportés d'office par la cascade des dépendances (installés ou activés). */
  provided?: string[];
  /** Mise à jour réussie, mais il manque encore de quoi faire fonctionner le module : à dire à l'administrateur. */
  missing?: Missing[];
} | { ok: false; error: string; /** Détail structuré de ce qui manque (service, version, cause) quand l'erreur est « modules.error.requires ». */ missing?: Missing[]; /** Précision lisible (ex. les services manquants). */ detail?: string; /** Erreur « modules.error.core » : version du cœur que le module demande (voir compat.ts). */ needsCore?: string };

/** Le module demande un cœur plus récent que celui-ci : on refuse d'entrer ou de monter de version (jamais de désactiver un module déjà là). */
export class CoreTooOld extends Error {
  readonly needs: string;
  constructor(needs: string) { super("core too old"); this.needs = needs; }
}
const coreRefusal = (e: CoreTooOld): InstallResult => ({ ok: false, error: "modules.error.core", detail: e.needs, needsCore: e.needs });
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

export async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run("git", gitArgs(args), { cwd, timeout: 90_000, env: GIT_ENV, maxBuffer: 1024 * 1024 });
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

/** Installe un module depuis un dépôt git. Il est installé *désactivé* : rien ne s'exécute avant l'accord de l'admin. */
export async function installModule(input: string, opts: { expectId?: string; /** false : ne pas installer les fournisseurs (restauration, cascade elle-même). */ dependencies?: boolean } = {}): Promise<InstallResult> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return parsed;
  const { url, ref, subdir } = parsed.repo;

  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-"));
  const checkout = path.join(tmp, "repo");
  let deps: Journal | null = null;
  try {
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

    // Module dans un dossier d'un dépôt qui en regroupe plusieurs : seul ce dossier est lu, copié et installé.
    const root = subdir ? path.join(checkout, subdir) : checkout;
    if (subdir && !isInside(checkout, root)) return { ok: false, error: "modules.error.nosubdir" };
    const manifestPath = path.join(root, "module.json");
    if (!fs.existsSync(manifestPath)) return { ok: false, error: subdir ? "modules.error.nosubdir" : "modules.error.nomanifest" };
    const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    if (!manifest.ok) return { ok: false, error: manifest.error };
    const m = manifest.manifest;
    // Un dépôt reconnu ne peut pas servir un autre module que celui annoncé.
    if (opts.expectId && m.id !== opts.expectId) return { ok: false, error: "modules.error.idmismatch" };
    assertCore(requirementOf(m));

    if (m.main && !fs.existsSync(path.join(root, m.main))) return { ok: false, error: "modules.error.nomain" };
    if (dirSize(root) > MAX_MODULE_BYTES) return { ok: false, error: "modules.error.size" };

    const existing = await prisma.module.findUnique({ where: { id: m.id } });
    if (existing) return { ok: false, error: "modules.error.exists" };

    // Les fournisseurs d'abord : si l'un d'eux ne peut pas être installé, rien n'est laissé (ni lui, ni ce module).
    if (opts.dependencies !== false && m.requires?.length) {
      const r = await satisfyRequirements(m, depOps());
      deps = r.journal;
      if (!r.ok) { await unwind(deps); deps = null; return requirementsRefusal(r.missing); }
    }

    let tree: string | null = null;
    if (subdir) {
      tree = await git(["rev-parse", `HEAD:${subdir}`], checkout);
      copyModuleFiles(root, moduleDir(m.id));
    } else {
      fs.renameSync(checkout, moduleDir(m.id));
    }
    await prisma.module.create({
      data: { id: m.id, source: "git", repoUrl: url, ref: ref ?? null, commit, subdir: subdir ?? null, tree, version: m.version, enabled: false },
    });
    if (deps) await commitJournal(deps);
    return { ok: true, id: m.id, ...(deps?.provided.length ? { provided: deps.provided } : {}) };
  } catch (error) {
    if (deps) await unwind(deps);
    if (error instanceof CoreTooOld) return coreRefusal(error);
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

async function updateSubdirModule(row: Module): Promise<InstallResult> {
  const id = row.id;
  const { ref, fromCatalogue } = await subdirTarget(row);
  if (!fromCatalogue && isCommitRef(row.ref)) return { ok: false, error: "modules.error.pinned" };
  const target = moduleDir(id);
  const backup = `${target}.previous-${process.pid}`;
  let fetched: Fetched | null = null;
  let swapped = false;
  try {
    fetched = await fetchSubdirSource(row.repoUrl!, ref, row.subdir!);
    if (fetched.tree === row.tree) return { ok: false, error: "modules.error.uptodate" };
    const manifest = fetched.manifest;
    if (!manifest || manifest.id !== id) throw Object.assign(new Error("manifest"), { code: "modules.error.nomanifest" });
    if (manifest.main && !fs.existsSync(path.join(fetched.root, manifest.main))) throw Object.assign(new Error("main"), { code: "modules.error.nomain" });
    if (dirSize(fetched.root) > MAX_MODULE_BYTES) throw Object.assign(new Error("size"), { code: "modules.error.size" });
    assertCore(requirementOf(manifest));
    // On met l'ancienne version de côté pendant l'échange : au moindre échec, elle revient telle quelle.
    fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(target, backup);
    swapped = true;
    copyModuleFiles(fetched.root, target);
    await prisma.module.update({ where: { id }, data: { commit: fetched.commit, tree: fetched.tree, version: manifest.version, ref: ref ?? row.ref } });
    swapped = false;
    forgetModule(id);
    return { ok: true, id, migrations: await migrateModuleInstances(id) };
  } catch (error) {
    if (swapped) { fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(backup, target); }
    forgetModule(id);
    if (error instanceof CoreTooOld) return coreRefusal(error);
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
 */
export async function updateModule(id: string): Promise<InstallResult> {
  const result = await updateModuleFiles(id);
  return result.ok ? { ...result, ...(await settleDependencies(id)) } : result;
}

async function updateModuleFiles(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (row?.source === "bundled") {
    // Compatibilité sites anciens, à retirer en 0.3.0 : le catalogue est la source, jamais une copie locale.
    const entry = await findCatalogueEntry(id);
    if (entry) return convertToCatalogue(row, entry);   // voir bundledUpdate.ts
    return { ok: false, error: (await catalogueUnreachable()) ? "modules.error.catalogue" : "modules.error.unknownSource" };
  }
  if (!row || row.source !== "git" || !row.repoUrl) return { ok: false, error: "modules.error.notfound" };
  if (row.subdir) return updateSubdirModule(row);
  const dir = moduleDir(id);
  let previous: string | null = null;
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
    // Le cœur est-il assez récent pour la version visée ? On le lit AVANT de toucher au dossier du module (ni retour en arrière, ni migration à défaire).
    await git(["fetch", "--depth", "1", "origin", fetchRef], dir);
    const incoming = await git(["show", "FETCH_HEAD:module.json"], dir).then((t) => parseManifest(JSON.parse(t))).catch(() => null);   // illisible : le contrôle habituel plus bas s'en charge
    if (incoming?.ok) assertCore(requirementOf(incoming.manifest));
    // Versions sautées : on rejoue leurs migrations de données, dans l'ordre, avec LEUR code, avant de passer à la dernière.
    if (isStableTag(row.ref) && newRef !== row.ref) {
      const replay = await replaySkippedReleases(id, dir, row.repoUrl, row.ref, newRef as string);
      if (replay) return replay;
    }
    await git(["fetch", "--depth", "1", "origin", fetchRef], dir);
    await git(["reset", "--hard", "FETCH_HEAD"], dir);
    const commit = await git(["rev-parse", "HEAD"], dir);
    const manifest = readGitManifest(id);
    if (!manifest || manifest.id !== id) throw Object.assign(new Error("manifest"), { code: "modules.error.nomanifest" });
    if (manifest.main && !fs.existsSync(path.join(dir, manifest.main))) throw Object.assign(new Error("main"), { code: "modules.error.nomain" });
    if (dirSize(dir) > MAX_MODULE_BYTES) throw Object.assign(new Error("size"), { code: "modules.error.size" });
    await prisma.module.update({ where: { id }, data: { commit, version: manifest.version, ref: newRef } });
    forgetModule(id);
    // Les données des instances suivent la nouvelle version du module (voir dataMigrations.ts) ; en cas d'échec, l'instance est remise à l'écart.
    return { ok: true, id, migrations: await migrateModuleInstances(id) };
  } catch (error) {
    // Retour à la version précédente : un module en place ne doit pas rester à moitié mis à jour.
    if (previous) await git(["reset", "--hard", previous], dir).catch(() => {});
    forgetModule(id);
    if (error instanceof CoreTooOld) return coreRefusal(error);
    console.error("[modules] update failed:", (error as Error)?.message);
    return { ok: false, error: (error as { code?: string })?.code ?? "modules.error.clone" };
  }
}

/**
 * Mise à jour 1.2 → 1.6 alors que 1.3, 1.4 et 1.5 existent : chaque version intermédiaire change peut-être le modèle de données. On extrait
 * donc chacune à son tour, on exécute SES migrations (jusqu'à sa propre `dataVersion`), puis on passe à la suivante ; la dernière version
 * trouve des données déjà au bon format. Les versions sans changement de données n'ont rien à déclarer.
 * Si une étape échoue, la mise à jour s'arrête sur cette version (données remises comme avant l'étape, instance mise à l'écart, « Réessayer »
 * possible) et on renvoie le résultat ; sinon `null` et la mise à jour continue vers la cible.
 */
async function replaySkippedReleases(id: string, dir: string, repoUrl: string, from: string, to: string): Promise<InstallResult | null> {
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
    const migrations = await migrateModuleInstances(id, { skipNewer: true });
    if (migrations.some((m) => m.status === "failed" || m.status === "newer")) return { ok: true, id, migrations };
  }
  return null;
}

/* ───────────── Dépendances : gestes prêtés à dependencyInstaller.ts ───────────── */

/** Refus « il manque quelque chose » : `detail` garde la liste des services (lisible tel quel), `missing` le détail pour l'interface. */
export const requirementsRefusal = (missing: Missing[]): InstallResult => ({ ok: false, error: "modules.error.requires", detail: missing.map((x) => x.service).join(", "), missing });

const depOps = (): DepOps => ({
  catalogue: () => getCatalogue(),
  installEntry: async (entry) => {
    const r = await installModule(`${entry.repo}${entry.ref || entry.subdir ? `#${entry.ref ?? ""}${entry.subdir ? `:${entry.subdir}` : ""}` : ""}`, { expectId: entry.id, dependencies: false });
    return r.ok ? { ok: true } : { ok: false, error: r.error, detail: r.detail };
  },
  purge: purgeModule,
});

/** Active un module : ses fournisseurs sont d'abord installés/activés (avec leur instance par défaut) ; au moindre échec tout est défait. */
async function enableModule(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  const mod = await getModule(id);
  if (!mod) return { ok: false, error: "modules.error.load" };
  const r = await satisfyRequirements(mod.manifest, depOps());
  if (!r.ok) { await unwind(r.journal); return requirementsRefusal(r.missing); }
  try {
    await prisma.module.update({ where: { id }, data: { enabled: true } });
    await commitJournal(r.journal);
  } catch (error) {
    await unwind(r.journal);
    throw error;
  }
  return { ok: true, id, ...(r.journal.provided.length ? { provided: r.journal.provided } : {}) };
}

/**
 * Vérifie les `requires` d'un module ACTIF et, s'il manque un fournisseur disponible (catalogue), l'installe d'office avec son instance par défaut.
 * Impossible → rien n'est laissé à moitié et `missing` dit quoi. Sert après une mise à jour et après une restauration. Ne lève jamais.
 */
export async function settleDependencies(id: string): Promise<{ provided?: string[]; missing?: Missing[] }> {
  try {
    const row = await prisma.module.findUnique({ where: { id } });
    const mod = row?.enabled ? await getModule(id) : null;
    if (!mod?.manifest.requires?.length) return {};
    const r = await satisfyRequirements(mod.manifest, depOps());
    if (!r.ok) { await unwind(r.journal); return { missing: r.missing }; }
    await commitJournal(r.journal);
    return r.journal.provided.length ? { provided: r.journal.provided } : {};
  } catch (error) {
    console.error("[modules] dependency check failed:", (error as Error)?.message);
    return {};
  }
}

export async function setModuleEnabled(id: string, enabled: boolean): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  if (enabled) return enableModule(id);
  if (row.enabled) {
    const dependents = await dependentsOf(id);
    if (dependents.length) return { ok: false, error: "modules.error.requiredBy", detail: dependents.join(", ") };
  }
  await prisma.module.update({ where: { id }, data: { enabled: false } });
  return { ok: true, id };
}

export async function uninstallModule(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  if (row.enabled) {
    const dependents = await dependentsOf(id);
    if (dependents.length) return { ok: false, error: "modules.error.requiredBy", detail: dependents.join(", ") };
  }
  await purgeModule(id);
  await forgetAuto(id);
  return { ok: true, id };
}

/** Supprime un module, ses instances et leurs données SANS contrôle des dépendants (le contrôle est dans `uninstallModule` ; ici, l'annulation d'une cascade). */
export async function purgeModule(id: string): Promise<void> {
  const instances = await prisma.moduleInstance.findMany({ where: { moduleId: id }, select: { id: true } });
  const ids = instances.map((i) => i.id);
  await prisma.setting.deleteMany({ where: { OR: ids.map((i) => ({ key: { startsWith: `instance.${i}.` } })) } });
  await prisma.moduleRecord.deleteMany({ where: { instanceId: { in: ids } } });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: id } });
  await prisma.module.delete({ where: { id } });
  forgetModule(id);
  fs.rmSync(moduleDir(id), { recursive: true, force: true });
}

/** Installe un module du catalogue (catalogue) par son identifiant. Le dépôt reconnu doit servir ce module-là. */
export async function installFromCatalogue(id: string, opts: { dependencies?: boolean } = {}): Promise<InstallResult> {
  const entry = await findCatalogueEntry(id);
  if (!entry) return { ok: false, error: "modules.error.notfound" };
  if (!entry.compatible) return { ok: false, error: "modules.error.incompatible" };
  // L'index dit déjà quel cœur il faut : on refuse AVANT de télécharger quoi que ce soit.
  if (entry.needsNewerCore) return { ok: false, error: "modules.error.core", detail: entry.needsNewerCore, needsCore: entry.needsNewerCore };
  const fragment = entry.ref || entry.subdir ? `#${entry.ref ?? ""}${entry.subdir ? `:${entry.subdir}` : ""}` : "";
  return installModule(`${entry.repo}${fragment}`, { expectId: id, ...opts });
}
