// Adresse du site : validation de la saisie, anciens domaines (LEGACY_HOSTS) et redirection permanente 301. Aucune redirection ouverte, aucun en-tête de confiance
// autre que Host (posé par NOTRE proxy web), jamais pour l'API, les retours de connexion ni une autre méthode que GET et HEAD.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const A = await import("@/core/siteAddress");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");

beforeEach(async () => { await db.reset(); delete process.env.LEGACY_HOSTS; process.env.SITE_URL = "https://nouveau.example.org"; });
after(() => { delete process.env.LEGACY_HOSTS; db.close(); });

test("parseSiteAddress : accepte https et un nom de domaine, complète le https:// manquant, normalise", () => {
  for (const [input, url] of [["https://monsite.be", "https://monsite.be"], ["https://MonSite.be/", "https://monsite.be"], ["monsite.be", "https://monsite.be"], ["  https://www.monsite.be  ", "https://www.monsite.be"],
    ["\"https://monsite.be\"", "https://monsite.be"], ["https://mon-site.co.uk", "https://mon-site.co.uk"], ["https://monsite.be.", "https://monsite.be"], ["https://sous.domaine.monsite.be", "https://sous.domaine.monsite.be"]]) {
    const r = A.parseSiteAddress(input);
    assert.deepEqual([r.ok, r.url], [true, url], input);
  }
  assert.equal(A.parseSiteAddress("https://bücher.de").ok, true, "un nom accentué passe par sa forme ASCII");
});

test("parseSiteAddress : refuse http, chemin, identifiant, port, IP, localhost, noms privés, schémas étrangers, texte illisible — avec la bonne raison", () => {
  const err = (s) => { const r = A.parseSiteAddress(s); assert.equal(r.ok, false, s); return r.error; };
  assert.equal(err(""), "empty");
  assert.equal(err("   "), "empty");
  assert.equal(err("http://monsite.be"), "http");
  assert.equal(err("ftp://monsite.be"), "scheme");
  assert.equal(err("javascript:alert(1)"), "scheme");
  assert.equal(err("https://monsite.be/blog"), "path");
  assert.equal(err("https://monsite.be/?a=1"), "path");
  assert.equal(err("https://monsite.be/#x"), "path");
  assert.equal(err("https://nom:mdp@monsite.be"), "credentials");
  assert.equal(err("https://monsite.be:8443"), "port");
  assert.equal(err("monsite.be:8443"), "port");
  assert.equal(err("https://192.168.1.10"), "ip");
  assert.equal(err("https://8.8.8.8"), "ip");
  assert.equal(err("https://[::1]"), "ip");
  assert.equal(err("https://2130706433"), "ip", "adresse décimale");
  assert.equal(err("https://0x7f000001"), "ip", "adresse hexadécimale");
  assert.equal(err("https://localhost"), "local");
  assert.equal(err("https://monsite.local"), "local");
  assert.equal(err("https://nas.home.arpa"), "local");
  assert.equal(err("https://monsite"), "invalid", "pas de point : pas un domaine public");
  assert.equal(err("https://mon site.be"), "invalid");
  assert.equal(err("https://-monsite.be"), "invalid");
  assert.equal(err("https://monsite.123"), "invalid");
  assert.equal(err("https://monsite.be\nhttps://autre.be"), "invalid");
  assert.equal(err("https://" + "a".repeat(300) + ".be"), "toolong");
});

test("parseLegacyHosts : noms valides seulement, doublons et domaine du site écartés, 10 au plus, rejets signalés", () => {
  const r = A.parseLegacyHosts("Ancien.be, ancien.be; www.vieux.org  localhost 10.0.0.1 https://x.be nouveau.example.org,truc", "nouveau.example.org");
  assert.deepEqual(r.hosts, ["ancien.be", "www.vieux.org"]);
  assert.deepEqual(r.rejected.sort(), ["10.0.0.1", "https://x.be", "localhost", "truc"].sort());
  const many = A.parseLegacyHosts(Array.from({ length: 14 }, (_, i) => `d${i}.example.org`).join(","), "site.be");
  assert.equal(many.hosts.length, A.MAX_LEGACY_HOSTS);
  assert.equal(many.truncated, true);
  assert.deepEqual(A.parseLegacyHosts(undefined, "site.be"), { hosts: [], rejected: [], truncated: false });
});

test("requestHost : ne croit qu'un nom de domaine simple (port toléré), jamais une liste, un identifiant ou un chemin", () => {
  assert.equal(A.requestHost("Ancien.BE"), "ancien.be");
  assert.equal(A.requestHost("ancien.be:3000"), "ancien.be");
  assert.equal(A.requestHost("ancien.be."), "ancien.be");
  for (const bad of ["", null, undefined, "ancien.be, evil.com", "ancien.be@evil.com", "evil.com/ancien.be", "ancien.be\r\nX: y", "[::1]", "ancien.be:80:81", "a".repeat(400)]) assert.equal(A.requestHost(bad), null, String(bad));
});

const SITE = "https://nouveau.example.org";
const LEGACY = ["ancien.example.org", "vieux.example.net"];
const req = (over = {}) => ({ method: "GET", host: "ancien.example.org", pathname: "/blog/article", search: "?a=1&b=2", ...over });

test("legacyRedirectTarget : garde le chemin et les paramètres, GET et HEAD seulement, domaine listé seulement", () => {
  assert.equal(A.legacyRedirectTarget(req(), SITE, LEGACY), "https://nouveau.example.org/blog/article?a=1&b=2");
  assert.equal(A.legacyRedirectTarget(req({ method: "HEAD", pathname: "/", search: "" }), SITE, LEGACY), "https://nouveau.example.org/");
  assert.equal(A.legacyRedirectTarget(req({ host: "vieux.example.net", pathname: "/twitch", search: "" }), SITE, LEGACY), "https://nouveau.example.org/twitch", "un QR code déjà imprimé");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(A.legacyRedirectTarget(req({ method }), SITE, LEGACY), null, method);
  assert.equal(A.legacyRedirectTarget(req({ host: "autre.example.com" }), SITE, LEGACY), null, "domaine non listé");
  assert.equal(A.legacyRedirectTarget(req({ host: "nouveau.example.org" }), SITE, LEGACY), null, "le domaine du site ne se redirige pas lui-même");
  assert.equal(A.legacyRedirectTarget(req({ host: null }), SITE, LEGACY), null);
  assert.equal(A.legacyRedirectTarget(req(), SITE, []), null, "sans ancien domaine : rien");
  assert.equal(A.legacyRedirectTarget(req({ host: "nouveau.example.org" }), SITE, ["nouveau.example.org"]), null, "même listé par erreur, jamais de boucle");
});

test("legacyRedirectTarget : jamais pour l'API, les fichiers internes ni les retours de connexion d'un service tiers", () => {
  for (const pathname of ["/api/mcp/vit_secret", "/api/health", "/api", "/API/x", "/_next/static/x.js", "/m/twitch/oauth/callback", "/m/discord/oauth/callback", "/m/x/callback"]) {
    assert.equal(A.legacyRedirectTarget(req({ pathname, search: "?code=abc&state=def" }), SITE, LEGACY), null, pathname);
  }
  for (const pathname of ["/apiary", "/apis-publiques", "/admin", "/overlays/secret", "/uploads/a.png", "/robots.txt", "/en/blog"]) {
    assert.ok(A.legacyRedirectTarget(req({ pathname }), SITE, LEGACY)?.startsWith("https://nouveau.example.org/"), pathname);
  }
});

test("legacyRedirectTarget : AUCUNE redirection ouverte — la cible garde toujours le domaine du site, quel que soit le chemin ou les paramètres", () => {
  const attacks = [
    "//evil.example.com", "///evil.example.com/x", "/\\evil.example.com", "/\\\\evil.example.com", "/%2f%2fevil.example.com", "/%5cevil.example.com", "/.//evil.example.com",
    "/..;/evil.example.com", "/@evil.example.com", "/https://evil.example.com", "/%0d%0aLocation:%20https://evil.example.com", "/\t/evil.example.com", "/\u0000evil.example.com",
  ];
  for (const pathname of attacks) {
    for (const search of ["", "?next=https://evil.example.com", "?u=//evil.example.com", "?%0d%0aX=1"]) {
      const target = A.legacyRedirectTarget(req({ pathname, search }), SITE, LEGACY);
      if (target === null) continue;
      const url = new URL(target);
      assert.equal(url.origin, "https://nouveau.example.org", `${pathname}${search} -> ${target}`);
      assert.ok(!/[\r\n\0]/.test(target), "aucun caractère de contrôle dans la cible");
    }
  }
  // La cible ne dépend d'AUCUN autre en-tête que celui qu'on lui donne : la fonction ne lit ni X-Forwarded-Host ni Origin, seulement `host` déjà vérifié.
  assert.equal(A.legacyRedirectTarget({ method: "GET", host: "ancien.example.org", pathname: "/x", search: "", forwardedHost: "evil.example.com" }, SITE, LEGACY), "https://nouveau.example.org/x");
});

test("visitedAddress : même domaine (www toléré) → vrai ; autre → faux ; site local ou en-tête illisible → inconnu (jamais d'avertissement à tort)", () => {
  assert.equal(A.visitedAddress("monsite.be", "https://monsite.be").same, true);
  assert.equal(A.visitedAddress("www.monsite.be", "https://monsite.be").same, true);
  assert.equal(A.visitedAddress("MonSite.be:443", "https://monsite.be").same, true);
  assert.deepEqual(A.visitedAddress("autre.be", "https://monsite.be"), { visited: "autre.be", configured: "monsite.be", same: false });
  assert.equal(A.visitedAddress("localhost:3000", "http://localhost:3000").same, null);
  assert.equal(A.visitedAddress("monsite.be", "http://localhost:3000").same, null);
  assert.equal(A.visitedAddress(null, "https://monsite.be").same, null);
});

/* ───────────── Le proxy du cœur ───────────── */

const through = (path, headers = {}, method = "GET") => proxy(new NextRequest(`http://127.0.0.1:3000${path}`, { method, headers }));

test("proxy : un Host listé reçoit une 301 vers SITE_URL en gardant chemin et paramètres ; l'en-tête est Vary: Host, jamais mis en cache partagé", async () => {
  process.env.LEGACY_HOSTS = "ancien.example.org";
  const res = await through("/blog/mon-article?utm=1", { host: "ancien.example.org" });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://nouveau.example.org/blog/mon-article?utm=1");
  assert.match(res.headers.get("cache-control") ?? "", /private/);
  assert.match(res.headers.get("vary") ?? "", /Host/i);
  assert.equal((await through("/", { host: "ancien.example.org:3000" })).status, 301, "port toléré");
  assert.equal((await through("/", { host: "ANCIEN.example.org" })).status, 301, "casse ignorée");
  for (const path of ["/admin/settings", "/overlays/abc", "/uploads/a.png", "/robots.txt", "/sitemap.xml", "/m/blog/x"]) assert.equal((await through(path, { host: "ancien.example.org" })).status, 301, path);
});

test("proxy : ni API, ni retour de connexion, ni POST, ni domaine inconnu, ni domaine du site — et sans LEGACY_HOSTS le proxy ne redirige jamais", async () => {
  process.env.LEGACY_HOSTS = "ancien.example.org";
  const same = async (path, headers, method) => { const r = await through(path, headers, method); assert.notEqual(r.status, 301, `${method ?? "GET"} ${path}`); assert.equal(r.headers.get("location"), null); };
  await same("/api/mcp/vit_x", { host: "ancien.example.org" });
  await same("/api/health", { host: "ancien.example.org" });
  await same("/m/twitch/oauth/callback?code=1", { host: "ancien.example.org" });
  await same("/contact", { host: "ancien.example.org" }, "POST");
  await same("/admin/login", { host: "ancien.example.org" }, "POST");
  await same("/", { host: "inconnu.example.org" });
  await same("/", { host: "nouveau.example.org" });
  await same("/", {});
  delete process.env.LEGACY_HOSTS;
  await same("/", { host: "ancien.example.org" });
});

test("proxy : attaques d'en-têtes — X-Forwarded-Host, X-Forwarded-For, Origin, Referer, X-Original-URL ne choisissent ni la décision ni la cible", async () => {
  process.env.LEGACY_HOSTS = "ancien.example.org";
  // Un X-Forwarded-Host forgé « ancien » sur une requête pour le site n'y change rien : seul Host compte.
  const forged = await through("/", { host: "nouveau.example.org", "x-forwarded-host": "ancien.example.org", "x-forwarded-for": "ancien.example.org" });
  assert.notEqual(forged.status, 301);
  // Un Host listé avec des en-têtes qui tentent de désigner une autre cible : la cible reste SITE_URL.
  const res = await through("/page", { host: "ancien.example.org", "x-forwarded-host": "evil.example.com", origin: "https://evil.example.com", referer: "https://evil.example.com/", "x-original-url": "https://evil.example.com/", "x-forwarded-proto": "http", "x-forwarded-port": "1337" });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://nouveau.example.org/page");
  // Un Host piégé n'est pas cru.
  for (const host of ["ancien.example.org, evil.example.com", "ancien.example.org@evil.example.com", "evil.example.com/ancien.example.org"]) assert.notEqual((await through("/", { host })).status, 301, host);
  // Chemins piégés : la cible garde le domaine du site.
  for (const path of ["//evil.example.com", "/%2f%2fevil.example.com", "/\\evil.example.com", "/%5Cevil.example.com"]) {
    const r = await through(path, { host: "ancien.example.org" });
    if (r.status === 301) assert.equal(new URL(r.headers.get("location")).origin, "https://nouveau.example.org", path);
  }
});

test("proxy : LEGACY_HOSTS invalide ou contenant le domaine du site est ignoré, jamais de boucle ; plus de 10 domaines : les dix premiers", async () => {
  process.env.LEGACY_HOSTS = "nouveau.example.org, localhost, 127.0.0.1, pas un domaine";
  assert.notEqual((await through("/", { host: "nouveau.example.org" })).status, 301);
  assert.notEqual((await through("/", { host: "localhost" })).status, 301);
  process.env.LEGACY_HOSTS = Array.from({ length: 12 }, (_, i) => `d${i}.example.org`).join(",");
  assert.equal((await through("/", { host: "d9.example.org" })).status, 301);
  assert.notEqual((await through("/", { host: "d10.example.org" })).status, 301);
});

test("proxy : le comportement d'avant est intact pour les adresses qu'il ne traitait pas (admin, API, fichiers) — aucune langue, aucun cookie ajoutés", async () => {
  for (const path of ["/admin", "/api/health", "/uploads/a.png", "/m/blog/x", "/overlays/abc", "/robots.txt"]) {
    const r = await through(path, { host: "nouveau.example.org" });
    assert.equal(r.headers.get("x-middleware-next"), "1", path);
    assert.equal(r.headers.get("x-middleware-override-headers"), null, path);
    assert.equal(r.headers.get("set-cookie"), null, path);
    assert.equal(r.headers.get("permissions-policy"), null, path);
  }
});
