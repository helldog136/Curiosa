// Aides réseau pour tester un module SANS réseau : faux fetch, blocage du réseau, petit serveur local. API publique du kit (voir docs/TESTSUPPORT.md).
import http from "node:http";

/**
 * Faux `fetch` : `routes` associe une adresse (ou un motif RegExp) à une réponse.
 *   const f = fakeFetch({ "https://api.example.org/v1/stats": { json: { followers: 12 } }, "https://api.example.org/down": { status: 503 } });
 *   f.calls   → [{ url, init }…]
 * Une réponse peut être : { json, status?, headers? } · { text, status? } · { status } · une Response · une fonction (url, init) => l'un de ces cas.
 * Une adresse inconnue échoue comme un réseau coupé (TypeError « fetch failed »).
 */
export function fakeFetch(routes = {}) {
  const calls = [];
  const entries = Object.entries(routes);
  const fn = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    calls.push({ url, init });
    const hit = entries.find(([k]) => k === url || (k.startsWith("/") && k.endsWith("/") && new RegExp(k.slice(1, -1)).test(url))) ?? entries.find(([k]) => url.startsWith(k));
    if (!hit) throw new TypeError("fetch failed");
    let r = hit[1];
    if (typeof r === "function") r = await r(url, init);
    if (r instanceof Response) return r;
    if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
    return new Response(r.text ?? "", { status: r.status ?? 200, headers: r.headers });
  };
  fn.calls = calls;
  return fn;
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
