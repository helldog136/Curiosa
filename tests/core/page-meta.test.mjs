// Métadonnées de page et routes à segment libre (cœur 0.3.0) : `robots: "noindex"`, `sitemap` (+ `sitemapFromPage`), route `…/:slug`.
// Règle de confiance : un module ne choisit jamais un en-tête ; il ne peut que réduire l'exposition, ses chemins sont bornés et restent SOUS l'adresse de son instance,
// et un module existant (sans `sitemapFromPage`) n'est jamais appelé par le plan du site : rien ne change pour lui.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb as openTestDb } from "../helpers/db.mjs";

const db = await openTestDb();
const { prisma } = db;
const { parseManifest } = await import("@/core/modules/manifest");
const { cleanSitemapPaths, matchModuleRoute, pageRobots, SLUG_RE } = await import("@/core/modules/pageMeta");
const { buildSitemap } = await import("@/core/sitemap");
const { buildLlmsTxt, pathTitle } = await import("@/core/llms");
const { resetPageDeclarations, pageDeclarations } = await import("@/core/modules/pageDeclarations");
const { MODULES_DIR } = await import("@/core/config");
const { resetModuleRegistry, getActiveInstances } = await import("@/core/modules/registry");
const { GET: moduleRoute, POST: moduleRoutePost } = await import("@/app/m/[instance]/[...path]/route");

after(() => db.close());
beforeEach(async () => { await db.reset(); fs.rmSync(MODULES_DIR, { recursive: true, force: true }); resetModuleRegistry(); resetPageDeclarations(); delete globalThis.__pageCalls; });

// ── Fonctions pures ──────────────────────────────────────────────────────────────────────────────────────────────

test("robots : seule la valeur « noindex » est reconnue", () => {
  assert.equal(pageRobots("noindex"), "noindex");
  for (const v of ["index", "NOINDEX", "noindex, follow", "nofollow", "", null, undefined, 1, true, {}, ["noindex"]]) assert.equal(pageRobots(v), undefined, String(v));
});

test("chemins du plan du site : sous l'adresse de l'instance, motif strict, sans doublon, 50 au plus, 5 niveaux au plus", () => {
  const ok = cleanSitemapPaths(["/legal/cookies", "/legal/Terms", "/legal/cookies", "/legal/a/b/c/d/e", "/legal/a/b/c/d/e/f"], "legal");
  assert.deepEqual(ok, ["/legal/cookies", "/legal/terms", "/legal/a/b/c/d/e"], "minuscules, doublon fusionné, 5 niveaux au plus sous l'adresse de l'instance");
  const bad = [
    "/other/x", "/legalx/y", "legal/x", "/legal", "/legal/", "/legal//x", "/legal/x/", "/legal/x?y=1", "/legal/x#a", "/legal/../admin", "/legal/%2e%2e", "/legal/a b", "/legal/é",
    "https://evil.example/legal/x", "//evil.example/legal/x", "/legal/" + "a".repeat(81), 42, null, {}, ["/legal/x"], "/admin/x", "/legal/x\n/legal/y",
  ];
  assert.deepEqual(cleanSitemapPaths(bad, "legal"), []);
  assert.deepEqual(cleanSitemapPaths("/legal/x", "legal"), [], "pas une liste");
  assert.deepEqual(cleanSitemapPaths(["/legal/x"], null), [], "instance sans adresse");
  const many = Array.from({ length: 200 }, (_, i) => `/legal/p${i}`);
  assert.equal(cleanSitemapPaths(many, "legal").length, 50);
  assert.deepEqual(cleanSitemapPaths(["/legal/" + "a".repeat(80)], "legal").length, 1, "80 caractères : permis");
});

test("chemins du plan du site d'une instance montée à la racine : jamais un chemin réservé au cœur", () => {
  assert.deepEqual(cleanSitemapPaths(["/about", "/admin/x", "/api/x", "/m/x", "/go/x", "/uploads/x", "/overlays/x"], ""), ["/about"]);
});

test("route à segment libre : la route exacte l'emporte toujours ; sinon « …/:slug » avec un dernier segment conforme", () => {
  const routes = { go: "A", "go/:slug": "B", ":slug": "C", "a/b": "D", "a/b/:slug": "E" };
  assert.deepEqual(matchModuleRoute(routes, ["go"]), { handler: "A", params: {} });
  assert.deepEqual(matchModuleRoute(routes, ["go", "abc_DEF-9"]), { handler: "B", params: { slug: "abc_DEF-9" } });
  assert.deepEqual(matchModuleRoute(routes, ["whatever"]), { handler: "C", params: { slug: "whatever" } });
  assert.deepEqual(matchModuleRoute(routes, ["a", "b"]), { handler: "D", params: {} }, "la route exacte « a/b » avant « :slug »");
  assert.deepEqual(matchModuleRoute(routes, ["a", "b", "z"]), { handler: "E", params: { slug: "z" } });
  assert.equal(matchModuleRoute(routes, ["a", "x", "y"]), null, "un seul segment libre, toujours le dernier");
  assert.equal(matchModuleRoute(routes, ["go", ":slug"]), null, "la clé déclarée n'est pas une adresse");
  for (const bad of ["a.b", "a b", "a%2Fb", "é", "a".repeat(81), "", "..", "a/b"]) assert.equal(matchModuleRoute({ "go/:slug": "B" }, ["go", bad]), null, JSON.stringify(bad));
  assert.equal(matchModuleRoute({ "go/:slug": "B" }, []), null);
  assert.equal(matchModuleRoute(undefined, ["x"]), null);
  assert.equal(matchModuleRoute({}, ["constructor", "x"]), null, "pas de route héritée de Object.prototype");
  assert.ok(SLUG_RE.test("a".repeat(80)) && !SLUG_RE.test("a".repeat(81)));
});

test("titre d'un chemin déclaré pour llms.txt", () => {
  assert.equal(pathTitle("/legal/cookie-policy"), "Cookie policy");
  assert.equal(pathTitle("/legal/terms_of_use"), "Terms of use");
});

// ── Manifeste ────────────────────────────────────────────────────────────────────────────────────────────────────

const base = (over = {}) => ({ apiVersion: 2, id: "legal", name: "Legal", version: "1.0.0", type: "widget", page: true, permissions: ["pages", "routes"], main: "index.mjs", ...over });

test("manifeste : sitemapFromPage exige une page publique ; sans la clé, le manifeste est inchangé", () => {
  assert.equal(parseManifest(base({ sitemapFromPage: true })).ok, true);
  const r = parseManifest(base({ page: false, sitemapFromPage: true }));
  assert.equal(r.ok, false);
  assert.match(r.error, /sitemapFromPage/);
  const plain = parseManifest(base());
  assert.equal(plain.ok, true);
  assert.equal(plain.manifest.sitemapFromPage, undefined);
});

// ── De bout en bout (base de test, vrai registre, vraies routes) ────────────────────────────────────────────────

const CODE = `
export default {
  page: async (ctx, request) => {
    globalThis.__pageCalls = (globalThis.__pageCalls ?? 0) + 1;
    globalThis.__lastRequest = request;
    const b = ctx.instance.basePath;
    if (request.segments[0] === "private") return { title: "Private", blocks: [], robots: "noindex" };
    return {
      title: "Legal", blocks: [], robots: globalThis.__noindex ? "noindex" : "index", header: "X-Evil: 1",
      sitemap: ["/" + b + "/cookies", "/" + b + "/terms", "/other/steal", "/admin/x", "https://evil.example/x", "/" + b + "/cookies", 42],
    };
  },
  routes: {
    go: async () => new Response("exact"),
    "go/:slug": async (req, ctx) => new Response("slug=" + ctx.params.slug + ";keys=" + Object.keys(ctx.params).join(",")),
    ping: async (req, ctx) => new Response("params=" + JSON.stringify(ctx.params)),
  },
};`;

async function setup({ sitemapFromPage = true, key = "legal", basePath = "legal" } = {}) {
  const manifest = base({ id: "legal", ...(sitemapFromPage ? { sitemapFromPage: true } : {}) });
  const dir = path.join(MODULES_DIR, manifest.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "index.mjs"), CODE);
  await prisma.module.create({ data: { id: manifest.id, source: "git", version: manifest.version } });
  const inst = await prisma.moduleInstance.create({ data: { moduleId: manifest.id, key, basePath, translations: { create: [{ locale: "fr", name: "Mentions", description: "Mentions légales" }] } } });
  resetModuleRegistry(); resetPageDeclarations();
  return inst;
}
const call = (method, p) => (method === "POST" ? moduleRoutePost : moduleRoute)(new Request(`http://x/m/legal/${p}`, { method }), { params: Promise.resolve({ instance: "legal", path: p.split("/") }) });
const urls = async () => (await buildSitemap()).urls.map((u) => new URL(u.url).pathname);

test("plan du site et llms.txt : chemins déclarés ajoutés, ceux hors du préfixe écartés ; un en-tête libre n'existe pas", async () => {
  await setup();
  const list = await urls();
  assert.ok(list.includes("/legal") && list.includes("/legal/cookies") && list.includes("/legal/terms"), list.join(" "));
  assert.equal(list.filter((u) => u === "/legal/cookies").length, 1, "dédoublonné");
  assert.ok(!list.some((u) => /steal|admin|evil/.test(u)));
  const llms = await buildLlmsTxt("fr");
  assert.match(llms, /\[Cookies\]\(.*\/legal\/cookies\)/);
  assert.match(llms, /\[Terms\]\(.*\/legal\/terms\)/);
  assert.ok(!/steal|evil/.test(llms));
  assert.equal(globalThis.__lastRequest.for, "sitemap", "le module sait que c'est pour le plan du site (pour ne pas compter une visite)");
});

test("noindex sur la page de l'instance : l'instance et ses chemins quittent le plan du site et llms.txt", async () => {
  await setup();
  globalThis.__noindex = true;
  try {
    const list = await urls();
    assert.ok(!list.some((u) => u.startsWith("/legal")), list.join(" "));
    assert.ok(!(await buildLlmsTxt("fr")).includes("/legal"));
  } finally { delete globalThis.__noindex; }
});

test("un module SANS sitemapFromPage n'est jamais appelé par le plan du site ni par llms.txt : même résultat qu'avant, aucune visite comptée", async () => {
  await setup({ sitemapFromPage: false });
  const list = await urls();
  assert.deepEqual(list.filter((u) => u.startsWith("/legal")), ["/legal"]);
  assert.ok(!(await buildLlmsTxt("fr")).includes("/legal/cookies"));
  assert.equal(globalThis.__pageCalls ?? 0, 0, "page() n'a pas été appelée");
});

test("la déclaration est gardée 60 s (un robot qui relit le plan ne fait pas tourner le module) puis relue", async () => {
  const inst = await setup();
  const [active] = (await getActiveInstances()).filter((a) => a.instance.id === inst.id);
  const t0 = 1_000_000;
  await pageDeclarations(active, "fr", t0);
  await pageDeclarations(active, "fr", t0 + 59_000);
  assert.equal(globalThis.__pageCalls, 1);
  await pageDeclarations(active, "fr", t0 + 61_000);
  assert.equal(globalThis.__pageCalls, 2);
});

test("page éteinte ou sans adresse : rien n'est lu (règles de hasPublicPage)", async () => {
  const inst = await setup({ basePath: null });
  const [active] = (await getActiveInstances()).filter((a) => a.instance.id === inst.id);
  assert.deepEqual(await pageDeclarations(active, "fr"), { noindex: false, paths: [] });
  assert.equal(globalThis.__pageCalls ?? 0, 0);
});

test("route /m/<instance>/go/<segment> : le segment arrive dans ctx.params.slug ; la route exacte « go » reste inchangée", async () => {
  await setup();
  assert.equal(await (await call("GET", "go")).text(), "exact");
  assert.equal(await (await call("GET", "go/abc-DEF_9")).text(), "slug=abc-DEF_9;keys=slug");
  assert.equal(await (await call("POST", "go/abc")).text(), "slug=abc;keys=slug", "GET et POST, comme toute route");
  assert.equal(await (await call("GET", "ping")).text(), "params={}", "une route ordinaire reçoit params vide");
});

test("route à segment libre : un segment hors motif, une route inconnue ou un niveau en trop répondent 404", async () => {
  await setup();
  for (const p of ["go/a.b", "go/" + "a".repeat(81), "go/a%2Fb", "go/%2e%2e", "go/é", "nope/abc", "go/abc/def", "go/:slug"]) {
    const res = await call("GET", p);
    assert.equal(res.status, 404, p);
  }
});

test("route à segment libre : l'ancienne règle (route exacte seulement) est inchangée pour un module sans « :slug »", async () => {
  await setup();
  assert.equal((await call("GET", "ping/extra")).status, 404);
});
