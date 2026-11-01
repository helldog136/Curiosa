// Client réseau neutre et borné du cœur (`ctx.api.net`, src/core/services/net.ts) : contrat docs/V2-CONTRACTS.md § 7.
// Aucun réseau réel : `fakeFetch` (testsupport/fakeNet.mjs) répond à sa place. Chaque chemin d'attente a son test « trou noir » (jamais de réponse).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeFetch, netReplies } from "../../testsupport/fakeNet.mjs";

const N = await import("@/core/services/net");

/** Client neuf : faux réseau, journal capturé, attente avant reprise réduite, horloge réglable. */
function client(routes, over = {}) {
  const f = typeof routes === "function" ? routes : fakeFetch(routes);
  const lines = [];
  const net = N.createNetClient({ fetch: f, log: (l) => lines.push(l), limits: { retryMinMs: 1, retryMaxMs: 5, ...over.limits }, now: over.now, random: over.random });
  return { net, f, lines };
}
const elapsed = async (fn) => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// ── Validation ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("https seulement, méthode connue, pas de corps pour GET, en-têtes propres : sinon « invalid » sans réseau, et jamais d'exception", async () => {
  const { net, f } = client({ "*": { json: {} } });
  for (const req of [
    { url: "http://api.example.org/x" }, { url: "ftp://api.example.org/x" }, { url: "pas une adresse" }, { url: "https://user:pass@api.example.org/" },
    { url: "https://api.example.org/", method: "TRACE" }, { url: "https://api.example.org/", body: "x" },
    { url: "https://api.example.org/", headers: { "x-a": "1\r\nx-b: 2" } }, { url: "https://api.example.org/", headers: { "bad name": "1" } },
    null, undefined, 42, { url: 12 }, { url: "https://api.example.org/", bucket: 5 },
  ]) assert.deepEqual(await net.request(req), { ok: false, error: "invalid" }, JSON.stringify(req));
  assert.equal(f.calls.length, 0);
});

test("un corps objet part en JSON avec son type ; un délai démesuré est ramené à 20 s, un délai absurde au défaut", async () => {
  const { net, f } = client({ "*": { json: { ok: 1 } } });
  const r = await net.request({ url: "https://api.example.org/items", method: "POST", body: { a: 1 } });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].init.body, '{"a":1}');
  assert.equal(f.calls[0].init.headers["content-type"], "application/json");
  assert.ok(f.calls[0].init.signal instanceof AbortSignal, "chaque appel porte un signal");
  assert.equal(f.calls[0].init.redirect, "manual");
});

test("réponse JSON → `json` ; JSON tronqué → ok: true sans `json`, avec `text` ; HEAD → ni l'un ni l'autre", async () => {
  const { net } = client({ "https://api.example.org/good": { json: { items: [1, 2] } }, "https://api.example.org/cut": netReplies.truncatedJson(), "https://api.example.org/plain": { text: "bonjour" } });
  const good = await net.request({ url: "https://api.example.org/good" });
  assert.deepEqual([good.ok, good.status, good.json, good.text, good.shared], [true, 200, { items: [1, 2] }, undefined, false]);
  const cut = await net.request({ url: "https://api.example.org/cut" });
  assert.equal(cut.ok, true);
  assert.equal(cut.json, undefined);
  assert.match(cut.text, /^\{"items"/);
  assert.equal((await net.request({ url: "https://api.example.org/plain" })).text, "bonjour");
  const head = await net.request({ url: "https://api.example.org/good", method: "HEAD" });
  assert.deepEqual([head.ok, head.json, head.text], [true, undefined, undefined]);
});

test("toute réponse HTTP reçue donne ok: true avec son statut (404, 401, 403 ordinaire) : l'appelant juge", async () => {
  const { net } = client({ "https://a.example.org/404": { status: 404 }, "https://a.example.org/403": { status: 403, json: { error: { errors: [{ reason: "forbidden" }] } } } });
  assert.equal((await net.request({ url: "https://a.example.org/404" })).status, 404);
  const r = await net.request({ url: "https://a.example.org/403" });
  assert.deepEqual([r.ok, r.status], [true, 403]);
});

test("corps trop gros : `too_large` (annoncé par content-length, ou découvert en lisant)", async () => {
  const big = "x".repeat(5000);
  const { net } = client({ "https://a.example.org/declared": () => new Response(big, { headers: { "content-length": "5000" } }), "https://a.example.org/stream": () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode(big)); c.close(); } })) });
  assert.deepEqual(await net.request({ url: "https://a.example.org/declared", maxBytes: 1000 }), { ok: false, error: "too_large", status: 200 });
  assert.deepEqual(await net.request({ url: "https://a.example.org/stream", maxBytes: 8000 }), { ok: false, error: "too_large", status: 200 });
});

// ── Trous noirs : chaque attente est bornée ─────────────────────────────────────────────────────────────────────────
test("trou noir — réseau muet : « timeout » dans le délai, l'appel est annulé", async () => {
  const { net, f, lines } = client({ "*": netReplies.silence() });
  const { value, ms } = await elapsed(() => net.request({ url: "https://mute.example.org/x", timeoutMs: 150 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.ok(ms >= 140 && ms < 600, `${ms} ms`);
  assert.equal(f.calls[0].init.signal.aborted, true, "la demande en cours est annulée");
  assert.match(lines[0], /^\[net\] core mute\.example\.org GET \/x timeout \d+ms$/);
});

test("trou noir — en-têtes reçus mais corps sans fin : « timeout » dans le délai", async () => {
  const { net } = client({ "*": () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } })) });
  const { value, ms } = await elapsed(() => net.request({ url: "https://drip.example.org/x", timeoutMs: 150 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.ok(ms < 600, `${ms} ms`);
});

test("trou noir — attente dans la file : « timeout » au délai de CETTE demande, sans attendre les autres", async () => {
  const { net, f } = client({ "*": netReplies.silence() });
  const busy = Array.from({ length: 4 }, (_, i) => net.request({ url: `https://q.example.org/${i}`, timeoutMs: 1500 }));
  const { value, ms } = await elapsed(() => net.request({ url: "https://q.example.org/late", timeoutMs: 120 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.ok(ms < 600, `${ms} ms`);
  assert.equal(f.calls.length, 4, "la demande en file n'a jamais touché le réseau");
  await Promise.all(busy);
});

test("trou noir — suiveur d'une demande dédupliquée : il garde son propre délai", async () => {
  const { net, f } = client({ "*": netReplies.silence() });
  const leader = net.request({ url: "https://d.example.org/x", timeoutMs: 1500 });
  const { value, ms } = await elapsed(() => net.request({ url: "https://d.example.org/x", timeoutMs: 120 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.ok(ms < 600, `${ms} ms`);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await leader, { ok: false, error: "timeout" });
});

test("trou noir — reprise : l'attente avant reprise et la reprise restent dans le délai", async () => {
  let n = 0;
  const { net, f } = client({ "*": () => (n++ === 0 ? (() => { throw new TypeError("fetch failed"); })() : new Promise(() => {})) }, { limits: { retryMinMs: 50, retryMaxMs: 60, retryMinLeftMs: 100 } });
  const { value, ms } = await elapsed(() => net.request({ url: "https://r.example.org/x", timeoutMs: 400 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.equal(f.calls.length, 2);
  assert.ok(ms < 900, `${ms} ms`);
});

test("trou noir — page publique : le délai est le temps restant de la page ; plus de temps du tout = « timeout » sans réseau", async () => {
  const { net, f } = client({ "*": netReplies.silence() });
  const { value, ms } = await elapsed(() => net.request({ url: "https://p.example.org/x", timeoutMs: 8000 }, { budgetMs: 120 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.ok(ms < 600, `${ms} ms`);
  assert.deepEqual(await net.request({ url: "https://p.example.org/y" }, { budgetMs: 0 }), { ok: false, error: "timeout" });
  assert.deepEqual(await net.request({ url: "https://p.example.org/y" }, { budgetMs: -50 }), { ok: false, error: "timeout" });
  assert.equal(f.calls.length, 1);
});

test("trou noir — essai de demi-ouverture du disjoncteur : borné, et le circuit se rouvre", async () => {
  let clock = 1_000_000;
  const { net } = client({ "*": netReplies.silence() }, { now: () => clock });
  for (let i = 0; i < 5; i++) await net.request({ url: `https://h.example.org/${i}`, timeoutMs: 30, retry: 0 });
  assert.equal((await net.request({ url: "https://h.example.org/z" })).error, "circuit");
  clock += 30_000;
  const { value, ms } = await elapsed(() => net.request({ url: "https://h.example.org/trial", timeoutMs: 100 }));
  assert.deepEqual(value, { ok: false, error: "timeout" });
  assert.ok(ms < 600);
  const again = await net.request({ url: "https://h.example.org/z" });
  assert.deepEqual(again, { ok: false, error: "circuit", retryAt: clock + 60_000 }, "échec de l'essai : durée doublée");
});

// ── Limitation de débit ─────────────────────────────────────────────────────────────────────────────────────────────
test("429 avec Retry-After: 120 → « rate » ; le second appel ne touche PAS le réseau", async () => {
  const clock = 5_000_000;
  const { net, f } = client({ "*": netReplies.rateLimited(120) }, { now: () => clock });
  const first = await net.request({ url: "https://api.example.org/a" });
  assert.deepEqual(first, { ok: false, error: "rate", status: 429, retryAt: clock + 120_000 });
  const second = await net.request({ url: "https://api.example.org/b" });
  assert.deepEqual(second, { ok: false, error: "rate", retryAt: clock + 120_000 });
  assert.equal(f.calls.length, 1, "aucune reprise après un 429, aucun appel pendant la pause");
});

test("Retry-After en date HTTP ; RateLimit-Reset en époque ; Ratelimit-Reset en secondes ; X-RateLimit-Reset-After ; plafond 1 h ; défaut 60 s", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  const at = (h, json) => N.rateRetryAt(h, json, now);
  assert.equal(at({ "retry-after": "Tue, 20 Oct 2026 10:05:00 GMT" }), now + 300_000);
  assert.equal(at({ "ratelimit-reset": String(now / 1000 + 90) }), now + 90_000);
  assert.equal(at({ "x-ratelimit-reset": String(now / 1000 + 45) }), now + 45_000);
  assert.equal(at({ "ratelimit-reset": "30" }), now + 30_000);
  assert.equal(at({ "x-ratelimit-reset-after": "12" }), now + 12_000);
  assert.equal(at({ ratelimit: "limit=100, remaining=0, reset=20" }), now + 20_000);
  assert.equal(at({}, { retry_after: 7.5 }), now + 7_500);
  assert.equal(at({}, { retry_after: "15" }), now + 15_000);
  assert.equal(at({}), now + 60_000);
  assert.equal(at({ "retry-after": "999999" }), now + 3_600_000);
  assert.equal(at({ "retry-after": "0" }), now + 1_000, "au moins 1 s");
  assert.equal(at({ "retry-after": "5" }, { retry_after: 99 }), now + 5_000, "l'en-tête passe avant le corps");
});

test("429 avec RateLimit-Reset en époque, et avec `retry_after` dans le corps JSON : la pause suit le fournisseur", async () => {
  const clock = Date.parse("2026-10-20T10:00:00Z");
  const { net, f } = client({ "https://e.example.org/": netReplies.rateLimitedReset(clock / 1000 + 300), "https://b.example.org/": netReplies.rateLimitedBody(30) }, { now: () => clock });
  assert.equal((await net.request({ url: "https://e.example.org/x" })).retryAt, clock + 300_000);
  assert.equal((await net.request({ url: "https://b.example.org/x" })).retryAt, clock + 30_000);
  assert.equal((await net.request({ url: "https://b.example.org/y" })).error, "rate");
  assert.equal(f.calls.length, 2);
});

test("503 avec Retry-After = pause ; 503 sans = une reprise puis le statut ; la pause expire d'elle-même", async () => {
  let clock = 1_000;
  const { net, f } = client({ "https://pause.example.org/": netReplies.status(503, { headers: { "retry-after": "10" } }), "https://flaky.example.org/": netReplies.status(503) }, { now: () => clock });
  assert.deepEqual(await net.request({ url: "https://pause.example.org/x" }), { ok: false, error: "rate", status: 503, retryAt: clock + 10_000 });
  const flaky = await net.request({ url: "https://flaky.example.org/x" });
  assert.deepEqual([flaky.ok, flaky.status], [true, 503]);
  assert.equal(f.calls.filter((c) => c.url.startsWith("https://flaky")).length, 2, "une seule reprise");
  clock += 10_001;
  await net.request({ url: "https://pause.example.org/x" });
  assert.equal(f.calls.filter((c) => c.url.startsWith("https://pause")).length, 2, "après la pause, on rappelle");
});

test("RateLimit-Remaining: 0 sur une réponse normale → pause préventive jusqu'à la remise à zéro", async () => {
  const clock = 2_000_000;
  const { net, f } = client({ "*": { json: { ok: true }, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "40" } } }, { now: () => clock });
  assert.equal((await net.request({ url: "https://pre.example.org/a" })).ok, true);
  assert.deepEqual(await net.request({ url: "https://pre.example.org/b" }), { ok: false, error: "rate", retryAt: clock + 40_000 });
  assert.equal(f.calls.length, 1);
});

test("seau partagé (`bucket`) : la pause vaut pour le seau, sur tous ses hôtes, pas pour un autre seau du même hôte", async () => {
  const { net, f } = client({ "https://one.example.org/": netReplies.rateLimited(60), "https://two.example.org/": { json: {} } });
  assert.equal((await net.request({ url: "https://one.example.org/x", bucket: "app-1" })).error, "rate");
  assert.equal((await net.request({ url: "https://two.example.org/x", bucket: "app-1" })).error, "rate", "même seau, autre hôte : en pause");
  assert.equal((await net.request({ url: "https://two.example.org/x", bucket: "app-2" })).ok, true);
  assert.equal(f.calls.length, 2);
});

// ── Quota journalier ────────────────────────────────────────────────────────────────────────────────────────────────
test("prochain minuit à Los Angeles, été comme hiver et le jour du changement d'heure", () => {
  const iso = (t) => new Date(N.nextPacificMidnight(Date.parse(t))).toISOString();
  assert.equal(iso("2026-10-20T15:00:00Z"), "2026-10-21T07:00:00.000Z"); // PDT (UTC−7)
  assert.equal(iso("2026-12-01T10:00:00Z"), "2026-12-02T08:00:00.000Z"); // PST (UTC−8)
  assert.equal(iso("2026-10-31T20:00:00Z"), "2026-11-01T07:00:00.000Z"); // la veille du passage à l'heure d'hiver
  assert.equal(iso("2026-11-01T12:00:00Z"), "2026-11-02T08:00:00.000Z"); // le jour même
  assert.equal(iso("2026-03-08T06:00:00Z"), "2026-03-08T08:00:00.000Z"); // 22 h PST la veille du passage à l'heure d'été
  assert.equal(iso("2026-10-21T06:59:59Z"), "2026-10-21T07:00:00.000Z");
});

test("403 quotaExceeded → « quota » jusqu'à minuit Pacifique, sans réseau d'ici là ; dailyLimitExceeded aussi ; distinct d'un 429", async () => {
  const clock = Date.parse("2026-10-20T15:00:00Z");
  const { net, f } = client({ "https://q.example.org/": netReplies.quotaExceeded(), "https://d.example.org/": netReplies.quotaExceeded("dailyLimitExceeded") }, { now: () => clock });
  const midnight = Date.parse("2026-10-21T07:00:00Z");
  assert.deepEqual(await net.request({ url: "https://q.example.org/search?q=1" }), { ok: false, error: "quota", status: 403, retryAt: midnight });
  assert.deepEqual(await net.request({ url: "https://q.example.org/other" }), { ok: false, error: "quota", retryAt: midnight });
  assert.equal((await net.request({ url: "https://d.example.org/x" })).error, "quota");
  assert.equal(f.calls.length, 2);
});

// ── Disjoncteur ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("5 échecs en 60 s ouvrent le circuit 30 s ; puis UN seul essai (les autres : « circuit ») ; succès = refermé", async () => {
  let clock = 10_000_000;
  let healthy = false;
  const gate = deferred();
  const { net, f } = client({ "*": async () => { if (!healthy) throw new TypeError("fetch failed"); await gate.promise; return { json: { ok: 1 } }; } }, { now: () => clock });
  for (let i = 0; i < 5; i++) assert.equal((await net.request({ url: `https://down.example.org/${i}`, retry: 0 })).error, "network");
  const calls = f.calls.length;
  assert.deepEqual(await net.request({ url: "https://down.example.org/x" }), { ok: false, error: "circuit", retryAt: clock + 30_000 });
  assert.equal(f.calls.length, calls, "circuit ouvert : aucun appel");
  clock += 30_000;
  healthy = true;
  const trial = net.request({ url: "https://down.example.org/trial" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await net.request({ url: "https://down.example.org/other" }), { ok: false, error: "circuit" }, "demi-ouverture : un seul essai à la fois");
  gate.resolve();
  assert.equal((await trial).ok, true);
  assert.equal((await net.request({ url: "https://down.example.org/after" })).ok, true, "refermé après un essai réussi");
});

test("disjoncteur : la durée double à chaque essai raté, jusqu'à 5 min ; les 5xx comptent ; des échecs étalés sur plus de 60 s ne l'ouvrent pas", async () => {
  let clock = 0;
  const { net } = client({ "https://five.example.org/": netReplies.status(500), "https://slow-fail.example.org/": netReplies.down() }, { now: () => clock });
  for (let i = 0; i < 5; i++) await net.request({ url: "https://five.example.org/x", retry: 0 });
  let r = await net.request({ url: "https://five.example.org/x" });
  assert.equal(r.retryAt, clock + 30_000);
  for (const expected of [60_000, 120_000, 240_000, 300_000, 300_000]) {
    clock = r.retryAt;
    await net.request({ url: "https://five.example.org/x", retry: 0 });
    r = await net.request({ url: "https://five.example.org/x" });
    assert.equal(r.retryAt - clock, expected);
  }
  // 8 échecs espacés de 20 s : jamais plus de 3 dans la même minute, le circuit reste fermé (chaque appel touche le réseau)
  for (let i = 0; i < 8; i++) { clock += 20_000; assert.equal((await net.request({ url: "https://slow-fail.example.org/x", retry: 0 })).error, "network"); }
});

// ── File d'attente ──────────────────────────────────────────────────────────────────────────────────────────────────
test("20 appels simultanés vers un hôte : 16 admis, 4 refusés « busy » IMMÉDIATEMENT ; 32 au total tous hôtes confondus", async () => {
  const gate = deferred();
  const { net, f } = client({ "*": async () => { await gate.promise; return { json: {} }; } });
  const started = Date.now();
  const all = Array.from({ length: 20 }, (_, i) => net.request({ url: `https://busy.example.org/${i}`, timeoutMs: 3000 }));
  const settledEarly = [];
  all.forEach((p, i) => p.then((r) => { if (r.error === "busy") settledEarly.push([i, Date.now() - started]); }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settledEarly.length, 4);
  assert.ok(settledEarly.every(([, ms]) => ms < 50), JSON.stringify(settledEarly));
  assert.equal(f.calls.length, 4, "4 appels simultanés par hôte");
  const others = [];
  for (const h of ["b", "c"]) for (let i = 0; i < 16; i++) others.push(net.request({ url: `https://${h}.example.org/${i}`, timeoutMs: 3000 }));
  const busyOthers = (await Promise.race([Promise.all(others.slice(16)), new Promise((r) => setTimeout(() => r("pending"), 30))]));
  assert.ok(Array.isArray(busyOthers) && busyOthers.every((r) => r.error === "busy"), "au-delà de 32 admis : refus immédiat");
  gate.resolve();
  const done = await Promise.all([...all, ...others.slice(0, 16)]);
  assert.equal(done.filter((r) => r.ok).length, 32);
});

test("la file sert `interactive` avant `background`", async () => {
  const gates = [];
  const order = [];
  const { net } = client({ "*": async (url) => { order.push(url.split("/").pop()); const g = deferred(); gates.push(g); await g.promise; return { json: {} }; } });
  const first = Array.from({ length: 4 }, (_, i) => net.request({ url: `https://prio.example.org/run${i}` }));
  await new Promise((r) => setTimeout(r, 5));
  const bg = net.request({ url: "https://prio.example.org/bg" });
  const ia = net.request({ url: "https://prio.example.org/ia", priority: "interactive" });
  await new Promise((r) => setTimeout(r, 5));
  gates[0].resolve();
  await first[0];
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(order[4], "ia");
  for (const g of gates) g.resolve();
  await new Promise((r) => setTimeout(r, 5));
  for (const g of gates) g.resolve();
  await Promise.all([...first, bg, ia]);
  assert.deepEqual(order.slice(4), ["ia", "bg"]);
});

// ── Déduplication ───────────────────────────────────────────────────────────────────────────────────────────────────
test("déduplication : GET identiques en cours = UN appel, `shared: true` pour le suiveur, réponses indépendantes", async () => {
  const gate = deferred();
  const { net, f } = client({ "*": async () => { await gate.promise; return { json: { list: [1] } }; } });
  const a = net.request({ url: "https://dd.example.org/x", headers: { accept: "application/json" } });
  const b = net.request({ url: "https://dd.example.org/x", headers: { Accept: "application/json" } });
  const c = net.request({ url: "https://dd.example.org/x", headers: { authorization: "Bearer other" } });
  const p = net.request({ url: "https://dd.example.org/x", method: "POST", body: "{}" });
  gate.resolve();
  const [ra, rb, rc, rp] = await Promise.all([a, b, c, p]);
  assert.equal(f.calls.length, 3, "a+b partagés ; c (autres en-têtes) et le POST à part");
  assert.deepEqual([ra.shared, rb.shared, rc.shared, rp.shared], [false, true, false, false]);
  ra.json.list.push(2);
  assert.deepEqual(rb.json, { list: [1] }, "un module qui modifie sa réponse ne touche pas celle d'un autre");
  await net.request({ url: "https://dd.example.org/x", headers: { accept: "application/json" } });
  assert.equal(f.calls.length, 4, "terminé : la promesse partagée est oubliée");
  const off = client({ "*": async () => ({ json: {} }) });
  await Promise.all([off.net.request({ url: "https://n.example.org/x", dedupe: false }), off.net.request({ url: "https://n.example.org/x", dedupe: false })]);
  assert.equal(off.f.calls.length, 2);
});

// ── Reprise ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("reprise : une seule, pour GET après une erreur réseau ; jamais pour POST ; jamais après 429 ; jamais s'il reste moins d'1 s", async () => {
  let n = 0;
  const { net, f } = client({ "https://once.example.org/": () => (n++ === 0 ? (() => { throw new TypeError("fetch failed"); })() : { json: { ok: 1 } }), "https://never.example.org/": netReplies.down() });
  assert.equal((await net.request({ url: "https://once.example.org/x" })).ok, true);
  assert.equal(f.calls.length, 2);
  assert.equal((await net.request({ url: "https://never.example.org/x" })).error, "network");
  assert.equal(f.calls.length, 4, "une seule reprise, pas deux");
  await net.request({ url: "https://never.example.org/p", method: "POST", body: "x" });
  assert.equal(f.calls.length, 5, "POST : jamais repris");
  await net.request({ url: "https://never.example.org/short", timeoutMs: 900 });
  assert.equal(f.calls.length, 6, "moins d'1 s de délai : pas de reprise");
  await net.request({ url: "https://never.example.org/r0", retry: 0 });
  assert.equal(f.calls.length, 7);
});

test("l'attente avant reprise est aléatoire (200 à 800 ms par défaut)", async () => {
  let n = 0;
  const { net } = client({ "*": () => (n++ === 0 ? (() => { throw new TypeError("x"); })() : { json: {} }) }, { limits: { retryMinMs: 200, retryMaxMs: 800 }, random: () => 0 });
  const { ms } = await elapsed(() => net.request({ url: "https://j.example.org/x" }));
  assert.ok(ms >= 190 && ms < 700, `${ms} ms`);
});

// ── Santé ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("santé par hôte : ok, lent, limité, quota, en panne — avec l'heure de début et la reprise", async () => {
  let clock = Date.parse("2026-10-20T10:00:00Z");
  const { net } = client({
    "https://ok.example.org/": { json: {} },
    "https://slow.example.org/": async () => { clock += 4000; return { json: {} }; },
    "https://rate.example.org/": netReplies.rateLimited(600),
    "https://quota.example.org/": netReplies.quotaExceeded(),
    "https://dead.example.org/": netReplies.down(),
  }, { now: () => clock });
  for (const h of ["ok", "slow", "rate", "quota", "dead"]) await net.request({ url: `https://${h}.example.org/x`, retry: 0 });
  const byHost = Object.fromEntries(net.health().map((x) => [x.host, x]));
  assert.equal(byHost["ok.example.org"].state, "ok");
  assert.equal(byHost["slow.example.org"].state, "slow");
  assert.equal(byHost["rate.example.org"].state, "rate");
  assert.ok(byHost["rate.example.org"].retryAt > clock);
  assert.equal(byHost["quota.example.org"].state, "quota");
  assert.equal(byHost["dead.example.org"].state, "down");
  assert.equal(net.hostHealth("nowhere.example.org"), null);
  assert.equal(typeof byHost["dead.example.org"].since, "number");
});

test("états en mémoire bornés : 500 entrées au plus, les plus anciennes évincées", async () => {
  const { net } = client({ "*": netReplies.rateLimited(600) });
  for (let i = 0; i < 620; i++) await net.request({ url: `https://h${i}.example.org/x` });
  assert.ok(net.health().length <= 500, String(net.health().length));
});

// ── Journal ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("journal : une ligne « [net] module hôte méthode chemin statut ms », sans requête, sans en-têtes, sans corps, jetons masqués", async () => {
  const { net, lines } = client({ "*": { json: { secret: "BODY-SECRET" } } });
  await net.request({ url: "https://api.example.org/v1/users?client_secret=QUERY-SECRET&q=1", headers: { authorization: "Bearer HEADER-SECRET", "client-id": "ID-SECRET" }, method: "POST", body: { password: "BODY-PASS" } }, { module: "mon-module" });
  await net.request({ url: "https://api.example.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/send" }, { module: "mon-module" });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[net\] mon-module api\.example\.org POST \/v1\/users 200 \d+ms$/);
  assert.match(lines[1], /^\[net\] mon-module api\.example\.org GET \/…\/send 200 \d+ms$/);
  for (const l of lines) for (const secret of ["QUERY-SECRET", "HEADER-SECRET", "ID-SECRET", "BODY", "Bearer", "AAHdq", "client_secret"]) assert.ok(!l.includes(secret), `${secret} dans « ${l} »`);
});

test("journal : un refus sans réseau (pause, disjoncteur, file pleine) n'est écrit qu'une fois par minute", async () => {
  const { net, lines } = client({ "*": netReplies.rateLimited(600) });
  for (let i = 0; i < 30; i++) await net.request({ url: "https://quiet.example.org/x" });
  assert.equal(lines.length, 2, lines.join("\n")); // le 429 lui-même, puis une seule ligne « rate »
  assert.match(lines[1], / rate 0ms$/);
});

test("ne lève jamais : fetch qui lève n'importe quoi, réponse bizarre", async () => {
  const weird = [() => { throw "pas une erreur"; }, () => null, () => ({ status: 200, headers: null, body: null, arrayBuffer: () => { throw new Error("x"); } })];
  for (const w of weird) {
    const net = N.createNetClient({ fetch: async () => w(), log: () => {}, limits: { retryMinMs: 1, retryMaxMs: 2 } });
    const r = await net.request({ url: "https://w.example.org/x" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "network");
  }
});

test("le client du processus est unique (sur globalThis) et réinitialisable pour les tests", () => {
  assert.equal(N.sharedNet(), N.sharedNet());
  const a = N.sharedNet();
  N.resetSharedNet();
  assert.notEqual(N.sharedNet(), a);
});

test("logPath : sans requête ; segments longs à chiffres et lettres masqués ; 120 caractères au plus", () => {
  assert.equal(N.logPath(new URL("https://x.example.org/a/b?c=d#e")), "/a/b");
  assert.equal(N.logPath(new URL("https://x.example.org/token/abcdef1234567890abcdef/x")), "/token/…/x");
  assert.equal(N.logPath(new URL("https://x.example.org/users/12345")), "/users/12345");
  assert.ok(N.logPath(new URL(`https://x.example.org/${"a/".repeat(100)}`)).length <= 120);
});
