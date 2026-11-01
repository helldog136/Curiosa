import http from "node:http";
import { createPinnedFetch, resolveHost, type Resolver } from "@/core/maintenance/content/net";
import { addressIsPrivate } from "@/core/url";
import { getSetting, setSetting } from "@/core/settings";
import { hostOfUrl, hostProblem, visitedAddress } from "@/core/siteAddress";
import type { Checklist } from "@/core/domainChecklist";

/**
 * « APRÈS LE CHANGEMENT » : contrôle de fin de migration, LECTURE SEULE et À LA DEMANDE (aucun minuteur, rien en arrière-plan). Les appels sortants sont bornés (5 secondes, un seul
 * essai par adresse, dix anciens domaines au plus) et sûrs : le nom est résolu UNE fois, les adresses privées ou locales sont refusées, et la connexion n'est ouverte qu'à l'adresse
 * vérifiée (le même mécanisme que le contrôle du contenu). Les seules adresses contactées sont `SITE_URL` et les domaines de `LEGACY_HOSTS`, réglés dans `.env` : aucune adresse n'est lue dans la requête.
 */

export const PROBE_TIMEOUT_MS = 5000;

export type ProbeError = "invalid" | "private" | "dns" | "timeout" | "tls" | "network";
export type ProbeResult = { ok: true; status: number; headers: Headers; body: string } | { ok: false; error: ProbeError };
export type Probe = (url: string, method: "GET" | "HEAD") => Promise<ProbeResult>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Un sondeur sûr. `resolve` et `fetch` ne sont remplacés que par les tests. */
export function createProbe(deps: { resolve?: Resolver; fetch?: FetchLike; timeoutMs?: number } = {}): Probe {
  const resolve = deps.resolve ?? resolveHost;
  const timeout = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  return async (url, method) => {
    let u: URL;
    try { u = new URL(url); } catch { return { ok: false, error: "invalid" }; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "invalid" };
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    // Une adresse numérique ou un nom de réseau privé n'est jamais contacté (pas de résolution du tout).
    if (hostProblem(host) !== null) return { ok: false, error: "private" };
    const started = Date.now();
    const found = await resolve(host);
    if (!found.ok) return { ok: false, error: found.reason === "timeout" ? "timeout" : "dns" };
    if (found.addresses.some((a) => addressIsPrivate(a))) return { ok: false, error: "private" };
    const pins = new Map([[host, found.addresses]]);
    const send = deps.fetch ?? createPinnedFetch(pins, u.protocol === "http:" ? { transport: http as never, port: 80 } : {});
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(500, timeout - (Date.now() - started)));
    try {
      const res = await send(u.toString(), { method, headers: { "user-agent": "Curiosa-address-check", accept: "*/*" }, signal: ctl.signal, redirect: "manual" });
      const body = method === "GET" ? (await res.text().catch(() => "")).slice(0, 200) : "";
      if (method === "HEAD") await res.body?.cancel().catch(() => {});
      return { ok: true, status: res.status, headers: res.headers, body };
    } catch (error) {
      if (ctl.signal.aborted) return { ok: false, error: "timeout" };
      const code = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      return { ok: false, error: /CERT|TLS|SSL|self[- ]signed|unable to verify|altnames|hostname/i.test(code) ? "tls" : "network" };
    } finally { clearTimeout(timer); }
  };
}

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";
/** `id` + `status` désignent le texte (clé `domain.check.<id>.<status>`) ; `params` complète la phrase (domaine, code de réponse…). */
export type CheckResult = { id: string; status: CheckStatus; params?: Record<string, string> };

const LOCATION_OK = (location: string | null, siteUrl: string): boolean => {
  if (!location) return false;
  try { return new URL(location, "https://invalid.invalid").origin === new URL(siteUrl).origin; } catch { return false; }
};

/** Tous les contrôles. `hostHeader` : l'en-tête Host de la page qui les demande (la personne visite-t-elle le site par sa nouvelle adresse ?). */
export async function runAfterChecks(opts: { siteUrl: string; hostHeader: string | null; legacy: readonly string[]; probe?: Probe }): Promise<CheckResult[]> {
  const probe = opts.probe ?? createProbe();
  const { siteUrl } = opts;
  const siteHost = hostOfUrl(siteUrl);
  const publicSite = hostProblem(siteHost) === null;
  const out: CheckResult[] = [];

  const v = visitedAddress(opts.hostHeader, siteUrl);
  out.push(v.same === null ? { id: "visited", status: "skipped" } : v.same ? { id: "visited", status: "ok", params: { host: v.configured } } : { id: "visited", status: "warn", params: { visited: v.visited ?? "", host: v.configured } });
  out.push(!publicSite ? { id: "https", status: "skipped" } : /^https:/i.test(siteUrl) ? { id: "https", status: "ok" } : { id: "https", status: "fail" });

  const jobs: Promise<CheckResult[]>[] = [];
  if (publicSite && /^https:/i.test(siteUrl)) {
    jobs.push((async (): Promise<CheckResult[]> => {
      const res = await probe(`${siteUrl}/api/health`, "GET");
      if (!res.ok) return [{ id: "health", status: res.error === "private" ? "skipped" : "fail", params: { reason: res.error } }];
      const healthy = res.status === 200 && /^ok/.test(res.body.trim());
      const list: CheckResult[] = [healthy ? { id: "health", status: "ok" } : { id: "health", status: "fail", params: { reason: "status", status: String(res.status) } }];
      list.push(res.headers.get("strict-transport-security") ? { id: "hsts", status: "ok" } : { id: "hsts", status: "warn" });
      return list;
    })());
    jobs.push((async (): Promise<CheckResult[]> => {
      const res = await probe(`http://${siteHost}/`, "HEAD");
      if (!res.ok) return [{ id: "httpRedirect", status: res.error === "private" ? "skipped" : "warn", params: { reason: res.error } }];
      const to = res.headers.get("location") ?? "";
      return [res.status >= 300 && res.status < 400 && /^https:/i.test(to) ? { id: "httpRedirect", status: "ok" } : { id: "httpRedirect", status: "warn", params: { reason: "status", status: String(res.status) } }];
    })());
  } else {
    out.push({ id: "health", status: "skipped" });
  }
  for (const host of opts.legacy.slice(0, 10)) {
    jobs.push((async (): Promise<CheckResult[]> => {
      const res = await probe(`https://${host}/`, "HEAD");
      if (!res.ok) return [{ id: "legacy", status: res.error === "private" ? "skipped" : "fail", params: { host, reason: res.error } }];
      return [res.status === 301 && LOCATION_OK(res.headers.get("location"), siteUrl) ? { id: "legacy", status: "ok", params: { host } } : { id: "legacy", status: "fail", params: { host, reason: "status", status: String(res.status) } }];
    })());
  }
  for (const list of await Promise.all(jobs)) out.push(...list);
  return out;
}

/* ───────────── Cases à cocher mémorisées ───────────── */

const TICKS_KEY = "domain.after";
const MAX_TICKS = 100;

export async function getAfterTicks(): Promise<string[]> {
  const v = await getSetting<{ done?: unknown }>(TICKS_KEY);
  return Array.isArray(v?.done) ? v.done.filter((x): x is string => typeof x === "string").slice(0, MAX_TICKS) : [];
}

/** Coche ou décoche une tâche. Seule une tâche CONNUE de la liste actuelle est retenue (jamais un texte quelconque venu du formulaire). */
export async function setAfterTick(id: string, done: boolean, known: ReadonlySet<string>): Promise<boolean> {
  if (!known.has(id)) return false;
  const current = await getAfterTicks();
  const next = done ? [...new Set([...current, id])].slice(0, MAX_TICKS) : current.filter((x) => x !== id);
  await setSetting(TICKS_KEY, { done: next });
  return true;
}

/* ───────────── Ce qu'il reste à refaire ───────────── */

export type AfterTask = { id: string; kind: "passkeys" | "returns" | "uses" | "assistants" | "overlays" | "shortLinks" | "content"; count: number; instance?: string };

/** Les tâches à refaire à la main après le changement, d'après ce que possède ce site. Une rubrique vide n'apparaît pas. */
export function afterTasks(c: Checklist): AfterTask[] {
  const tasks: AfterTask[] = [];
  if (c.passkeys.keys > 0) tasks.push({ id: "passkeys", kind: "passkeys", count: c.passkeys.keys });
  c.returns.forEach((r, i) => tasks.push({ id: `return:${r.instanceKey}:${i}`, kind: "returns", count: 1, instance: r.instanceKey }));
  c.uses.forEach((u, i) => tasks.push({ id: `use:${u.instanceKey}:${i}`, kind: "uses", count: 1, instance: u.instanceKey }));
  if (c.assistants.active > 0) tasks.push({ id: "assistants", kind: "assistants", count: c.assistants.active });
  if (c.overlays.pages + c.overlays.sources > 0) tasks.push({ id: "overlays", kind: "overlays", count: c.overlays.pages + c.overlays.sources });
  if (c.shortLinks.total > 0) tasks.push({ id: "shortLinks", kind: "shortLinks", count: c.shortLinks.total });
  if (c.content.hits.length > 0) tasks.push({ id: "content", kind: "content", count: c.content.hits.length });
  return tasks;
}
