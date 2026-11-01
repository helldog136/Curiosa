// Contrôle du contenu — les garde-fous des visites : le cœur ne doit jamais servir à sonder le réseau interne ni à attaquer un autre site.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { clock, makeNet, publicDns } from "../helpers/content-check-kit.mjs";

const { hostProblem, addressIsPrivate, isSafeExternalUrl } = await import("@/core/url");
const { probeLink, MAX_REDIRECTS } = await import("@/core/maintenance/content/probe");
const { createPinnedFetch, pinnedLookup, resolveHost, createContentNet } = await import("@/core/maintenance/content/net");
const { createNetClient } = await import("@/core/services/net");

const deps = (net, extra = {}) => ({ net: net.client, pins: net.pins, resolve: publicDns, dnsCache: new Map(), siteUrl: "https://monsite.example.org", ...extra });
const probe = async (url, routes, extra = {}, netOpts) => {
  const net = makeNet(routes, netOpts);
  const result = await probeLink(url, deps(net, extra));
  return { result, calls: net.calls, net };
};

test("adresses refusées d'avance : numériques (toutes écritures), noms internes, ports exotiques, identifiants dans l'adresse", () => {
  const refused = [
    "https://127.0.0.1/", "https://10.0.0.5/x", "https://192.168.1.1/", "https://169.254.169.254/latest/meta-data", "https://2130706433/", "https://0x7f000001/", "https://017700000001/", "https://127.1/",
    "https://[::1]/", "https://[fe80::1]/", "https://[::ffff:127.0.0.1]/", "https://localhost/", "https://intranet/", "https://printer.local/", "https://nas.lan/", "https://db.internal/", "https://x.home.arpa/",
    "https://example.org:8443/", "https://example.org:22/", "https://user:pass@example.org/", "ftp://example.org/", "https://app.localhost/",
  ];
  for (const u of refused) assert.notEqual(hostProblem(new URL(u)), null, `${u} doit être refusée`);
  for (const u of ["https://example.org/", "https://www.example.org:443/x?y=1", "https://sub.domaine.example.org/", "http://example.org/", "https://xn--bcher-kva.example/"]) assert.equal(hostProblem(new URL(u)), null, `${u} peut être visitée`);
  assert.equal(hostProblem("pas une adresse"), "invalid");
});

test("garde du cœur complétée : isSafeExternalUrl (liens affichés) reste inchangé ; la règle des visites sortantes est une fonction à part", () => {
  assert.equal(isSafeExternalUrl("https://example.org"), true);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("https://127.0.0.1/"), true, "un lien AFFICHÉ vers une IP reste permis : seule une VISITE du serveur est refusée");
  assert.equal(hostProblem("https://127.0.0.1/"), "address");
});

test("une adresse numérique issue de la résolution d'un nom : privée, locale, réservée → refusée ; publique → permise", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "pas-une-adresse"]) {
    assert.equal(addressIsPrivate(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111", "100.63.255.255"]) assert.equal(addressIsPrivate(ip), false, ip);
});

test("un nom qui mène (même en partie) vers une adresse privée n'est JAMAIS contacté", async () => {
  const { result, calls } = await probe("https://innocent.example.org/page", { "*": { status: 200 } }, { resolve: async () => ({ ok: true, addresses: ["93.184.216.34", "10.0.0.7"] }) });
  assert.deepEqual([result.st, result.why], ["refused", "private"]);
  assert.equal(calls.length, 0, "aucune demande n'est partie");
});

test("les adresses internes ne partent pas : aucune demande réseau, ni même de résolution de nom", async () => {
  for (const u of ["https://localhost/", "https://127.0.0.1/", "https://[::1]/x", "https://example.org:8443/", "https://u:p@example.org/", "https://intranet/", "https://2130706433/"]) {
    let resolved = 0;
    const { result, calls } = await probe(u, { "*": { status: 200 } }, { resolve: async () => { resolved++; return { ok: true, addresses: ["93.184.216.34"] }; } });
    assert.equal(result.st, "refused", u);
    assert.equal(calls.length, 0, u);
    assert.equal(resolved, 0, `${u} : pas de résolution`);
  }
});

test("rebinding : le nom est résolu UNE fois, la connexion ne va qu'aux adresses vérifiées, et la table est vidée ensuite", async () => {
  let asked = 0;
  // Une seconde réponse serait privée : si le code résolvait deux fois, il la verrait.
  const resolve = async () => { asked++; return asked === 1 ? { ok: true, addresses: ["93.184.216.34"] } : { ok: true, addresses: ["10.0.0.1"] }; };
  const { result, calls, net } = await probe("https://rebind.example.org/a", { "*": (u, init) => (init.method === "HEAD" ? { status: 405 } : { status: 200 }) }, { resolve });
  assert.equal(result.st, "ok");
  assert.equal(asked, 1, "une seule résolution pour HEAD puis GET");
  assert.deepEqual(calls.map((c) => c.method), ["HEAD", "GET"]);
  for (const c of calls) assert.deepEqual(c.pinned, ["93.184.216.34"], "adresse vérifiée posée au moment de la connexion");
  assert.equal(net.pins.size, 0, "plus rien de posé après la visite");
});

test("la connexion elle-même est fermée à tout autre nom ou adresse : sans adresse vérifiée, la visite échoue (fail closed) ; la fonction lookup ne rend que les adresses vérifiées", async () => {
  const pins = new Map();
  const f = createPinnedFetch(pins);
  await assert.rejects(f("https://pas-verifie.example.org/", { method: "HEAD" }), /no verified address/);
  pins.set("prive.example.org", ["10.0.0.9"]);
  await assert.rejects(f("https://prive.example.org/", { method: "HEAD" }), /no verified address/, "même posée, une adresse privée est refusée");
  const rep = await new Promise((r) => pinnedLookup(["93.184.216.34", "10.0.0.1", "2606:4700:4700::1111"])("n'importe-quoi.example.org", { all: true }, (e, a) => r({ e, a })));
  assert.deepEqual(rep.a.map((x) => x.address), ["93.184.216.34", "2606:4700:4700::1111"], "l'adresse privée est écartée, le nom demandé n'a aucune importance");
  const one = await new Promise((r) => pinnedLookup(["93.184.216.34"])("x.example.org", {}, (e, a, fam) => r({ e, a, fam })));
  assert.deepEqual([one.a, one.fam], ["93.184.216.34", 4]);
  const none = await new Promise((r) => pinnedLookup(["10.0.0.1"])("x.example.org", {}, (e) => r(e)));
  assert.equal(none.code, "ENOTFOUND");
});

test("connexion réelle (serveur local de test) : HEAD sans corps, GET lu au plus 2 Ko, redirection non suivie, 429 lu — par le vrai client réseau", async () => {
  const big = "x".repeat(50_000);
  const server = http.createServer((req, res) => {
    if (req.url === "/head") { res.writeHead(200); res.end(); return; }
    if (req.url === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.end(big); return; }
    if (req.url === "/go") { res.writeHead(301, { location: "https://autre.example.org/" }); res.end(); return; }
    if (req.url === "/slow") { res.writeHead(429, { "retry-after": "120" }); res.end("trop"); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const pins = new Map([["verifie.example.org", ["127.0.0.1"]]]);
    const client = createNetClient({ fetch: createPinnedFetch(pins, { transport: http, port, allowPrivate: true }), log: () => {} });
    const url = (p) => `https://verifie.example.org${p}`;
    const head = await client.request({ url: url("/head"), method: "HEAD", retry: 0, dedupe: false });
    assert.deepEqual([head.ok, head.status], [true, 200]);
    const bigGet = await client.request({ url: url("/big"), method: "GET", maxBytes: 2048, retry: 0, dedupe: false });
    assert.deepEqual([bigGet.ok, bigGet.error, bigGet.status], [false, "too_large", 200], "au-delà de 2 Ko : on s'arrête, on garde le code");
    const moved = await client.request({ url: url("/go"), method: "HEAD", retry: 0, dedupe: false });
    assert.deepEqual([moved.ok, moved.status, moved.headers.location], [true, 301, "https://autre.example.org/"], "la redirection n'est PAS suivie par le transport");
    const limited = await client.request({ url: url("/slow"), method: "GET", retry: 0, dedupe: false });
    assert.deepEqual([limited.ok, limited.error], [false, "rate"]);
    const again = await client.request({ url: url("/head"), method: "HEAD", retry: 0, dedupe: false });
    assert.equal(again.error, "rate", "pendant la pause, plus aucune demande ne part");
    // Un autre nom que celui de la table : la connexion n'est même pas tentée.
    const other = await client.request({ url: "https://autre.example.org/head", method: "HEAD", retry: 0, dedupe: false });
    assert.equal(other.ok, false);
  } finally { server.close(); }
});

test("une redirection vers une adresse interne est refusée, sans contacter la destination ; une destination http n'est pas visitée", async () => {
  const { result, calls } = await probe("https://example.org/a", { "https://example.org/a": { status: 302, headers: { location: "https://169.254.169.254/latest" } }, "*": { status: 200 } });
  assert.deepEqual([result.st, result.why], ["refused", "redirect_address"]);
  assert.deepEqual(calls.map((c) => c.url), ["https://example.org/a"], "seule la première adresse a été visitée");
  for (const [location, why] of [["https://localhost/x", "redirect_internal"], ["https://example.org:8443/x", "redirect_port"], ["https://u:p@example.org/x", "redirect_credentials"], ["https://2130706433/", "redirect_address"]]) {
    const r = await probe("https://example.org/a", { "https://example.org/a": { status: 302, headers: { location } }, "*": { status: 200 } });
    assert.deepEqual([r.result.st, r.result.why], ["refused", why], location);
    assert.equal(r.calls.length, 1, location);
  }
  const insecure = await probe("https://example.org/a", { "https://example.org/a": { status: 302, headers: { location: "http://example.org/b" } } });
  assert.deepEqual([insecure.result.st, insecure.result.why], ["unverified", "insecure"]);
  assert.equal(insecure.calls.length, 1);
});

test("redirection vers un nom qui se résout vers une adresse privée : refusée à CETTE étape (chaque étape est revalidée)", async () => {
  const resolve = async (host) => (host === "piege.example.org" ? { ok: true, addresses: ["192.168.1.20"] } : { ok: true, addresses: ["93.184.216.34"] });
  const { result, calls } = await probe("https://example.org/a", { "https://example.org/a": { status: 302, headers: { location: "https://piege.example.org/x" } }, "*": { status: 200 } }, { resolve });
  assert.deepEqual([result.st, result.why], ["refused", "redirect_private"]);
  assert.equal(calls.length, 1);
});

test("boucle de redirections, chaîne trop longue : 5 renvois au plus, puis « tourne en rond »", async () => {
  const chain = {};
  for (let i = 0; i < 12; i++) chain[`https://example.org/r${i}`] = { status: 302, headers: { location: `https://example.org/r${i + 1}` } };
  const long = await probe("https://example.org/r0", chain);
  assert.equal(long.result.st, "loop");
  assert.equal(long.calls.length, MAX_REDIRECTS + 1, "1 + 5 renvois, pas un de plus");
  const circle = await probe("https://example.org/a", { "https://example.org/a": { status: 301, headers: { location: "https://example.org/b" } }, "https://example.org/b": { status: 301, headers: { location: "https://example.org/a" } } });
  assert.equal(circle.result.st, "loop");
  assert.equal(circle.calls.length, 2, "la boucle est vue dès le retour");
});

test("redirection permanente vers un autre endroit = « a changé d'adresse » ; www, barre finale ou renvoi temporaire = rien à dire", async () => {
  const moved = await probe("https://old.example.org/page", { "https://old.example.org/page": { status: 301, headers: { location: "https://new.example.org/page" } }, "*": { status: 200 } });
  assert.deepEqual([moved.result.st, moved.result.to], ["moved", "https://new.example.org/page"]);
  const trivial = await probe("https://example.org/page", { "https://example.org/page": { status: 301, headers: { location: "https://www.example.org/page/" } }, "*": { status: 200 } });
  assert.equal(trivial.result.st, "ok");
  const temp = await probe("https://example.org/page", { "https://example.org/page": { status: 302, headers: { location: "https://other.example.org/x" } }, "*": { status: 200 } });
  assert.equal(temp.result.st, "ok");
});

test("HEAD d'abord, puis un GET de 2 Ko seulement si le site ne sait pas répondre à HEAD ; jamais de téléchargement complet", async () => {
  const fine = await probe("https://example.org/p", { "https://example.org/p": { status: 200 } });
  assert.deepEqual(fine.calls.map((c) => c.method), ["HEAD"], "HEAD suffit quand il répond");
  const get = await probe("https://example.org/p", { "https://example.org/p": (url, init) => (init.method === "HEAD" ? { status: 405 } : { status: 200, text: "x".repeat(50_000) }) });
  assert.equal(get.result.st, "ok");
  assert.deepEqual(get.calls.map((c) => c.method), ["HEAD", "GET"]);
});

test("404 (même après GET) = « n'existe plus » ; 500 = « ne répond pas bien » ; panne = « ne répond pas » ; 403/451 = « refuse les visites »", async () => {
  assert.deepEqual((await probe("https://example.org/x", { "*": { status: 404 } })).result, { st: "gone", code: 404 });
  assert.deepEqual((await probe("https://example.org/x", { "*": { status: 410 } })).result, { st: "gone", code: 410 });
  const head404 = await probe("https://example.org/x", { "https://example.org/x": (u, init) => (init.method === "HEAD" ? { status: 404 } : { status: 200 }) });
  assert.equal(head404.result.st, "ok", "404 à HEAD mais 200 à GET : le site est vivant");
  assert.deepEqual((await probe("https://example.org/x", { "*": { status: 503 } })).result, { st: "down", why: "server", code: 503 });
  assert.deepEqual((await probe("https://example.org/x", { "*": "down" })).result, { st: "down", why: "network" });
  for (const code of [401, 403, 406, 451]) assert.equal((await probe("https://example.org/x", { "*": { status: code } })).result.st, "blocked", String(code));
});

test("nom qui n'existe pas = lien mort ; DNS qui ne répond pas = on ne conclut pas", async () => {
  const gone = await probe("https://nexistepas.example.org/", { "*": { status: 200 } }, { resolve: async () => ({ ok: false, reason: "notfound" }) });
  assert.deepEqual([gone.result.st, gone.result.why, gone.calls.length], ["down", "dns", 0]);
  const slow = await probe("https://example.org/", { "*": { status: 200 } }, { resolve: async () => ({ ok: false, reason: "timeout" }) });
  assert.deepEqual([slow.result.st, slow.result.why, slow.calls.length], ["unverified", "dns", 0]);
});

test("429 « trop de demandes » : le site est mis en pause, les demandes suivantes ne partent pas", async () => {
  const net = makeNet({ "*": { status: 429, headers: { "retry-after": "120" } } });
  const d = deps(net);
  const r1 = await probeLink("https://example.org/a", d);
  const before = net.calls.length;
  const r2 = await probeLink("https://example.org/b", d);
  assert.equal(r1.st, "paused");
  assert.equal(r2.st, "paused");
  assert.equal(net.calls.length - before, 0, "aucune demande pendant la pause");
  assert.ok(r1.retryAt > Date.now());
});

test("une adresse sans « s » est vérifiée en https ; si le site ne répond pas ainsi, on ne conclut jamais « cassé »", async () => {
  const ok = await probe("http://example.org/a", { "https://example.org/a": { status: 200 } });
  assert.deepEqual(ok.result, { st: "ok", insecure: true });
  assert.ok(ok.calls.every((c) => c.url.startsWith("https://")));
  const dead = await probe("http://example.org/a", { "*": "down" });
  assert.deepEqual([dead.result.st, dead.result.why], ["unverified", "insecure"]);
  assert.equal((await probe("http://example.org/a", { "*": { status: 404 } })).result.st, "unverified");
});

test("« trou noir » : un site qui ne répond jamais ne bloque pas la vérification (délai dur par lien)", async () => {
  const t0 = Date.now();
  const { result } = await probe("https://example.org/slow", { "*": "silence" }, { linkBudgetMs: 700 });
  assert.deepEqual([result.st, result.why], ["down", "timeout"]);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  // Le DNS aussi : une résolution qui ne vient jamais est coupée.
  const t1 = Date.now();
  const dns = await resolveHost("trou-noir.invalid");
  assert.equal(dns.ok, false);
  assert.ok(Date.now() - t1 < 5000);
});

test("chaque visite se présente (programme et adresse du site) et n'envoie ni cookie ni identifiant", async () => {
  const seen = [];
  await probe("https://example.org/p", { "https://example.org/p": (url, init) => { seen.push(init.headers); return { status: 200 }; } });
  assert.match(seen[0]["user-agent"], /LinkCheck\/1\.0.*monsite\.example\.org/);
  assert.ok(!("cookie" in seen[0]) && !("authorization" in seen[0]));
});

test("le code de visite n'appelle jamais fetch lui-même, n'a ni minuteur répétitif ni tâche de fond ; le client dédié a son propre état", () => {
  const dir = "src/core/maintenance/content";
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = fs.readFileSync(`${dir}/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(/.test(src.replace(/doFetch/g, "")), `${f} : pas de fetch direct`);
    assert.ok(!/setInterval/.test(src), `${f} : pas de minuteur répétitif`);
    assert.ok(!/scheduler|registerTask|cron/i.test(src), `${f} : pas de tâche planifiée`);
  }
  const a = createContentNet(), b = createContentNet();
  assert.notEqual(a.client, b.client);
  assert.notEqual(a.pins, b.pins);
});

test("temps simulé : l'outil de test ne fait jamais attendre pour de vrai", async () => {
  const c = clock();
  const t0 = Date.now();
  await c.sleep(60_000);
  assert.equal(c.at() - 1_700_000_000_000, 60_000);
  assert.ok(Date.now() - t0 < 1000);
});
