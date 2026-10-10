import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "../config";
import { isSubdir, parseRepoUrl } from "./installer";
import { sanitizeRequires, type CoreRequirement } from "./compat";

export type RecognizedItem = {
  id: string;
  name: string;
  description: string;
  repo: string;
  /** Étiquette ou commit à installer (sinon la branche par défaut) — épinglez-en un relu. */
  ref?: string;
  /** Dossier du module dans `repo`, pour un dépôt qui regroupe plusieurs modules. */
  subdir?: string;
  version?: string;
  author?: string;
  icon?: string;
  /** Version de l'API des modules que le module vise ; différente de celle du framework → affiché comme incompatible. */
  apiVersion?: number;
  /** Sujets fournis par le module (annoncés par l'index, relus à l'installation). */
  provides?: string[];
  /** Cœur minimal annoncé par l'index (`"requires": { "core": "0.1.10" }`) : permet de savoir SANS télécharger si le module convient. Absent = aucune exigence. Un cœur plus ancien ignore ce champ. */
  requires?: CoreRequirement;
};

/** D'où vient la liste affichée : le dépôt du framework (à jour), sa dernière copie reçue, ou la copie livrée avec cette version. */
export type RecognizedSource = "repository" | "cache" | "snapshot" | "none";
export type RecognizedResult = { items: RecognizedItem[]; source: RecognizedSource; fetchedAt: number | null; origin: string | null };

const run = promisify(execFile);
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const INDEX_PATH = "catalogue/index.json";
const TTL = 15 * 60_000;
const MAX_INDEX_BYTES = 1024 * 1024;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Valide une liste d'entrées (tableau, ou `{ modules: [...] }`) : identifiant, dépôt https sur un hôte autorisé, doublons écartés. */
export function sanitizeEntries(json: unknown): RecognizedItem[] {
  const list = Array.isArray(json) ? json : Array.isArray((json as { modules?: unknown })?.modules) ? (json as { modules: unknown[] }).modules : [];
  const seen = new Set<string>();
  const items: RecognizedItem[] = [];
  for (const i of list) {
    if (!i || typeof i !== "object" || typeof i.id !== "string" || typeof i.repo !== "string" || !ID_RE.test(i.id) || seen.has(i.id)) continue;
    const repo = parseRepoUrl(i.repo);
    if (!repo.ok || repo.repo.url.startsWith("file:")) continue;
    seen.add(i.id);
    items.push({
      id: i.id, name: str(i.name, 120) || i.id, description: str(i.description, 500) ?? "", repo: repo.repo.url,
      ref: typeof i.ref === "string" && /^[\w./-]{1,100}$/.test(i.ref) ? i.ref : undefined,
      subdir: isSubdir(i.subdir) ? i.subdir : undefined,
      version: str(i.version, 40), author: str(i.author, 120), icon: str(i.icon, 8),
      apiVersion: Number.isInteger(i.apiVersion) ? i.apiVersion : undefined,
      provides: Array.isArray(i.provides) ? i.provides.filter((x: unknown): x is string => typeof x === "string" && /^[a-z][a-z0-9.-]{0,40}$/.test(x)).slice(0, 20) : undefined,
      requires: sanitizeRequires(i.requires),
    });
    if (items.length >= 300) break;
  }
  return items;
}

/** `git@hote:chemin/depot.git` → `https://hote/chemin/depot` (un dépôt cloné en SSH reste interrogeable en https). */
export function toHttpsRemote(url: string): string {
  const m = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `https://${m[1]}/${m[2]}` : url.trim();
}

export type IndexGit = (args: string[], cwd?: string) => Promise<string>;
const gitConfig = () => ["-c", "protocol.ext.allow=never", "-c", `protocol.file.allow=${process.env.CURIOSA_ALLOW_LOCAL_MODULES === "1" ? "always" : "never"}`, "-c", "core.hooksPath=/dev/null"];
const defaultGit: IndexGit = async (args, cwd) => (await run("git", [...gitConfig(), ...args], { cwd, timeout: 25_000, maxBuffer: MAX_INDEX_BYTES + 4096, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout;

/** Nom du dépôt de modules, voisin du dépôt du cœur (même propriétaire, même hôte). */
const EXTRAS_REPO_NAME = "curiosa-extras";

/** Dépôt qui publie l'index : CURIOSA_CATALOGUE_REPO, sinon le dépôt de modules voisin du dépôt d'origine de cette installation (même propriétaire). */
export async function resolveIndexRepo(git: IndexGit = defaultGit, appDir = process.cwd()): Promise<string | null> {
  const explicit = process.env.CURIOSA_CATALOGUE_REPO?.trim();
  let url = explicit || "";
  if (!url) {
    const remote = /^[A-Za-z0-9._-]{1,60}$/.test(process.env.CURIOSA_UPDATE_REMOTE ?? "") ? process.env.CURIOSA_UPDATE_REMOTE! : "origin";
    try { url = (await git(["remote", "get-url", remote], appDir)).trim(); } catch {
      // Installation par archive (sans git) : le dépôt qui publie les releases est aussi celui qui publie l'index.
      try { const repo = String(JSON.parse(fs.readFileSync(path.join(appDir, "release.json"), "utf8")).repo ?? ""); url = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) ? `https://github.com/${repo}` : ""; } catch { url = ""; }
      if (!url) return null;
    }
  }
  // Le cœur ne contient aucun module : l'index est dans le dépôt de modules, voisin du dépôt du cœur.
  if (!explicit) url = toHttpsRemote(url).replace(/\/[^/]+?(?:\.git)?\/?$/, `/${EXTRAS_REPO_NAME}`);
  const parsed = parseRepoUrl(toHttpsRemote(url));
  return parsed.ok ? parsed.repo.url : null;
}

/** Lit `catalogue/index.json` dans le dépôt, sans rien écrire dans l'installation : un dépôt temporaire, une récupération superficielle. */
export async function fetchIndexFromRepo(url: string, ref = "HEAD", git: IndexGit = defaultGit): Promise<unknown> {
  if (!/^[\w./-]{1,100}$/.test(ref)) throw new Error("bad-ref");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-index-"));
  try {
    await git(["init", "-q", "--bare", tmp]);
    await git(["fetch", "-q", "--depth", "1", "--no-tags", "--", url, ref], tmp);
    const text = await git(["show", `FETCH_HEAD:${INDEX_PATH}`], tmp);
    if (text.length > MAX_INDEX_BYTES) throw new Error("too-large");
    return JSON.parse(text);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Copie de l'index livrée avec cette version : dans l'instantané des modules (`extras/catalogue/index.json`). */
const defaultRoot = () => process.env.CURIOSA_EXTRAS_DIR ?? path.join(process.cwd(), "extras");

const cacheFile = () => path.join(DATA_DIR, "cache", "recognized-index.json");
function readPersisted(): { items: RecognizedItem[]; fetchedAt: number; origin: string | null } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    return { items: sanitizeEntries(raw), fetchedAt: Number(raw.fetchedAt) || 0, origin: typeof raw.origin === "string" ? raw.origin : null };
  } catch { return null; }
}
function readSnapshot(root: string): RecognizedItem[] {
  try { return sanitizeEntries(JSON.parse(fs.readFileSync(path.join(root, INDEX_PATH), "utf8"))); } catch { return []; }
}

let memo: { at: number; key: string; result: RecognizedResult } | null = null;
export function clearRecognizedCache(): void { memo = null; }

export type RecognizedOptions = { fetchImpl?: typeof fetch; git?: IndexGit; root?: string; now?: () => number };

/**
 * Index des modules RECONNUS. Trois sources, la plus fraîche d'abord :
 *   1. le fichier `catalogue/index.json` du dépôt du framework, lu À L'EXÉCUTION (ne suit PAS le rythme des versions) ;
 *   2. à défaut, la dernière copie reçue (gardée dans data/cache) puis la copie livrée avec cette version : hors ligne, ça marche ;
 *   3. en plus, un index JSON https supplémentaire (MODULES_INDEX_URL) dont les entrées ne peuvent qu'AJOUTER des modules.
 * Celui qui publie un index se porte garant des dépôts qu'il liste ; chaque entrée est revalidée ici. Rien n'est installé automatiquement.
 */
export async function getRecognizedDetailed(opts: RecognizedOptions = {}): Promise<RecognizedResult> {
  const { fetchImpl = fetch, git = defaultGit, root = defaultRoot(), now = Date.now } = opts;
  const extraUrl = process.env.MODULES_INDEX_URL;
  const key = `${process.env.CURIOSA_CATALOGUE_REPO ?? ""}|${process.env.CURIOSA_CATALOGUE_REF ?? ""}|${extraUrl ?? ""}|${root}`;
  if (memo && memo.key === key && now() - memo.at < TTL) return memo.result;

  let base: RecognizedResult = { items: [], source: "none", fetchedAt: null, origin: null };
  const runtime = process.env.CURIOSA_CATALOGUE_RUNTIME !== "0";
  const repo = runtime ? await resolveIndexRepo(git) : null;
  if (repo) {
    try {
      const items = sanitizeEntries(await fetchIndexFromRepo(repo, process.env.CURIOSA_CATALOGUE_REF || "HEAD", git));
      base = { items, source: "repository", fetchedAt: now(), origin: repo };
      try {
        fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
        fs.writeFileSync(cacheFile(), JSON.stringify({ version: 1, fetchedAt: base.fetchedAt, origin: repo, modules: items }));
      } catch { /* la copie locale est un plus */ }
    } catch { /* injoignable : on retombe sur la dernière copie */ }
  }
  if (base.source === "none") {
    const kept = readPersisted();
    if (kept && kept.items.length + (kept.fetchedAt ? 1 : 0) > 0) base = { items: kept.items, source: "cache", fetchedAt: kept.fetchedAt, origin: kept.origin };
  }
  if (base.source === "none") {
    const items = readSnapshot(root);
    base = { items, source: "snapshot", fetchedAt: null, origin: null };
  }

  const items = [...base.items];
  if (extraUrl?.startsWith("https://")) {
    try {
      const res = await fetchImpl(extraUrl, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (res.ok) for (const e of sanitizeEntries(await res.json())) if (!items.some((i) => i.id === e.id)) items.push(e);
    } catch { /* index supplémentaire injoignable : on garde le reste */ }
  }
  const result = { ...base, items: items.slice(0, 300) };
  memo = { at: now(), key, result };
  return result;
}

export async function getRecognized(fetchImpl: typeof fetch = fetch): Promise<RecognizedItem[]> {
  return (await getRecognizedDetailed({ fetchImpl })).items;
}
