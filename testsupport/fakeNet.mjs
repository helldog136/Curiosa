// Aides réseau pour tester un module SANS réseau : faux fetch, blocage du réseau, petit serveur local. API publique du kit (voir docs/TESTSUPPORT.md).
import http from "node:http";
import { register } from "node:module";

/**
 * Faux `fetch` : `routes` associe une adresse (ou un motif RegExp) à une réponse.
 *   const f = fakeFetch({ "https://api.example.org/v1/stats": { json: { followers: 12 } }, "https://api.example.org/down": { status: 503 } });
 *   f.calls   → [{ url, init }…]
 * Une réponse peut être : { json, status?, headers? } · { text, status? } · { status } · une Response · une fonction (url, init) => l'un de ces cas.
 * La clé "*" répond à TOUTES les adresses (après les autres clés). Les cas de panne tout prêts sont dans `netReplies` (429, quota, silence…).
 * Une adresse inconnue échoue comme un réseau coupé (TypeError « fetch failed »). Le `signal` de la demande est respecté : une demande annulée
 * (délai dépassé) échoue aussitôt avec une AbortError, même si la réponse prévue ne vient jamais.
 */
export function fakeFetch(routes = {}) {
  const calls = [];
  const entries = Object.entries(routes).filter(([k]) => k !== "*");
  const fallback = routes["*"];
  const answer = async (url, init) => {
    const hit = entries.find(([k]) => k === url || (k.startsWith("/") && k.endsWith("/") && new RegExp(k.slice(1, -1)).test(url))) ?? entries.find(([k]) => url.startsWith(k));
    if (!hit && fallback === undefined) throw new TypeError("fetch failed");
    let r = hit ? hit[1] : fallback;
    if (typeof r === "function") r = await r(url, init);
    if (r instanceof Response) return r;
    if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
    const status = r.status ?? 200;
    return new Response([101, 204, 205, 304].includes(status) ? null : r.text ?? "", { status, headers: r.headers });
  };
  const fn = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    calls.push({ url, init });
    const signal = init?.signal;
    if (signal?.aborted) throw abortError();
    if (!signal) return answer(url, init);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      answer(url, init).then((v) => { signal.removeEventListener("abort", onAbort); resolve(v); }, (e) => { signal.removeEventListener("abort", onAbort); reject(e); });
    });
  };
  fn.calls = calls;
  return fn;
}
const abortError = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

/**
 * Réponses de PANNE prêtes à l'emploi pour `fakeFetch` (et la sonde « net.429 ») :
 *   fakeFetch({ "*": netReplies.rateLimited(120) })                    429 + Retry-After: 120
 *   fakeFetch({ "https://api.example.org/": netReplies.quotaExceeded() }) 403 { error: { errors: [{ reason: "quotaExceeded" }] } }
 *   netReplies.silence()          jamais de réponse (trou noir) : seule l'annulation (signal) y met fin
 *   netReplies.truncatedJson()    200, content-type JSON, corps coupé au milieu
 *   netReplies.slow(5000, reply)  répond `reply` (défaut : { json: {} }) après 5 s, sauf annulation
 *   netReplies.down()             réseau coupé (TypeError « fetch failed »)
 *   netReplies.status(503, { headers })   un statut quelconque
 *   netReplies.rateLimitedBody(30)        429 sans en-tête, avec { retry_after: 30 } dans le corps
 *   netReplies.rateLimitedReset(epochSeconds)  429 avec RateLimit-Reset (époque) et RateLimit-Remaining: 0
 */
export const netReplies = {
  rateLimited: (seconds = 120, headers = {}) => () => ({ status: 429, text: "", headers: { "retry-after": String(seconds), ...headers } }),
  rateLimitedBody: (seconds = 30) => () => ({ status: 429, json: { message: "rate limited", retry_after: seconds } }),
  rateLimitedReset: (epochSeconds) => () => ({ status: 429, text: "", headers: { "ratelimit-reset": String(epochSeconds), "ratelimit-remaining": "0" } }),
  quotaExceeded: (reason = "quotaExceeded") => () => ({ status: 403, json: { error: { code: 403, message: "quota", errors: [{ reason }] } } }),
  silence: () => () => new Promise(() => {}),
  truncatedJson: () => () => ({ status: 200, text: '{"items":[{"id":1},{"id":', headers: { "content-type": "application/json" } }),
  slow: (ms, reply = { json: {} }) => () => new Promise((resolve) => setTimeout(() => resolve(reply), ms)),
  down: () => () => { throw new TypeError("fetch failed"); },
  status: (status, extra = {}) => () => ({ status, text: "", ...extra }),
};

/**
 * Le VRAI client réseau du cœur (`ctx.api.net`), avec un état neuf, branché sur `globalThis.fetch` (donc sur `withFakeFetch`, `blockNetwork`…).
 *   const net = await makeNetClient({ limits: { retryMinMs: 1, retryMaxMs: 5 } });  await net.request({ url: "https://…" }, { module: "mon-module" })
 * Options : `limits` (bornes, voir NET_LIMITS), `now`, `random`, `log` (défaut : rien), `fetch` (défaut : globalThis.fetch au moment de l'appel).
 */
export async function makeNetClient(opts = {}) {
  const { createNetClient } = await importCoreNet();
  return createNetClient({ log: () => {}, fetch: (u, i) => globalThis.fetch(u, i), ...opts });
}
let netModule;
async function importCoreNet() {
  if (netModule) return netModule;
  try { netModule = await import("@/core/services/net"); } catch {
    // Kit importé hors du chargeur du cœur : on l'enregistre (comme core.mjs), puis on réessaie.
    register("./alias-hooks.mjs", new URL("../tests/helpers/", import.meta.url).href);
    netModule = await import("@/core/services/net");
  }
  return netModule;
}

/** Remplace `globalThis.fetch` le temps de `fn`, puis le remet : `await withFakeFetch({ … }, async (f) => { … })`. */
export async function withFakeFetch(routes, fn) {
  const saved = globalThis.fetch;
  const f = fakeFetch(routes);
  globalThis.fetch = f;
  try { return await fn(f); } finally { globalThis.fetch = saved; }
}

/** Coupe le réseau le temps de `fn` : tout `fetch` échoue (et est noté dans `calls`). Renvoie { value, calls }. */
export async function blockNetwork(fn) {
  const saved = globalThis.fetch;
  const f = fakeFetch({});
  globalThis.fetch = f;
  try { return { value: await fn(), calls: f.calls }; } finally { globalThis.fetch = saved; }
}

/**
 * Petit serveur HTTP LOCAL (127.0.0.1, port libre) pour tester un module qui parle à une adresse : rien ne sort de la machine.
 *   const s = await startLocalServer((req) => ({ json: { ok: true } }));   // s.url → "http://127.0.0.1:54321"
 *   … await fetch(s.url + "/x") …   s.requests → [{ method, url, headers, body }]   await s.close();
 * Le gestionnaire reçoit { method, url, headers, body } et renvoie { status?, json? | text?, headers? }.
 */
export async function startLocalServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const info = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(info);
      const r = (await handler(info)) ?? {};
      const body = r.json !== undefined ? JSON.stringify(r.json) : r.text ?? "";
      res.writeHead(r.status ?? 200, { ...(r.json !== undefined ? { "content-type": "application/json" } : {}), ...(r.headers ?? {}) });
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
