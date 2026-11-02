import { isSubdir } from "./installer";

/**
 * LECTURE DIRECTE D'UN FICHIER D'UN DÉPÔT GITHUB PUBLIC (https://raw.githubusercontent.com/…), une requête par fichier : c'est ce qui sert la fiche d'une extension
 * (module.json, README, images). Un clonage du dépôt entier pour lire un fichier texte est le DERNIER recours (voir readme.ts).
 *
 * Garde-fous (les mêmes que pour l'installation, en plus strict) :
 *   - l'adresse du dépôt vient du catalogue ou de `parseRepoUrl` (hôtes autorisés, https), jamais de la demande telle quelle ;
 *   - un seul hôte est joint : raw.githubusercontent.com, en https, sans suivre aucune redirection ;
 *   - le chemin est construit ici (propriétaire/dépôt/étiquette/dossier/fichier), chaque morceau validé ;
 *   - la taille est bornée AVANT d'être lue en entier ; délai court ; 2 essais ; une requête partagée par adresse ; 4 lectures en même temps au plus.
 */
export const RAW_HOST = "raw.githubusercontent.com";
const TIMEOUT_MS = 8_000;
const ATTEMPTS = 2;
const MAX_PARALLEL = 4;
/** Requêtes réseau au plus pour ouvrir UNE fiche (manifeste, README, ses repli, 6 images). */
export const MAX_REQUESTS_PER_FICHE = 8;

export type RawFailure = "network" | "rate-limit" | "http" | "redirect" | "too-large";
export class RawError extends Error {
  kind: RawFailure;
  status?: number;
  retryAfterSec?: number;
  constructor(kind: RawFailure, status?: number, retryAfterSec?: number) { super(`raw-${kind}${status ? `-${status}` : ""}`); this.kind = kind; this.status = status; this.retryAfterSec = retryAfterSec; }
}

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Pour les tests : remplace le réseau. `null` remet le vrai. */
export function setRawFetch(f: Fetch | null): void { fetchImpl = f; limitedUntil = 0; inflight.clear(); }

/** Après un refus « trop de requêtes » : on ne réessaie pas avant l'heure indiquée par GitHub (au plus 10 minutes), la copie ou le clonage prend le relais. */
let limitedUntil = 0;
export const rawLimitedUntil = () => limitedUntil;

/** Adresse de base `https://raw.githubusercontent.com/<propriétaire>/<dépôt>/<étiquette>` pour un dépôt github.com, sinon null (le clonage prend le relais). */
export function rawBase(repoUrl: string, ref?: string): string | null {
  let u: URL;
  try { u = new URL(repoUrl); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password || u.search || u.port) return null;
  const m = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(u.pathname);
  if (!m) return null;
  const r = ref && ref !== "" ? ref : "HEAD";
  if (!/^[\w./-]{1,100}$/.test(r) || r.split("/").some((s) => s === ".." || s === "." || s === "")) return null;
  return `https://${RAW_HOST}/${m[1]}/${m[2]}/${r.split("/").map(encodeURIComponent).join("/")}`;
}

/** Adresse d'un fichier du module : `file` est un nom fixe du cœur ou un chemin de visuel déjà validé (previews/<nom>.webp|png). */
export function rawFileUrl(base: string, subdir: string | undefined, file: string): string | null {
  if (subdir !== undefined && !isSubdir(subdir)) return null;
  if (!/^[A-Za-z0-9][\w.-]{0,63}(\/[A-Za-z0-9][\w.-]{0,63})?$/.test(file)) return null;
  return `${base}/${subdir ? `${subdir}/` : ""}${file}`;
}

let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX_PARALLEL) active++; else await new Promise<void>((r) => waiting.push(r));
  try { return await fn(); } finally { const n = waiting.shift(); if (n) n(); else active--; }
}

const inflight = new Map<string, Promise<Buffer | null>>();
/** Compteur de requêtes réellement parties (pour les tests et la mesure). */
export const rawStats = { requests: 0 };

async function readBody(res: Response, maxBytes: number, truncate: boolean): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) { void res.body?.cancel().catch(() => {}); throw new RawError("too-large"); }
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) {
      void reader.cancel().catch(() => {});
      if (!truncate) throw new RawError("too-large");
      chunks.push(Buffer.from(value));
      return Buffer.concat(chunks).subarray(0, maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function once(url: string, maxBytes: number, truncate: boolean): Promise<Buffer | null> {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== RAW_HOST || u.username || u.password) throw new RawError("http");
  rawStats.requests++;
  let res: Response;
  try {
    res = await (fetchImpl ?? fetch)(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Curiosa", accept: "*/*" } });
  } catch { throw new RawError("network"); }
  if (res.status === 200) return readBody(res, maxBytes, truncate);
  void res.body?.cancel().catch(() => {});
  if (res.status === 404) return null;
  if (res.status >= 300 && res.status < 400) throw new RawError("redirect", res.status);
  if (res.status === 429 || (res.status === 403 && (res.headers.get("retry-after") || res.headers.get("x-ratelimit-remaining") === "0"))) {
    const retry = Number(res.headers.get("retry-after"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const sec = Number.isFinite(retry) && retry > 0 ? retry : Number.isFinite(reset) && reset > 0 ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 60;
    limitedUntil = Date.now() + Math.min(sec, 600) * 1000;
    throw new RawError("rate-limit", res.status, sec);
  }
  throw new RawError("http", res.status);
}

/**
 * Lit un fichier : ses octets, ou null s'il n'existe pas (404). Lève `RawError` sinon (jamais gardé en copie). Deux essais pour une panne passagère (réseau, 5xx) ;
 * pas de nouvel essai pour un refus de limite de débit ni pour un fichier trop gros (sauf `truncate` : on garde alors les `maxBytes` premiers octets, pour un texte long). Plusieurs demandes en même temps pour la même adresse partagent UNE requête.
 */
export function rawGet(url: string, maxBytes: number, truncate = false): Promise<Buffer | null> {
  const key = `${url}|${maxBytes}|${truncate}`;
  const shared = inflight.get(key);
  if (shared) return shared;
  const p = slot(async () => {
    if (Date.now() < limitedUntil) throw new RawError("rate-limit", 429, Math.ceil((limitedUntil - Date.now()) / 1000));
    let last: RawError = new RawError("network");
    for (let i = 0; i < ATTEMPTS; i++) {
      try { return await once(url, maxBytes, truncate); } catch (e) {
        if (!(e instanceof RawError)) throw e;
        last = e;
        if (e.kind !== "network" && !(e.kind === "http" && (e.status ?? 0) >= 500)) break;
        if (i + 1 < ATTEMPTS) await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw last;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
