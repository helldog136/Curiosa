/**
 * CATALOGUE DES SKINS (docs/SKINS.md §5.5, §10) : la liste des skins que l'on peut installer en confiance, calquée sur celle des modules
 * (`modules/recognized.ts`, dont elle réutilise la lecture d'un index dans un dépôt git).
 *
 *   official   `catalogue/index.json` du dépôt de skins (par défaut `DEFAULT_SKINS_REPO`, remplaçable par CURIOSA_SKINS_REPO ; CURIOSA_SKINS_REF choisit
 *              l'étiquette ou la branche lue) : lu SUR LE RÉSEAU, au plus toutes les 15 minutes ; la dernière copie reçue est gardée (data/cache) ;
 *              le cœur n'embarque aucune liste. Sans réseau ni copie : liste vide et message simple, les skins installés continuent.
 *   extra      un index JSON https supplémentaire (SKINS_INDEX_URL) qui ne peut qu'AJOUTER des skins ; jamais installé sans confirmation.
 *   personal   tout autre dépôt : jamais listé ici, installé sur confirmation explicite (service.ts).
 *
 * Aucun minuteur : la liste se relit à la demande, avec un cache qui expire.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, DEFAULT_SKINS_REPO } from "../config";
import { fetchCatalogueFromRepo, toHttpsRemote } from "../modules/recognized";
import { SKIN_ID_RE } from "./allowlist";
import { SKIN_CONTRACT, TAG_VOCABULARY } from "./constants";
import type { Text } from "./messages";
import { coreSatisfies } from "./semver";
import { parseSkinRepoUrl } from "./source";

export type SkinOrigin = "official" | "extra" | "personal";

export type SkinCatalogueEntry = {
  id: string;
  name: Text;
  description: Text;
  /** Dépôt (adresse https sans fragment). */
  repo: string;
  subdir?: string;
  /** Étiquette ou commit relu et épinglé. */
  ref?: string;
  version?: string;
  skinContract?: number;
  author?: string;
  icon?: string;
  tags: string[];
  modes: ("light" | "dark")[];
  /** Cœur minimal annoncé (`requires.core`). */
  requires?: { core: string };
  /** Chemin de l'image d'aperçu dans le dépôt (le site ne la charge jamais depuis GitHub : voir `inspect`). */
  preview?: string;
  /** Ce skin vise-t-il un contrat que CE cœur comprend ? Sinon il est listé mais pas installable. */
  compatible: boolean;
  /** Version du cœur demandée quand CE cœur est trop ancien. */
  needsNewerCore?: string;
  origin: "official" | "extra";
};

export type CatalogueSource = "repository" | "cache" | "none";
export type CatalogueRead = { entries: SkinCatalogueEntry[]; source: CatalogueSource; fetchedAt: number | null; /** Adresse du dépôt du catalogue lu. */ origin: string | null; /** Ni dépôt ni dernière copie reçue : « réessayez » et non « rien à proposer ». */ unreachable: boolean };

const TTL = 15 * 60_000;
/** Un catalogue injoignable n'est retenu que quelques secondes : « réessayez » doit pouvoir réussir sans attendre un quart d'heure. */
const FAILED_TTL = 20_000;
const MAX_ENTRIES = 300;
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function text(v: unknown, fallback: string, max: number): Text {
  if (typeof v === "string") { const s = str(v, max) ?? fallback; return { fr: s, en: s }; }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const fr = str(o.fr, max), en = str(o.en, max);
  return { fr: fr ?? en ?? fallback, en: en ?? fr ?? fallback };
}

/** Entrées valides d'un index (`{ skins: [...] }` ou tableau) : identifiant, dépôt https sur un hôte autorisé, doublons écartés. Rien n'est cru sur parole. */
export function sanitizeSkinEntries(json: unknown, coreVersion: string, origin: "official" | "extra" = "official"): SkinCatalogueEntry[] {
  const list = Array.isArray(json) ? json : Array.isArray((json as { skins?: unknown })?.skins) ? (json as { skins: unknown[] }).skins : [];
  const seen = new Set<string>();
  const out: SkinCatalogueEntry[] = [];
  for (const i of list) {
    if (!i || typeof i !== "object" || typeof i.id !== "string" || typeof i.repo !== "string" || !SKIN_ID_RE.test(i.id) || i.id === "basic" || seen.has(i.id)) continue;
    const r = parseSkinRepoUrl(toHttpsRemote(i.repo));
    if (!r.ok || r.repo.url.startsWith("file:")) continue;
    const ref = typeof i.ref === "string" && /^[\w./-]{1,100}$/.test(i.ref) ? i.ref : undefined;
    const subdir = typeof i.subdir === "string" && parseSkinRepoUrl(`${r.repo.url}#:${i.subdir}`).ok ? i.subdir : undefined;
    const core = typeof i.requires?.core === "string" && /^\d+\.\d+\.\d+$/.test(i.requires.core) ? i.requires.core : undefined;
    const contract = Number.isInteger(i.skinContract) ? (i.skinContract as number) : undefined;
    const modes = Array.isArray(i.modes) ? [...new Set(i.modes.filter((m: unknown): m is "light" | "dark" => m === "light" || m === "dark"))] as ("light" | "dark")[] : [];
    seen.add(i.id);
    out.push({
      id: i.id, name: text(i.name, i.id, 40), description: text(i.description, "", 200), repo: r.repo.url, subdir, ref,
      version: typeof i.version === "string" && /^\d+\.\d+\.\d+$/.test(i.version) ? i.version : undefined,
      skinContract: contract, author: str(i.author, 120), icon: str(i.icon, 8),
      tags: Array.isArray(i.tags) ? i.tags.filter((t: unknown): t is string => typeof t === "string" && TAG_VOCABULARY.includes(t)).slice(0, 6) : [],
      modes, requires: core ? { core } : undefined,
      preview: typeof i.preview === "string" && /^[\w./-]{1,150}$/.test(i.preview) && !i.preview.includes("..") ? i.preview : undefined,
      compatible: contract === undefined || contract <= SKIN_CONTRACT,
      needsNewerCore: core && !coreSatisfies(core, coreVersion) ? core : undefined,
      origin,
    });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

/** Dépôt qui publie l'index : CURIOSA_SKINS_REPO, sinon `DEFAULT_SKINS_REPO`. */
export function resolveSkinsRepo(): string | null {
  const url = process.env.CURIOSA_SKINS_REPO?.trim() || DEFAULT_SKINS_REPO;
  const parsed = parseSkinRepoUrl(toHttpsRemote(url));
  return parsed.ok ? parsed.repo.url : null;
}

const cacheFile = () => path.join(DATA_DIR, "cache", "skins-index.json");
function readPersisted(coreVersion: string): { entries: SkinCatalogueEntry[]; fetchedAt: number; origin: string | null } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    return { entries: sanitizeSkinEntries(raw, coreVersion), fetchedAt: Number(raw.fetchedAt) || 0, origin: typeof raw.origin === "string" ? raw.origin : null };
  } catch { return null; }
}

let memo: { at: number; key: string; coreVersion: string; result: CatalogueRead } | null = null;
export function clearSkinCatalogueCache(): void { memo = null; }

export type CatalogueOptions = { coreVersion: string; fetchImpl?: typeof fetch; now?: () => number; fresh?: boolean };

/**
 * La liste des skins installables. Deux sources, la plus fraîche d'abord : le dépôt du catalogue (lu à l'exécution), puis la dernière copie reçue.
 * Ne lève jamais : un catalogue injoignable donne `unreachable: true` et une liste vide (ou la dernière copie).
 */
export async function readSkinCatalogue(opts: CatalogueOptions): Promise<CatalogueRead> {
  const { fetchImpl = fetch, now = Date.now } = opts;
  const extraUrl = process.env.SKINS_INDEX_URL;
  const key = `${process.env.CURIOSA_SKINS_REPO ?? ""}|${process.env.CURIOSA_SKINS_REF ?? ""}|${extraUrl ?? ""}`;
  if (!opts.fresh && memo && memo.key === key && memo.coreVersion === opts.coreVersion && now() - memo.at < (memo.result.source === "none" ? FAILED_TTL : TTL)) return memo.result;

  let base: CatalogueRead = { entries: [], source: "none", fetchedAt: null, origin: null, unreachable: true };
  const repo = resolveSkinsRepo();
  if (repo) {
    try {
      const got = await fetchCatalogueFromRepo(repo, process.env.CURIOSA_SKINS_REF || "HEAD");
      const entries = sanitizeSkinEntries(got.index, opts.coreVersion);
      base = { entries, source: "repository", fetchedAt: now(), origin: repo, unreachable: false };
      try {
        fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
        fs.writeFileSync(cacheFile(), JSON.stringify({ version: 1, fetchedAt: base.fetchedAt, origin: repo, skins: entries }));
      } catch { /* la copie locale est un plus */ }
    } catch { /* injoignable : on retombe sur la dernière copie reçue */ }
  }
  if (base.source === "none") {
    const kept = readPersisted(opts.coreVersion);
    if (kept && kept.fetchedAt) base = { entries: kept.entries, source: "cache", fetchedAt: kept.fetchedAt, origin: kept.origin, unreachable: false };
  }
  const entries: SkinCatalogueEntry[] = base.entries.map((e) => ({ ...e, origin: "official" as const }));
  if (extraUrl?.startsWith("https://")) {
    try {
      const res = await fetchImpl(extraUrl, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (res.ok) for (const e of sanitizeSkinEntries(await res.json(), opts.coreVersion, "extra")) if (!entries.some((x) => x.id === e.id)) entries.push(e);
    } catch { /* index supplémentaire injoignable : on garde le reste */ }
  }
  const result: CatalogueRead = { ...base, entries: entries.slice(0, MAX_ENTRIES) };
  memo = { at: now(), key, coreVersion: opts.coreVersion, result };
  return result;
}
