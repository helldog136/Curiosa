import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "../config";
import { isSubdir, parseRepoUrl } from "./installer";
import { sanitizeRequires, type CoreRequirement } from "./compat";
import { sanitizeServiceList } from "./serviceVersions";

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
  /** Services que le module offre, annoncés par l'index (`"offers": ["contact.store"]`, ou `{ service, version }`) : permet de le choisir comme fournisseur SANS le télécharger. Facultatif, relu à l'installation. */
  offers?: { service: string; version?: number; each?: true }[];
  /** Services dont le module a besoin (`"requires": ["contact.store"]`, ou `{ service, min }` ; une liste, à ne pas confondre avec `requires: { core }`). Forme interne gardée dans la copie locale : `needs`. */
  needs?: { service: string; min?: number; optional?: true }[];
  /** « official » : listé par le dépôt du catalogue (ou sa dernière copie reçue) ; « extra » : ajouté par MODULES_INDEX_URL, jamais installé d'office (voir dependencyPlan.ts). */
  catalogueOrigin?: "official" | "extra";
};

/** D'où vient la liste affichée : le dépôt du catalogue (à jour), ou la dernière copie reçue de lui ; « none » = catalogue injoignable et jamais reçu (liste vide, jamais une copie locale). */
export type RecognizedSource = "repository" | "cache" | "none";
export type RecognizedResult = { items: RecognizedItem[]; source: RecognizedSource; fetchedAt: number | null; origin: string | null; /** Identifiants que le dépôt du catalogue suggère (`catalogue/suggested.json`). */ suggested: string[] };

const run = promisify(execFile);
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const INDEX_PATH = "catalogue/index.json";
const SUGGESTED_PATH = "catalogue/suggested.json";
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
      offers: sanitizeServiceList(i.offers, "version"),
      needs: sanitizeServiceList(Array.isArray(i.requires) ? i.requires : i.needs, "min"),
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

/** Adresse du dépôt de modules que le catalogue connaît par défaut (le seul) ; d'autres se configurent (CURIOSA_CATALOGUE_REPO, MODULES_INDEX_URL, « Mes dépôts de modules »). */
export const DEFAULT_CATALOGUE_REPO = "https://github.com/helldog136/curiosa-extras";

/** Dépôt qui publie l'index : CURIOSA_CATALOGUE_REPO, sinon le dépôt par défaut (DEFAULT_CATALOGUE_REPO). */
export function resolveIndexRepo(): string | null {
  const url = process.env.CURIOSA_CATALOGUE_REPO?.trim() || DEFAULT_CATALOGUE_REPO;
  const parsed = parseRepoUrl(toHttpsRemote(url));
  return parsed.ok ? parsed.repo.url : null;
}

/** Lit `catalogue/index.json` et `catalogue/suggested.json` (facultatif) dans le dépôt, sans rien écrire dans l'installation : un dépôt temporaire, une récupération superficielle. */
export async function fetchCatalogueFromRepo(url: string, ref = "HEAD", git: IndexGit = defaultGit): Promise<{ index: unknown; suggested: unknown }> {
  if (!/^[\w./-]{1,100}$/.test(ref)) throw new Error("bad-ref");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-index-"));
  try {
    await git(["init", "-q", "--bare", tmp]);
    await git(["fetch", "-q", "--depth", "1", "--no-tags", "--", url, ref], tmp);
    const text = await git(["show", `FETCH_HEAD:${INDEX_PATH}`], tmp);
    if (text.length > MAX_INDEX_BYTES) throw new Error("too-large");
    let suggested: unknown = [];
    try { suggested = JSON.parse(await git(["show", `FETCH_HEAD:${SUGGESTED_PATH}`], tmp)); } catch { /* pas de liste : rien n'est suggéré */ }
    return { index: JSON.parse(text), suggested };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Identifiants valides d'une liste de suggestions (tout le reste est écarté). */
export const sanitizeSuggested = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && ID_RE.test(id)) : []);

const cacheFile = () => path.join(DATA_DIR, "cache", "recognized-index.json");
function readPersisted(): { items: RecognizedItem[]; suggested: string[]; fetchedAt: number; origin: string | null } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    return { items: sanitizeEntries(raw), suggested: sanitizeSuggested(raw.suggested), fetchedAt: Number(raw.fetchedAt) || 0, origin: typeof raw.origin === "string" ? raw.origin : null };
  } catch { return null; }
}

/** Un catalogue injoignable n'est retenu que quelques secondes : « réessayez » doit pouvoir réussir sans attendre un quart d'heure. */
const FAILED_TTL = 20_000;
let memo: { at: number; key: string; result: RecognizedResult } | null = null;
export function clearRecognizedCache(): void { memo = null; }

export type RecognizedOptions = { fetchImpl?: typeof fetch; git?: IndexGit; now?: () => number };

/**
 * Index des modules RECONNUS, lu UNIQUEMENT sur le réseau : le cœur ne contient ni module ni copie de l'index. Deux sources, la plus fraîche d'abord :
 *   1. le fichier `catalogue/index.json` du dépôt du catalogue (par défaut curiosa-extras), lu À L'EXÉCUTION, avec `catalogue/suggested.json` ;
 *   2. à défaut, la dernière copie reçue (gardée dans data/cache) : une panne réseau passagère ne vide pas le Catalogue.
 * Sans réseau et sans copie reçue : liste VIDE (source « none »), jamais une copie locale.
 * En plus, un index JSON https supplémentaire (MODULES_INDEX_URL) dont les entrées ne peuvent qu'AJOUTER des modules.
 * Celui qui publie un index se porte garant des dépôts qu'il liste ; chaque entrée est revalidée ici. Rien n'est installé automatiquement.
 */
export async function getRecognizedDetailed(opts: RecognizedOptions = {}): Promise<RecognizedResult> {
  const { fetchImpl = fetch, git = defaultGit, now = Date.now } = opts;
  const extraUrl = process.env.MODULES_INDEX_URL;
  const key = `${process.env.CURIOSA_CATALOGUE_REPO ?? ""}|${process.env.CURIOSA_CATALOGUE_REF ?? ""}|${extraUrl ?? ""}`;
  if (memo && memo.key === key && now() - memo.at < (memo.result.source === "none" ? FAILED_TTL : TTL)) return memo.result;

  let base: RecognizedResult = { items: [], source: "none", fetchedAt: null, origin: null, suggested: [] };
  const repo = resolveIndexRepo();
  if (repo) {
    try {
      const got = await fetchCatalogueFromRepo(repo, process.env.CURIOSA_CATALOGUE_REF || "HEAD", git);
      const items = sanitizeEntries(got.index);
      const suggested = sanitizeSuggested(got.suggested);
      base = { items, source: "repository", fetchedAt: now(), origin: repo, suggested };
      try {
        fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
        fs.writeFileSync(cacheFile(), JSON.stringify({ version: 1, fetchedAt: base.fetchedAt, origin: repo, modules: items, suggested }));
      } catch { /* la copie locale est un plus */ }
    } catch { /* injoignable : on retombe sur la dernière copie reçue */ }
  }
  if (base.source === "none") {
    const kept = readPersisted();
    if (kept && kept.items.length + (kept.fetchedAt ? 1 : 0) > 0) base = { items: kept.items, source: "cache", fetchedAt: kept.fetchedAt, origin: kept.origin, suggested: kept.suggested };
  }

  // Le dépôt du catalogue (ou sa dernière copie reçue, qui ne contient que lui) : « official ». L'index supplémentaire : « extra ».
  const items: RecognizedItem[] = base.items.map((i) => ({ ...i, catalogueOrigin: "official" as const }));
  if (extraUrl?.startsWith("https://")) {
    try {
      const res = await fetchImpl(extraUrl, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (res.ok) for (const e of sanitizeEntries(await res.json())) if (!items.some((i) => i.id === e.id)) items.push({ ...e, catalogueOrigin: "extra" });
    } catch { /* index supplémentaire injoignable : on garde le reste */ }
  }
  const result = { ...base, items: items.slice(0, 300) };
  memo = { at: now(), key, result };
  return result;
}

export async function getRecognized(fetchImpl: typeof fetch = fetch): Promise<RecognizedItem[]> {
  return (await getRecognizedDetailed({ fetchImpl })).items;
}
