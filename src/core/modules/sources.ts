import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSetting, setSetting } from "../settings";
import { MODULE_API_VERSION } from "../config";
import { git, isCommitRef, isSubdir, parseRepoUrl, type ParsedRepo } from "./installer";
import { parseManifest } from "./manifest";
import type { LocalizedString } from "./types";

/**
 * DÉPÔTS DE MODULES PERSONNELS. Un développeur publie ses modules dans UN dépôt (un dossier par module, ou un seul module à la racine) ; le
 * propriétaire du site ajoute ce dépôt dans l'admin (Catalogue → Mes dépôts de modules) et choisit ceux qu'il installe. Comme tout dépôt
 * personnel, il n'est vérifié par personne : chaque installation demande la confirmation habituelle, et les mises à jour suivent le même dépôt.
 * Rien n'est installé ni exécuté pendant la découverte : on lit seulement les manifestes (`module.json`).
 */
export type Source = { url: string; ref?: string };
export type SourceModule = {
  id: string; name: LocalizedString; description: LocalizedString; version: string; icon?: string; author?: string;
  /** Dossier du module dans le dépôt (absent = racine). */
  subdir?: string; compatible: boolean;
};

const KEY = "modules.sources";
export const MAX_SOURCES = 10;
const MAX_MODULES = 60;
const SKIP = new Set([".git", "node_modules"]);

export async function listSources(): Promise<Source[]> {
  const raw = await getSetting<unknown>(KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s): Source[] => {
    const p = typeof s?.url === "string" ? parseRepoUrl(s.ref ? `${s.url}#${s.ref}` : s.url) : null;
    return p?.ok && !p.repo.subdir ? [{ url: p.repo.url, ...(p.repo.ref ? { ref: p.repo.ref } : {}) }] : [];
  });
}

/** Cherche les dossiers qui contiennent un `module.json` (3 niveaux au plus, comme le permet l'adresse `#ref:dossier`). */
function findModuleDirs(root: string, rel = "", depth = 0): string[] {
  const out: string[] = [];
  if (fs.existsSync(path.join(root, rel, "module.json"))) out.push(rel);
  if (depth >= 3 || (rel === "" && out.length)) return out;
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (!e.isDirectory() || e.isSymbolicLink() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const sub = rel ? `${rel}/${e.name}` : e.name;
    if (!isSubdir(sub)) continue;
    out.push(...findModuleDirs(root, sub, depth + 1));
    if (out.length >= MAX_MODULES) break;
  }
  return out;
}

const memo = new Map<string, { at: number; modules: SourceModule[] }>();
const TTL = 10 * 60_000;
export const clearSourcesCache = (): void => memo.clear();

/** Les modules d'un dépôt, lus sans rien installer (récupération superficielle dans un dossier temporaire). */
export async function discoverModules(repo: ParsedRepo, opts: { fresh?: boolean; now?: () => number } = {}): Promise<SourceModule[]> {
  const now = (opts.now ?? Date.now)();
  const key = `${repo.url}#${repo.ref ?? ""}`;
  const hit = memo.get(key);
  if (!opts.fresh && hit && now - hit.at < TTL) return hit.modules;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-source-"));
  try {
    const checkout = path.join(tmp, "repo");
    await git(["init", "-q", checkout]);
    await git(["remote", "add", "origin", repo.url], checkout);
    await git(["fetch", "-q", "--depth", "1", "origin", repo.ref || "HEAD"], checkout).catch((e) => {
      if (repo.ref && isCommitRef(repo.ref)) return git(["fetch", "-q", "origin"], checkout);
      throw e;
    });
    await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", isCommitRef(repo.ref) ? repo.ref! : "FETCH_HEAD"], checkout);
    const modules: SourceModule[] = [];
    for (const rel of findModuleDirs(checkout)) {
      try {
        const parsed = parseManifest(JSON.parse(fs.readFileSync(path.join(checkout, rel, "module.json"), "utf8")));
        if (!parsed.ok || modules.some((m) => m.id === parsed.manifest.id)) continue;
        const m = parsed.manifest;
        modules.push({ id: m.id, name: m.name, description: m.description ?? "", version: m.version, icon: m.icon, author: m.author, ...(rel ? { subdir: rel } : {}), compatible: m.apiVersion === MODULE_API_VERSION });
      } catch { /* manifeste illisible : ce dossier n'est pas un module */ }
    }
    memo.set(key, { at: now, modules });
    return modules;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export type AddSourceResult = { ok: true; modules: SourceModule[] } | { ok: false; error: string };

/** Ajoute un dépôt à la liste : il doit exister et contenir au moins un module valide. */
export async function addSource(input: string): Promise<AddSourceResult> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return parsed;
  if (parsed.repo.subdir) return { ok: false, error: "modules.error.sourceSubdir" };
  const repo = { url: parsed.repo.url, ...(parsed.repo.ref ? { ref: parsed.repo.ref } : {}) };
  const sources = await listSources();
  if (sources.length >= MAX_SOURCES) return { ok: false, error: "modules.error.sourceMax" };
  let modules: SourceModule[];
  try { modules = await discoverModules(repo, { fresh: true }); } catch (e) { console.error("[sources] discover failed:", (e as Error)?.message); return { ok: false, error: "modules.error.clone" }; }
  if (modules.length === 0) return { ok: false, error: "modules.error.sourceEmpty" };
  if (!sources.some((s) => s.url.toLowerCase() === repo.url.toLowerCase() && s.ref === repo.ref)) await setSetting(KEY, [...sources, repo]);
  return { ok: true, modules };
}

export async function removeSource(url: string): Promise<void> {
  await setSetting(KEY, (await listSources()).filter((s) => s.url !== url));
  clearSourcesCache();
}

/** L'adresse à passer à l'installation d'un module de ce dépôt. */
export const sourceAddress = (s: Source, m: SourceModule): string => `${s.url}${s.ref || m.subdir ? `#${s.ref ?? ""}${m.subdir ? `:${m.subdir}` : ""}` : ""}`;
