import type { NetRequest, NetResult } from "@/core/services/net";
import { addressIsPrivate, hostProblem } from "@/core/url";
import type { PinTable, Resolved, Resolver } from "./net";

/**
 * CONTRÔLE DU CONTENU — visiter UN lien externe, poliment et sans jamais servir à autre chose.
 *
 * Règles (toutes appliquées ici, AVANT le moindre appel réseau, à chaque étape y compris chaque redirection) :
 *  - seules les adresses publiques en https sur le port habituel sont visitées : jamais d'adresse numérique, de nom interne, de port exotique, d'identifiants dans l'adresse ;
 *  - le nom est résolu UNE fois ; s'il mène (même en partie) vers une adresse privée, locale ou réservée, rien n'est contacté ; sinon la connexion est ouverte vers
 *    ces adresses vérifiées et vers elles seules (voir net.ts : pas de seconde résolution, donc pas de « rebinding ») ;
 *  - toute visite passe par le client réseau du cœur (délai dur, pause quand un site dit « trop de demandes », disjoncteur) ;
 *  - une demande HEAD d'abord (on ne télécharge rien), puis une demande GET limitée à 2 Ko seulement si le site ne sait pas répondre à HEAD ;
 *  - les redirections sont suivies à la main, 5 au plus, et chaque étape repasse par les mêmes règles ;
 *  - une destination non sécurisée (http) n'est jamais visitée.
 * Résultat : { st, code?, why?, to?, insecure?, retryAt? }
 *   st : ok · moved · gone · down · blocked · loop · paused · refused · unverified
 */
export const MAX_REDIRECTS = 5;
export const REQUEST_TIMEOUT_MS = 6000;
export const LINK_BUDGET_MS = 14000;
export const GET_BYTES = 2048;
const RETRY_WITH_GET = new Set([400, 403, 404, 405, 406, 501]);

export type ProbeStatus = "ok" | "moved" | "gone" | "down" | "blocked" | "loop" | "paused" | "refused" | "unverified";
export type ProbeResult = { st: ProbeStatus; code?: number; why?: string; to?: string; insecure?: boolean; retryAt?: number };

export type ProbeDeps = {
  net: { request(req: NetRequest, call?: { module?: string; budgetMs?: number | null }): Promise<NetResult> };
  pins: PinTable;
  resolve: Resolver;
  /** Noms déjà résolus pendant ce paquet (les adresses vérifiées servent à toutes les visites du même nom). */
  dnsCache?: Map<string, Resolved>;
  siteUrl: string;
  now?: () => number;
  linkBudgetMs?: number;
};

/** Pourquoi cette adresse ne doit pas être visitée (null : elle peut l'être). Fait la résolution du nom, une fois par nom et par paquet. */
export async function refusal(url: URL, deps: Pick<ProbeDeps, "resolve" | "dnsCache" | "pins">): Promise<{ kind: "refused"; why: string } | { kind: "ok"; addresses: string[] } | { kind: "unresolved"; reason: "notfound" | "timeout" | "error" }> {
  const problem = hostProblem(url);
  if (problem) return { kind: "refused", why: problem };
  const host = url.hostname.toLowerCase();
  let found = deps.dnsCache?.get(host);
  if (!found) {
    found = await deps.resolve(host);
    deps.dnsCache?.set(host, found);
  }
  if (!found.ok) return { kind: "unresolved", reason: found.reason };
  if (found.addresses.some(addressIsPrivate)) return { kind: "refused", why: "private" };
  return { kind: "ok", addresses: found.addresses };
}

const canon = (u: URL) => `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;

type Hit = { status: number; location?: string } | { fail: "timeout" | "network" | "invalid" } | { paused: true; retryAt?: number; reason: string };

async function hit(deps: ProbeDeps, url: URL, method: "HEAD" | "GET", deadline: number, now: () => number): Promise<Hit> {
  const left = deadline - now();
  if (left < 600) return { fail: "timeout" };
  let r: NetResult;
  try {
    r = await deps.net.request({
      url: url.href, method,
      headers: { "user-agent": `Mozilla/5.0 (compatible; LinkCheck/1.0; +${deps.siteUrl})`, accept: "*/*" },
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, left), maxBytes: GET_BYTES, retry: 0, dedupe: false, bucket: `content-check:${url.hostname.toLowerCase()}`,
    }, { module: "core.content-check" });
  } catch { return { fail: "network" }; }
  if (r.ok) return { status: r.status, location: r.headers.location };
  if (r.error === "too_large" && r.status) return { status: r.status }; // la réponse a commencé : c'est tout ce qu'on voulait savoir
  if (r.error === "rate" || r.error === "quota" || r.error === "circuit" || r.error === "busy") return { paused: true, retryAt: r.retryAt, reason: r.error };
  if (r.error === "invalid") return { fail: "invalid" };
  return { fail: r.error === "timeout" ? "timeout" : "network" };
}

/** Visite un lien externe (voir l'en-tête). Ne lève jamais. */
export async function probeLink(rawUrl: string, deps: ProbeDeps): Promise<ProbeResult> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.linkBudgetMs ?? LINK_BUDGET_MS);
  let current: URL;
  try { current = new URL(rawUrl); } catch { return { st: "refused", why: "invalid" }; }
  const insecure = current.protocol === "http:";
  if (insecure) { current.protocol = "https:"; current.port = ""; }
  const origin = new URL(current.href);
  const seen = new Set<string>();
  let permanent = false;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const check = await refusal(current, deps);
      if (check.kind === "unresolved") {
        // Un nom qui n'existe pas est un lien mort ; un DNS qui ne répond pas ou se trompe n'apprend rien sur le lien.
        return check.reason === "notfound" ? (insecure ? { st: "unverified", why: "insecure" } : { st: "down", why: "dns" }) : { st: "unverified", why: "dns" };
      }
      if (check.kind === "refused") return { st: "refused", why: hop === 0 ? check.why : `redirect_${check.why}` };
      if (seen.has(current.href)) return { st: "loop" };
      seen.add(current.href);

      // La connexion n'ira qu'à ces adresses vérifiées (voir net.ts).
      deps.pins.set(current.hostname.toLowerCase(), check.addresses);
      let r = await hit(deps, current, "HEAD", deadline, now);
      if (!("paused" in r) && !("fail" in r) && RETRY_WITH_GET.has(r.status)) r = await hit(deps, current, "GET", deadline, now);
      deps.pins.delete(current.hostname.toLowerCase());
      if ("paused" in r) return { st: "paused", retryAt: r.retryAt, why: r.reason };
      if ("fail" in r) return insecure ? { st: "unverified", why: "insecure" } : { st: "down", why: r.fail };

      const code = r.status;
      if (code >= 300 && code < 400 && r.location) {
        let next: URL;
        try { next = new URL(r.location, current); } catch { return { st: "down", why: "badredirect", code }; }
        if (next.protocol !== "https:") return { st: "unverified", why: "insecure", code }; // la destination n'est pas sécurisée : on ne la visite pas
        if (code === 301 || code === 308) permanent = true;
        current = next;
        continue;
      }
      if (code === 404 || code === 410) return insecure ? { st: "unverified", why: "insecure", code } : { st: "gone", code };
      if (code >= 500) return insecure ? { st: "unverified", why: "insecure", code } : { st: "down", why: "server", code };
      if (code >= 400) return insecure ? { st: "unverified", why: "insecure", code } : { st: "blocked", code }; // 401, 403, 429, 999… : le site répond mais refuse les visites automatiques
      if (permanent && canon(origin) !== canon(current)) return { st: "moved", to: current.href, insecure };
      return insecure ? { st: "ok", insecure: true } : { st: "ok" };
    }
    return { st: "loop" };
  } catch {
    return { st: "down", why: "network" };
  } finally {
    deps.pins.delete(current.hostname.toLowerCase());
  }
}
