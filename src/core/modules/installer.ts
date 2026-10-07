import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { parseManifest } from "./manifest";
import { forgetModule, getModule, moduleDir, readGitManifest } from "./registry";
import { findMarketplaceEntry, readBundledManifest } from "./marketplace";
import { migrateModuleInstances, type MigrationOutcome } from "./dataMigrations";
import { classify, pickLatestTag, TAG_RE, type UpdateLevel } from "../updates/versions";
import { BUILTIN_MODULES } from "@/modules-builtin";

const run = promisify(execFile);

const MAX_MODULE_BYTES = 10 * 1024 * 1024;
const DEFAULT_HOSTS = "github.com,gitlab.com,codeberg.org,bitbucket.org";

export type InstallResult = { ok: true; id: string; migrations?: MigrationOutcome[] } | { ok: false; error: string };

export type ParsedRepo = { url: string; ref?: string };

/**
 * Accepte https://hôte/propriétaire/dépôt[.git][#ref]. Seuls les hôtes de
 * MODULES_ALLOWED_HOSTS sont autorisés ("*" = tous). Les dépôts locaux
 * (file://) ne sont acceptés que si VITRINE_ALLOW_LOCAL_MODULES=1, pour le
 * développement d'un module.
 */
export function parseRepoUrl(input: string): { ok: true; repo: ParsedRepo } | { ok: false; error: string } {
  const [rawUrl = "", ref] = input.trim().split("#");
  if (ref !== undefined && !/^[\w./-]{1,100}$/.test(ref)) return { ok: false, error: "modules.error.ref" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "modules.error.url" };
  }
  if (url.protocol === "file:") {
    if (process.env.VITRINE_ALLOW_LOCAL_MODULES !== "1") return { ok: false, error: "modules.error.local" };
    return { ok: true, repo: { url: url.href, ref } };
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
  return { ok: true, repo: { url: url.href.replace(/\/$/, ""), ref } };
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };

function gitArgs(args: string[]): string[] {
  const protocolFile = process.env.VITRINE_ALLOW_LOCAL_MODULES === "1" ? "always" : "never";
  return [
    "-c", "protocol.ext.allow=never",
    "-c", `protocol.file.allow=${protocolFile}`,
    "-c", "core.hooksPath=/dev/null",
    ...args,
  ];
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run("git", gitArgs(args), { cwd, timeout: 90_000, env: GIT_ENV, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("symlinks are not allowed in a module");
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

/** Installe un module depuis un dépôt git. Il est installé *désactivé* : rien ne s'exécute avant l'accord de l'admin. */
export async function installModule(input: string, opts: { expectId?: string } = {}): Promise<InstallResult> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return parsed;
  const { url, ref } = parsed.repo;

  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-"));
  const checkout = path.join(tmp, "repo");
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

    const manifestPath = path.join(checkout, "module.json");
    if (!fs.existsSync(manifestPath)) return { ok: false, error: "modules.error.nomanifest" };
    const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    if (!manifest.ok) return { ok: false, error: manifest.error };
    const m = manifest.manifest;
    // Un dépôt reconnu ne peut pas servir un autre module que celui annoncé.
    if (opts.expectId && m.id !== opts.expectId) return { ok: false, error: "modules.error.idmismatch" };

    if (BUILTIN_MODULES.some((b) => b.manifest.id === m.id)) return { ok: false, error: "modules.error.builtin" };
    if (m.main && !fs.existsSync(path.join(checkout, m.main))) return { ok: false, error: "modules.error.nomain" };
    if (dirSize(checkout) > MAX_MODULE_BYTES) return { ok: false, error: "modules.error.size" };

    const existing = await prisma.module.findUnique({ where: { id: m.id } });
    if (existing) return { ok: false, error: "modules.error.exists" };

    fs.renameSync(checkout, moduleDir(m.id));
    await prisma.module.create({
      data: { id: m.id, source: "git", repoUrl: url, ref: ref ?? null, commit, version: m.version, enabled: false },
    });
    return { ok: true, id: m.id };
  } catch (error) {
    console.error("[modules] install failed:", error);
    return { ok: false, error: "modules.error.clone" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isStableTag = (ref: string | null | undefined): ref is string => !!ref && TAG_RE.test(ref);
const isCommitRef = (ref: string | null | undefined): boolean => !!ref && /^[0-9a-f]{7,40}$/i.test(ref);

export type ModuleUpdateCheck = {
  available: boolean;
  /** Version vers laquelle on passerait (étiquette, numéro de version ou commit). */
  target?: string;
  /** Pour un module épinglé sur une étiquette : nature du changement (« major » = à lire avant d'installer). */
  level?: UpdateLevel;
  remote?: string;
};

/** Plus haute version stable (`vX.Y.Z`) du dépôt d'un module. */
async function latestRemoteTag(repoUrl: string): Promise<string | null> {
  return pickLatestTag(await git(["ls-remote", "--tags", "--refs", "--", repoUrl]));
}

/**
 * Y a-t-il une version plus récente ? Le sens dépend de la façon dont le module a été installé :
 *   - épinglé sur une ÉTIQUETTE (`#v1.2.0`, le cas recommandé) : la plus haute version stable du dépôt ;
 *   - épinglé sur un commit : jamais (c'est le but) ;
 *   - sur une branche (ou la branche par défaut) : le dernier commit de cette branche ;
 *   - livré avec le framework : la version qu'apporte le framework.
 */
export async function checkForUpdate(id: string): Promise<ModuleUpdateCheck> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (row?.source === "bundled") {
    const entry = await findMarketplaceEntry(id).catch(() => undefined);
    const available = !!entry?.dir && !!entry.version && entry.version !== row.version;
    return { available, remote: entry?.version, target: available ? entry?.version : undefined, level: available ? classify(row.version, entry!.version!) ?? undefined : undefined };
  }
  if (!row || row.source !== "git" || !row.repoUrl) return { available: false };
  try {
    if (isCommitRef(row.ref)) return { available: false };
    if (isStableTag(row.ref)) {
      const latest = await latestRemoteTag(row.repoUrl);
      const level = latest ? classify(row.ref, latest) : null;
      return level ? { available: true, target: latest!, remote: latest!, level } : { available: false, remote: latest ?? undefined };
    }
    const out = await git(["ls-remote", "--", row.repoUrl, row.ref ? `refs/heads/${row.ref}` : "HEAD"]);
    const remote = out.split(/\s+/)[0];
    return { available: !!remote && remote !== row.commit, remote, target: remote?.slice(0, 7) };
  } catch {
    return { available: false };
  }
}

/**
 * Met un module à jour SANS toucher à ses données : seuls les fichiers du module changent ; ses instances, réglages et données
 * (stockage, entrées) restent tels quels. Épinglé sur une étiquette, il passe à la plus haute version stable. Si la nouvelle version est
 * invalide (manifeste illisible, autre identifiant, API incompatible, trop volumineuse), l'ancienne est rétablie : le module ne casse jamais.
 */
export async function updateModule(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (row?.source === "bundled") {
    const entry = await findMarketplaceEntry(id);
    if (!entry?.dir) return { ok: false, error: "modules.error.notfound" };
    const copied = copyBundled(entry.dir, id);
    if (!copied.ok) return copied;
    await prisma.module.update({ where: { id }, data: { version: copied.version } });
    forgetModule(id);
    return { ok: true, id, migrations: await migrateModuleInstances(id) };
  }
  if (!row || row.source !== "git" || !row.repoUrl) return { ok: false, error: "modules.error.notfound" };
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
    console.error("[modules] update failed:", (error as Error)?.message);
    return { ok: false, error: (error as { code?: string })?.code ?? "modules.error.clone" };
  }
}

export async function setModuleEnabled(id: string, enabled: boolean): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  if (enabled && !(await getModule(id))) return { ok: false, error: "modules.error.load" };
  await prisma.module.update({ where: { id }, data: { enabled } });
  return { ok: true, id };
}

export async function uninstallModule(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row || row.source === "builtin") return { ok: false, error: "modules.error.notfound" };
  const instances = await prisma.moduleInstance.findMany({ where: { moduleId: id }, select: { id: true } });
  const ids = instances.map((i) => i.id);
  await prisma.setting.deleteMany({ where: { OR: ids.map((i) => ({ key: { startsWith: `instance.${i}.` } })) } });
  await prisma.moduleRecord.deleteMany({ where: { instanceId: { in: ids } } });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: id } });
  await prisma.module.delete({ where: { id } });
  forgetModule(id);
  fs.rmSync(moduleDir(id), { recursive: true, force: true });
  return { ok: true, id };
}

/** Copie un module livré avec le framework vers le dossier des modules installés (sans .git ni lien symbolique). */
function copyBundled(from: string, id: string): { ok: true; version: string } | { ok: false; error: string } {
  const manifest = readBundledManifest(from);
  if (!manifest || manifest.id !== id) return { ok: false, error: "modules.error.nomanifest" };
  const target = moduleDir(id);
  const staging = `${target}.incoming-${process.pid}`;
  try {
    fs.mkdirSync(MODULES_DIR, { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(from, staging, { recursive: true, filter: (src) => path.basename(src) !== ".git" && path.basename(src) !== "node_modules" });
    if (dirSize(staging) > MAX_MODULE_BYTES) throw new Error("size");
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    return { ok: true, version: manifest.version };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error("[modules] bundled copy failed:", error);
    return { ok: false, error: "modules.error.clone" };
  }
}

/** Installe un module livré avec le framework. Désactivé tant que l'admin ne l'a pas activé, comme tout module installé. */
export async function installBundled(id: string): Promise<InstallResult> {
  const entry = await findMarketplaceEntry(id);
  if (!entry || entry.source !== "bundled" || !entry.dir) return { ok: false, error: "modules.error.notfound" };
  if (BUILTIN_MODULES.some((b) => b.manifest.id === id)) return { ok: false, error: "modules.error.builtin" };
  if (await prisma.module.findUnique({ where: { id } })) return { ok: false, error: "modules.error.exists" };
  const copied = copyBundled(entry.dir, id);
  if (!copied.ok) return copied;
  await prisma.module.create({ data: { id, source: "bundled", version: copied.version, enabled: false } });
  return { ok: true, id };
}

/** Installe un module de la marketplace (livré ou reconnu) par son identifiant. Le dépôt reconnu doit servir ce module-là. */
export async function installFromMarketplace(id: string): Promise<InstallResult> {
  const entry = await findMarketplaceEntry(id);
  if (!entry) return { ok: false, error: "modules.error.notfound" };
  if (!entry.compatible) return { ok: false, error: "modules.error.incompatible" };
  if (entry.source === "bundled") return installBundled(id);
  return installModule(`${entry.repo}${entry.ref ? `#${entry.ref}` : ""}`, { expectId: id });
}
