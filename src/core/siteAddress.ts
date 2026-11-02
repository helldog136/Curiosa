/**
 * ADRESSE DU SITE : validation d'une adresse saisie, liste des anciens domaines (`LEGACY_HOSTS`) et décision de la redirection permanente.
 *
 * Rien ici ne lit la base ni le réseau : ce sont des fonctions pures, appelées par le proxy (`src/proxy.ts`), par la page « Adresse du site » et par les tests.
 * Règle de fond : la cible d'une redirection est TOUJOURS `SITE_URL` (jamais une valeur venue de la requête), donc aucune redirection ouverte possible.
 */

/** Au plus 10 anciens domaines (borne d'un site ; au-delà, la liste est tronquée et la page le dit). */
export const MAX_LEGACY_HOSTS = 10;

/** Un nom de domaine public : étiquettes de lettres, chiffres et tirets, au moins un point, une fin alphabétique (« .be », « .com »). Pas d'adresse numérique. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;
/** Fins de nom qui désignent un réseau privé : refusées pour un site public. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".corp", ".intranet", ".test", ".invalid", ".example"];

export type HostProblem = "empty" | "form" | "ip" | "local" | "invalid" | "toolong";

/** Vérifie un NOM de domaine (déjà en minuscules, sans port ni schéma). Renvoie le problème, ou null s'il convient à un site public. */
export function hostProblem(host: string): HostProblem | null {
  if (!host) return "empty";
  if (host.length > 253) return "toolong";
  if (/^\[.*\]$/.test(host) || host.includes(":")) return "ip";
  if (/^\d+(?:\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return "ip";
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return "local";
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !LABEL.test(l))) return "invalid";
  if (!TLD.test(labels[labels.length - 1]!)) return "invalid";
  return null;
}

export type AddressError = "empty" | "http" | "scheme" | "path" | "credentials" | "port" | "ip" | "local" | "invalid" | "toolong";
export type AddressResult = { ok: true; url: string; host: string } | { ok: false; error: AddressError };

/**
 * Comprend l'adresse saisie pour le NOUVEAU site : « https://monsite.be » (ou « monsite.be », le « https:// » est complété). Refuse : http, un chemin, un identifiant,
 * un numéro de port, une adresse numérique (IP), « localhost » et les noms de réseau privé. Renvoie l'adresse normalisée (minuscules, sans « / » final).
 */
export function parseSiteAddress(input: string): AddressResult {
  const raw = String(input ?? "").trim().replace(/^["'<]+|[>"',;.]+$/g, "");
  if (!raw) return { ok: false, error: "empty" };
  if (raw.length > 300) return { ok: false, error: "toolong" };
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: "invalid" };
  const schemed = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (/^http:\/\//i.test(raw)) return { ok: false, error: "http" };
  if (schemed && !/^https:\/\//i.test(raw)) return { ok: false, error: "scheme" };
  if (!schemed && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) return { ok: false, error: "scheme" };
  let url: URL;
  try { url = new URL(schemed ? raw : `https://${raw}`); } catch { return { ok: false, error: "invalid" }; }
  if (url.username || url.password) return { ok: false, error: "credentials" };
  if (url.port) return { ok: false, error: "port" };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return { ok: false, error: "path" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const problem = hostProblem(host);
  if (problem === "form" || problem === "invalid") return { ok: false, error: "invalid" };
  if (problem) return { ok: false, error: problem };
  return { ok: true, url: `https://${host}`, host };
}

/** Le nom de domaine d'une adresse de site (`SITE_URL`), en minuscules ; "" si elle est illisible. */
export function hostOfUrl(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}

/** Compare deux noms de domaine d'un site en ignorant la casse, le point final et un « www. » d'avant. */
export function sameSiteHost(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return !!a && !!b && norm(a) === norm(b);
}

export type LegacyHosts = { hosts: string[]; rejected: string[]; truncated: boolean };

/**
 * Lit `LEGACY_HOSTS` (noms de domaine séparés par des virgules, des espaces ou des points-virgules). Un nom invalide est écarté (et listé dans `rejected`, pour que la page
 * le dise) ; le domaine du site lui-même est écarté aussi (sinon la redirection tournerait en boucle) ; les doublons disparaissent ; 10 au plus.
 */
export function parseLegacyHosts(raw: string | undefined | null, siteHost: string): LegacyHosts {
  const hosts: string[] = [], rejected: string[] = [];
  let truncated = false;
  for (const part of String(raw ?? "").split(/[\s,;]+/)) {
    const name = part.trim().toLowerCase().replace(/\.$/, "");
    if (!name) continue;
    if (name.length > 253 || hostProblem(name) !== null) { if (rejected.length < 20) rejected.push(name.slice(0, 80)); continue; }
    if (name === siteHost.toLowerCase() || hosts.includes(name)) continue;
    if (hosts.length >= MAX_LEGACY_HOSTS) { truncated = true; continue; }
    hosts.push(name);
  }
  return { hosts, rejected, truncated };
}

/** Le nom de domaine de la requête d'après l'en-tête `Host` (seul en-tête posé par NOTRE proxy web) : minuscules, sans port ni point final ; null s'il est illisible. */
export function requestHost(hostHeader: string | null | undefined): string | null {
  const raw = String(hostHeader ?? "").trim().toLowerCase();
  if (!raw || raw.length > 270) return null;
  // Une seule valeur, de la forme nom ou nom:port. Une liste, un identifiant, un chemin ou une adresse numérique entre crochets ne sont jamais crus.
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return null;
  return m[1]!.replace(/\.$/, "") || null;
}

/** Chemins qu'une redirection de l'ancien domaine ne touche JAMAIS : l'API (jetons, connexions), les fichiers internes de Next et les retours de connexion d'un service tiers. */
export function legacyNeverRedirects(pathname: string): boolean {
  return /^\/(?:api|_next)(?:\/|$)/i.test(pathname) || /\/(?:oauth|callback)(?:\/|$)/i.test(pathname);
}

export type LegacyRequest = { method: string; host: string | null; pathname: string; search: string };

/**
 * L'adresse vers laquelle renvoyer cette requête (301), ou null si elle doit être servie normalement. Conditions : méthode GET ou HEAD ; nom de domaine de la requête dans la liste
 * des anciens domaines et différent de celui du site ; chemin hors API. La cible est construite UNIQUEMENT à partir de `siteUrl` (réglé par la personne qui gère le serveur),
 * du chemin et des paramètres de la requête : son domaine est celui du site, quoi que contienne le chemin.
 */
export function legacyRedirectTarget(req: LegacyRequest, siteUrl: string, legacy: readonly string[]): string | null {
  if (legacy.length === 0) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const host = req.host;
  if (!host || !legacy.includes(host)) return null;
  const site = hostOfUrl(siteUrl);
  if (!site || host === site) return null;
  let origin: string;
  try { origin = new URL(siteUrl).origin; } catch { return null; }
  if (!req.pathname.startsWith("/") || legacyNeverRedirects(req.pathname)) return null;
  // « //autre.site » collé après l'origine resterait sur notre domaine, mais on ne laisse aucun doute : un seul « / » au début, aucun antislash, aucun caractère de contrôle.
  const path = `/${req.pathname.replace(/^\/+/, "").replace(/\\/g, "%5C").replace(/[\u0000-\u001f\u007f]/g, "")}`;
  const search = req.search && req.search.startsWith("?") ? req.search.replace(/[\u0000-\u001f\u007f]/g, "") : "";
  let target: URL;
  try { target = new URL(`${origin}${path}${search}`); } catch { return null; }
  if (target.origin !== origin) return null;
  return target.toString();
}

/** Les réglages lus dans l'environnement (une seule lecture par valeur brute : le proxy tourne à chaque requête). */
let memo: { site: string; legacy: string; value: { siteUrl: string; hosts: string[] } } | null = null;
export function legacyConfig(env: Record<string, string | undefined> = process.env): { siteUrl: string; hosts: string[] } {
  const site = (env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const legacy = env.LEGACY_HOSTS ?? "";
  if (memo && memo.site === site && memo.legacy === legacy) return memo.value;
  const value = { siteUrl: site, hosts: parseLegacyHosts(legacy, hostOfUrl(site)).hosts };
  memo = { site, legacy, value };
  return value;
}

/**
 * La requête est-elle arrivée par l'adresse du site ? Compare le domaine visité (en-tête `Host`) à celui de `SITE_URL`. Un site local (« localhost ») ou une adresse
 * illisible ne donne jamais d'avertissement : on ne sait pas.
 */
export function visitedAddress(hostHeader: string | null | undefined, siteUrl: string): { visited: string | null; configured: string; same: boolean | null } {
  const configured = hostOfUrl(siteUrl);
  const visited = requestHost(hostHeader);
  if (!visited || !configured || hostProblem(configured) !== null) return { visited, configured, same: null };
  return { visited, configured, same: sameSiteHost(visited, configured) };
}
