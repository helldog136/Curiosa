import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { parseManifest } from "./manifest";
import { forgetModule, getModule, moduleDir, readGitManifest } from "./registry";
import { buildContext } from "./context";
import { BUILTIN_MODULES } from "@/modules-builtin";

const run = promisify(execFile);

const MAX_MODULE_BYTES = 10 * 1024 * 1024;
const DEFAULT_HOSTS = "github.com,gitlab.com,codeberg.org,bitbucket.org";

export type InstallResult = { ok: true; id: string } | { ok: false; error: string };

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
export async function installModule(input: string): Promise<InstallResult> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return parsed;
  const { url, ref } = parsed.repo;

  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".incoming-"));
  const checkout = path.join(tmp, "repo");
  try {
    await git(["clone", "--depth", "1", "--single-branch", ...(ref ? ["--branch", ref] : []), "--", url, checkout]);
    const commit = await git(["rev-parse", "HEAD"], checkout);

    const manifestPath = path.join(checkout, "module.json");
    if (!fs.existsSync(manifestPath)) return { ok: false, error: "modules.error.nomanifest" };
    const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    if (!manifest.ok) return { ok: false, error: manifest.error };
    const m = manifest.manifest;

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

/** Dernier commit distant, pour savoir si une mise à jour existe. */
export async function checkForUpdate(id: string): Promise<{ available: boolean; remote?: string }> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row || row.source !== "git" || !row.repoUrl) return { available: false };
  try {
    const out = await git(["ls-remote", "--", row.repoUrl, row.ref ? `refs/heads/${row.ref}` : "HEAD"]);
    const remote = out.split(/\s+/)[0];
    return { available: !!remote && remote !== row.commit, remote };
  } catch {
    return { available: false };
  }
}

export async function updateModule(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row || row.source !== "git" || !row.repoUrl) return { ok: false, error: "modules.error.notfound" };
  const dir = moduleDir(id);
  try {
    await git(["fetch", "--depth", "1", "origin", row.ref ?? "HEAD"], dir);
    await git(["reset", "--hard", "FETCH_HEAD"], dir);
    const commit = await git(["rev-parse", "HEAD"], dir);
    const manifest = readGitManifest(id);
    if (!manifest || manifest.id !== id) return { ok: false, error: "modules.error.nomanifest" };
    if (dirSize(dir) > MAX_MODULE_BYTES) return { ok: false, error: "modules.error.size" };
    await prisma.module.update({ where: { id }, data: { commit, version: manifest.version } });
    forgetModule(id);
    return { ok: true, id };
  } catch (error) {
    console.error("[modules] update failed:", error);
    return { ok: false, error: "modules.error.clone" };
  }
}

export async function setModuleEnabled(id: string, enabled: boolean): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "modules.error.notfound" };
  if (row.enabled === enabled) return { ok: true, id };
  const mod = await getModule(id);
  // Un module cassé doit toujours pouvoir être désactivé.
  if (!mod && enabled) return { ok: false, error: "modules.error.load" };
  if (mod) {
    if (enabled) await seedModuleCollections(mod);
    try {
      const hook = enabled ? mod.def.hooks?.onEnable : mod.def.hooks?.onDisable;
      await hook?.(await buildContext(mod));
    } catch (error) {
      console.error(`[modules] hook failed for ${id}:`, error);
    }
  }
  await prisma.module.update({ where: { id }, data: { enabled } });
  return { ok: true, id };
}

async function seedModuleCollections(mod: NonNullable<Awaited<ReturnType<typeof getModule>>>): Promise<void> {
  for (const seed of mod.def.collections ?? []) {
    const exists = await prisma.collection.findFirst({
      where: { OR: [{ key: seed.key }, { basePath: seed.basePath }] },
    });
    if (exists) continue;
    await prisma.collection.create({
      data: {
        key: seed.key,
        basePath: seed.basePath,
        display: seed.display ?? "cards",
        clickAction: seed.clickAction ?? "detail",
        features: JSON.stringify(seed.features ?? ["summary", "body"]),
        showInNav: seed.showInNav ?? true,
        translations: {
          create: Object.entries(seed.names).map(([locale, name]) => ({ locale, name })),
        },
      },
    });
  }
}

export async function uninstallModule(id: string): Promise<InstallResult> {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row || row.source !== "git") return { ok: false, error: "modules.error.notfound" };
  if (row.enabled) await setModuleEnabled(id, false);
  await prisma.module.delete({ where: { id } });
  await prisma.moduleRecord.deleteMany({ where: { moduleId: id } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: `module.${id}.` } } });
  forgetModule(id);
  fs.rmSync(moduleDir(id), { recursive: true, force: true });
  return { ok: true, id };
}
