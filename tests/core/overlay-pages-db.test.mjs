// Pages d'overlay (0.5.0) avec une vraie base : stockage et limites dures, secret, mode test, pages publiques, élément disparu ou en échec, sauvegarde → restauration, multi-lecteurs.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

process.env.CURIOSA_SECTION_TIMEOUT_MS = "400";   // un élément qui ne répond pas est écarté après 400 ms (valeur normale : 8 s)
process.env.AUTH_SECRET = "test-auth-secret-overlay";
const db = await useTestDb();
const S = await import("@/core/overlays/store");
const Sec = await import("@/core/overlays/secret");
const M = await import("@/core/overlays/model");
const { validatePageInput } = await import("@/core/overlays/pageInput");
const { buildCatalog } = await import("@/core/overlays/catalog");
const { resolvePage } = await import("@/core/overlays/resolve");
const R = await import("@/core/modules/registry");
const { buildContext } = await import("@/core/modules/context");
const { createInstance } = await import("@/core/instanceService");
const { resetStallState } = await import("@/core/modules/budget");
const PageRoute = await import("@/app/overlays/page/[secret]/route");
const StateRoute = await import("@/app/overlays/page/[secret]/state/route");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { setSetting } = await import("@/core/settings");

beforeEach(async () => { await db.reset(); resetStallState(); });
after(() => db.close());

const readDir = (dir, prefix = "") => Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? Object.entries(readDir(path.join(dir, e.name), `${prefix}${e.name}/`)) : [[`${prefix}${e.name}`, fs.readFileSync(path.join(dir, e.name), "utf8")]])));
const DEMO = readDir("examples/overlay-demo");

// Un module qui se comporte mal : un élément qui plante, un qui donne une adresse refusée, un qui ne répond jamais, un qui répond null, un qui marche.
const BAD = {
  "module.json": { apiVersion: 2, id: "bad-elements", name: "Bad", version: "1.0.0", minCore: "0.5.0", main: "index.mjs", type: "widget", permissions: ["routes"], instances: "single",
    overlayElements: ["boom", "external", "hang", "nothing", "fine"].map((id) => ({ id, label: id, fit: "fluid" })) },
  "index.mjs": `export default { overlayElements: {
    boom: () => { throw new Error("secret-token-in-message"); },
    external: () => ({ url: "https://evil.example/x" }),
    hang: () => new Promise(() => {}),
    nothing: () => null,
    fine: (ctx) => ({ url: "/m/" + ctx.instance.key + "/ok?k=SECRET-OF-MODULE" }),
  }, routes: { ok: () => new Response("ok") } };`,
};

/** Pose un module dans le dossier des modules (comme un site existant) : le cœur testé est en 0.4.0, l'installation par dépôt refuserait un module qui exige la 0.5.0. */
async function putModule(id, files) {
  const target = path.join(db.dir, "modules", id);
  fs.rmSync(target, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true }); fs.writeFileSync(path.join(target, name), typeof content === "string" ? content : JSON.stringify(content)); }
  const manifest = typeof files["module.json"] === "string" ? JSON.parse(files["module.json"]) : files["module.json"];
  await db.prisma.module.upsert({ where: { id }, create: { id, source: "bundled", version: manifest.version, enabled: true }, update: { enabled: true } });
}
async function setup() {
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  await putModule("overlay-demo", DEMO);
  await putModule("bad-elements", BAD);
  const demo = await R.getModule("overlay-demo");
  const inst = await createInstance(db.prisma, { manifest: demo.manifest, nickname: "Démo", names: { fr: "Démo", en: "Demo" } });
  const bad = await R.getModule("bad-elements");
  const badInst = (await db.prisma.moduleInstance.findFirst({ where: { moduleId: "bad-elements" } })) ?? (await createInstance(db.prisma, { manifest: bad.manifest, nickname: "Bad", names: { fr: "Bad", en: "Bad" } }));
  return { demoKey: inst.key, badKey: badInst.key };
}
const place = (uid, instance, element, extra = {}) => ({ uid, instance, element, x: 10, y: 10, w: 600, h: 200, visible: true, options: {}, ...extra });
const get = async (url, route = PageRoute) => route.GET(new Request(`http://localhost${url.path}${url.q ?? ""}`, { headers: { host: "localhost" } }), { params: Promise.resolve({ secret: url.secret }) });

// ── Migration ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("migration : additive (une table et son index, rien d'existant modifié) et appliquée automatiquement", async () => {
  const sql = fs.readFileSync("prisma/migrations/20261030090000_overlay_pages/migration.sql", "utf8").replace(/^--.*$/gm, "");
  assert.deepEqual([...sql.matchAll(/^(CREATE (?:UNIQUE )?(?:TABLE|INDEX)|ALTER|DROP|INSERT|UPDATE|DELETE)/gm)].map((m) => m[1]), ["CREATE TABLE", "CREATE UNIQUE INDEX"]);
  assert.doesNotMatch(sql, /ALTER|DROP|REFERENCES/);
  const cols = (await db.prisma.$queryRawUnsafe(`PRAGMA table_info("OverlayPage")`)).map((c) => c.name);
  for (const c of ["id", "name", "width", "height", "active", "style", "elements", "secretHash", "secretSealed", "testUntil", "rev", "createdAt", "updatedAt"]) assert.ok(cols.includes(c), c);
  const migrations = fs.readdirSync("prisma/migrations").filter((d) => /^\d{8,}_/.test(d)).sort();
  assert.equal(migrations.at(-1), "20261030090000_overlay_pages", "la dernière migration est celle des pages d'overlay");
});

// ── Stockage et limites dures ─────────────────────────────────────────────────────────────────────────────────────────────
test("limites dures : 20 pages, 10 actives, 30 éléments par page ; une nouvelle page attend, inactive, quand 10 sont actives", async () => {
  const made = [];
  for (let i = 0; i < 20; i++) { const r = await S.createPage({ name: `P${i}`, width: 1920, height: 1080 }); assert.ok(r.ok); made.push(r.page); }
  assert.equal((await S.createPage({ name: "21e", width: 1920, height: 1080 })).error, "limitPages");
  assert.equal((await S.listPages()).length, 20);
  assert.equal(made.filter((p) => p.active).length, 10, "les 10 premières sont actives, les 10 suivantes attendent");
  assert.equal((await S.setActive(made[15].id, true)).error, "limitActive");
  assert.ok((await S.setActive(made[0].id, false)).ok);
  assert.ok((await S.setActive(made[15].id, true)).ok);
  assert.equal((await S.listPages()).filter((p) => p.active).length, 10);
  assert.equal((await S.deletePage(made[1].id)).ok, true);
  assert.ok((await S.createPage({ name: "de nouveau", width: 1920, height: 1080 })).ok, "une place s'est libérée");
  // 30 éléments au plus, à la validation comme à l'écriture.
  const { demoKey } = await setup();
  const catalog = await buildCatalog("fr", "fr");
  const many = Array.from({ length: 31 }, (_, i) => place(`u${String(i).padStart(6, "0")}`, demoKey, "board", { w: 400, h: 300, x: 0, y: 0 }));
  const bad = validatePageInput({ name: "x", width: 1920, height: 1080, elements: many }, { catalog, previous: [] });
  assert.equal(bad.ok, false); assert.equal(bad.issues[0].code, "tooMany");
  const ok = validatePageInput({ name: "x", width: 1920, height: 1080, elements: many.slice(0, 30) }, { catalog, previous: [] });
  assert.ok(ok.ok); assert.equal(ok.value.elements.length, 30);
  assert.equal(S.parseElements(JSON.stringify(Array.from({ length: 50 }, (_, i) => place(`u${String(i).padStart(6, "0")}`, "a", "b")))).length, 30, "une ligne abîmée n'est jamais lue au-delà de la borne");
});

test("création, copie (nouvelle adresse, inactive), renommage, suppression, ligne abîmée sans erreur", async () => {
  const a = (await S.createPage({ name: "  Principale ", width: 3440, height: 1440 })).page;
  assert.equal(a.name, "Principale"); assert.equal(a.active, true); assert.equal(a.rev, 1);
  assert.equal((await S.createPage({ name: "", width: 1920, height: 1080 })).error, "name");
  assert.equal((await S.createPage({ name: "x", width: 10, height: 1080 })).error, "resolution");
  const secretA = await S.readSecret(a.id);
  const copy = (await S.duplicatePage(a.id, (n) => `${n} (copie)`)).page;
  assert.equal(copy.name, "Principale (copie)"); assert.equal(copy.active, false); assert.equal(copy.testUntil, null);
  assert.notEqual(await S.readSecret(copy.id), secretA, "la copie a sa propre adresse secrète");
  assert.ok((await S.renamePage(a.id, "Pause")).ok); assert.equal((await S.getPage(a.id)).name, "Pause");
  assert.equal((await S.renamePage("nope", "x")).error, "notFound");
  await db.prisma.overlayPage.update({ where: { id: a.id }, data: { elements: "{pas du json", style: "[]" } });
  const broken = await S.getPage(a.id);
  assert.deepEqual(broken.elements, []); assert.deepEqual(broken.style, M.DEFAULT_STYLE);
  assert.ok((await S.deletePage(a.id)).ok); assert.equal(await S.getPage(a.id), null); assert.equal((await S.deletePage(a.id)).error, "notFound");
});

// ── Secret ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("secret : jamais en clair en base, retrouvé par empreinte, changé = l'ancienne adresse est coupée, illisible sans erreur", async () => {
  const page = (await S.createPage({ name: "S", width: 1920, height: 1080 })).page;
  const secret = await S.readSecret(page.id);
  assert.match(secret, Sec.SECRET_RE);
  const row = await db.prisma.overlayPage.findUnique({ where: { id: page.id } });
  assert.ok(!JSON.stringify(row).includes(secret), "le secret n'apparaît nulle part dans la ligne");
  assert.equal(row.secretHash, Sec.hashSecret(secret)); assert.notEqual(row.secretSealed, secret);
  assert.equal((await S.getPageBySecret(Sec.hashSecret(secret))).id, page.id);
  assert.ok((await S.resetPageSecret(page.id)).ok);
  const fresh = await S.readSecret(page.id);
  assert.notEqual(fresh, secret); assert.equal(await S.getPageBySecret(Sec.hashSecret(secret)), null, "l'ancienne adresse ne marche plus");
  assert.equal((await S.getPage(page.id)).rev, 2);
  process.env.AUTH_SECRET = "un-autre-secret-de-site";
  assert.equal(await S.readSecret(page.id), null, "copie chiffrée illisible : null, jamais une erreur");
  assert.ok((await S.resetPageSecret(page.id)).ok); assert.match(await S.readSecret(page.id), Sec.SECRET_RE);
  process.env.AUTH_SECRET = "test-auth-secret-overlay";
});

// ── Mode test ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("mode test : démarrer, prolonger, arrêter ; l'échéance est constatée à la lecture (aucun minuteur)", async () => {
  const page = (await S.createPage({ name: "T", width: 1920, height: 1080 })).page;
  const t0 = 2_000_000_000_000;
  const started = await S.setTest(page.id, "start", t0);
  assert.equal(started.testUntil, t0 + 30 * 60_000);
  assert.equal(M.testActive((await S.getPage(page.id)).testUntil, t0 + 29 * 60_000), true);
  assert.equal(M.testActive((await S.getPage(page.id)).testUntil, t0 + 31 * 60_000), false, "30 minutes plus tard, le mode test est fini sans que rien n'ait tourné");
  const extended = await S.setTest(page.id, "extend", t0 + 10 * 60_000);
  assert.equal(extended.testUntil, t0 + 60 * 60_000);
  assert.equal((await S.setTest(page.id, "stop", t0)).testUntil, null);
  assert.equal((await S.getPage(page.id)).rev, 1, "le mode test ne change pas la version de la mise en page");
  assert.equal((await S.setTest("nope", "start")).error, "notFound");
});

// ── Pages publiques ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function pageWith(elements, style) {
  const { demoKey, badKey } = await setup();
  const made = (await S.createPage({ name: "Principale", width: 3440, height: 1440, style })).page;
  const els = typeof elements === "function" ? elements({ demoKey, badKey }) : elements;
  await db.prisma.overlayPage.update({ where: { id: made.id }, data: { elements: JSON.stringify(els) } });
  return { page: await S.getPage(made.id), secret: await S.readSecret(made.id), demoKey, badKey };
}

test("/overlays/page/<secret> : 404 muet si inconnu ou mal formé ; sinon page transparente avec des en-têtes sûrs, sans cookie", async () => {
  const { secret, demoKey } = await pageWith(({ demoKey }) => [place("aaaaaa", demoKey, "clock", { options: { format: "12h", size: 80 } })], { text: "dark", background: "soft", corners: "square" });
  for (const bad of ["x", "../etc", "A".repeat(32), "A".repeat(31), `${secret}x`]) { const r = await get({ secret: bad, path: `/overlays/page/${bad}` }); assert.equal(r.status, 404, bad); assert.equal(await r.text(), "Not found"); }
  const r = await get({ secret, path: `/overlays/page/${secret}` });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, new RegExp(`src="/m/${demoKey}/element/clock\\?`));
  const src = html.match(/src="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const q = new URL(src, "http://x").searchParams;
  assert.deepEqual([q.get("ov-w"), q.get("ov-h"), q.get("ov-fit")], ["600", "200", "scale"]);
  assert.deepEqual([q.get("ov-text"), q.get("ov-surface"), q.get("ov-corners")], ["dark", "soft", "square"], "le style commun arrive à l'élément");
  assert.deepEqual([q.get("opt-format"), q.get("opt-size"), q.get("opt-seconds"), q.get("opt-label")], ["12h", "80", "1", ""], "options validées + défauts");
  assert.match(html, /transform:scale\(1\)/);
  const h = r.headers;
  assert.equal(h.get("set-cookie"), null); assert.match(h.get("cache-control"), /no-store/); assert.equal(h.get("referrer-policy"), "no-referrer");
  const csp = h.get("content-security-policy");
  assert.match(csp, new RegExp(`frame-src localhost/m/${demoKey}/element/clock;`)); assert.match(csp, /default-src 'none'/); assert.doesNotMatch(csp, /\*/);
  assert.doesNotMatch(html, /--sk-|data-skin|\/skins\//, "aucun skin de site");
  assert.doesNotMatch(html, /<html [^>]*data-test/, "mode test arrêté");
});

test("page inactive : « Cet overlay est désactivé » (pas de page blanche) ; réactivée, l'état change et la version aussi", async () => {
  const { page, secret } = await pageWith(({ demoKey }) => [place("aaaaaa", demoKey, "clock")]);
  await S.setActive(page.id, false);
  const html = await (await get({ secret, path: `/overlays/page/${secret}` })).text();
  assert.match(html, /Cet overlay est désactivé/); assert.doesNotMatch(html, /<iframe/);
  const state = await (await get({ secret, path: `/overlays/page/${secret}/state` }, StateRoute)).json();
  assert.deepEqual([state.active, state.test, state.rev], [false, false, 2]);
  await S.setActive(page.id, true);
  const again = await (await get({ secret, path: `/overlays/page/${secret}/state` }, StateRoute)).json();
  assert.deepEqual([again.active, again.rev], [true, 3]);
});

test("mode test vu de la page : cadres du cœur « module · élément · taille », bascule par l'état, expiration à la lecture", async () => {
  const { page, secret } = await pageWith(({ demoKey }) => [place("aaaaaa", demoKey, "clock", { w: 900, h: 300 })]);
  const statePath = `/overlays/page/${secret}/state`;
  const t = Date.now();
  await S.setTest(page.id, "start", t);
  const st = await (await get({ secret, path: statePath }, StateRoute)).json();
  assert.equal(st.test, true); assert.ok(st.until > st.now && st.until - st.now <= 30 * 60_000);
  const html = await (await get({ secret, path: `/overlays/page/${secret}` })).text();
  assert.match(html, /<html [^>]*data-test="1"/); assert.match(html, /Démo · Horloge · 900×300 px/);
  assert.match(html, /ov-demo=1/, "le contenu d'exemple de l'élément est chargé en mode test");
  assert.equal((await StateRoute.GET(new Request("http://x"), { params: Promise.resolve({ secret: "bad" }) })).status, 404);
  // Échéance dépassée : le mode test est fini à la lecture suivante, sans rien d'autre.
  await db.prisma.overlayPage.update({ where: { id: page.id }, data: { testUntil: new Date(Date.now() - 1000) } });
  assert.equal((await (await get({ secret, path: statePath }, StateRoute)).json()).test, false);
  assert.doesNotMatch(await (await get({ secret, path: `/overlays/page/${secret}` })).text(), /<html [^>]*data-test/);
  assert.equal(state_headers(await get({ secret, path: statePath }, StateRoute)), true);
});
const state_headers = (r) => /no-store/.test(r.headers.get("cache-control")) && r.headers.get("set-cookie") === null;

test("mode test : exactement 30 minutes, vu de la page d'OBS (29 min : encore actif ; 31 min : fini) ; une page inactive répond « désactivé » même en mode test", async () => {
  const { page, secret } = await pageWith(({ demoKey }) => [place("aaaaaa", demoKey, "clock")]);
  const statePath = `/overlays/page/${secret}/state`;
  const pageHtml = async () => (await get({ secret, path: `/overlays/page/${secret}` })).text();
  const MIN = 60_000;
  await S.setTest(page.id, "start", Date.now() - 29 * MIN);
  const alive = await (await get({ secret, path: statePath }, StateRoute)).json();
  assert.equal(alive.test, true, "29 minutes après le départ : encore en mode test");
  assert.ok(alive.until - alive.now > 0 && alive.until - alive.now <= 1 * MIN + 2000, "il reste environ une minute");
  assert.match(await pageHtml(), /<html [^>]*data-test="1"/);
  await S.setTest(page.id, "start", Date.now() - 31 * MIN);
  const gone = await (await get({ secret, path: statePath }, StateRoute)).json();
  assert.equal(gone.test, false, "31 minutes après le départ : le mode test s'est arrêté tout seul");
  assert.doesNotMatch(await pageHtml(), /<html [^>]*data-test/);
  // Une page inactive répond « désactivé » sans iframe, même si son mode test court encore.
  await S.setTest(page.id, "start", Date.now());
  await S.setActive(page.id, false);
  const off = await pageHtml();
  assert.match(off, /Cet overlay est désactivé/); assert.doesNotMatch(off, /<iframe/);
  const offState = await (await get({ secret, path: statePath }, StateRoute)).json();
  assert.equal(offState.active, false);
});

test("élément disparu (module retiré) : cadre vide en direct, message en mode test, la page ne casse pas ; sauvegarde de la page conservée", async () => {
  const { page, secret } = await pageWith(({ demoKey }) => [place("aaaaaa", demoKey, "clock"), place("bbbbbb", "ancien-module", "thing", { options: { a: 1 } })]);
  const catalog = await buildCatalog("fr", "fr");
  assert.equal(catalog.has(M.catalogKey("ancien-module", "thing")), false);
  const r = await get({ secret, path: `/overlays/page/${secret}` });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.equal((html.match(/<iframe/g) ?? []).length, 1, "un seul iframe : l'élément disparu est un cadre vide");
  assert.match(html, /data-uid="bbbbbb"/); assert.match(html, /Cet élément n&#39;est plus disponible/);
  // Enregistrer la page depuis l'éditeur ne fait pas disparaître l'élément absent.
  const saved = validatePageInput({ name: "Principale", width: 3440, height: 1440, style: page.style, elements: page.elements }, { catalog, previous: page.elements });
  assert.ok(saved.ok); assert.deepEqual(saved.value.elements.map((e) => e.uid), ["aaaaaa", "bbbbbb"]);
  await S.savePage(page.id, saved.value);
  assert.equal((await S.getPage(page.id)).elements.length, 2);
  // Désinstaller le module d'une instance qui y était : même effet.
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "overlay-demo" } });
  const html2 = await (await get({ secret, path: `/overlays/page/${secret}` })).text();
  assert.equal((html2.match(/<iframe/g) ?? []).length, 0);
});

test("éléments qui échouent (erreur, adresse externe, silence, null) : cadre vide silencieux, rien de secret dans la page ni dans le journal", async () => {
  const lines = [];
  const realErr = console.error, realWarn = console.warn;
  console.error = (...a) => lines.push(a.map(String).join(" ")); console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    const { page, secret, badKey } = await pageWith(({ badKey }) => ["boom", "external", "hang", "nothing", "fine"].map((id, i) => place(`u0000${i}0`, badKey, id)));
    const t0 = Date.now();
    const resolved = await resolvePage(page, { lang: "fr", defaultLocale: "fr" });
    assert.ok(Date.now() - t0 < 3000, "en parallèle, borné par le délai des modules");
    assert.deepEqual(resolved.map((x) => [x.status, x.reason ?? ""]), [["failed", "error"], ["failed", "address"], ["failed", "stalled"], ["failed", "empty"], ["ok", ""]]);
    const html = await (await get({ secret, path: `/overlays/page/${secret}` })).text();
    assert.equal((html.match(/<iframe/g) ?? []).length, 1, "seul l'élément qui marche est chargé");
    assert.doesNotMatch(html, /secret-token-in-message|evil\.example/);
    assert.match(html, new RegExp(`/m/${badKey}/ok\\?k=SECRET-OF-MODULE`), "l'adresse de l'élément, avec le secret du module, est donnée à la page d'OBS");
    assert.ok(!lines.some((l) => l.includes("secret-token-in-message")), "le message d'une erreur de module (qui peut contenir un secret) n'est pas journalisé");
  } finally { console.error = realErr; console.warn = realWarn; }
});

// ── Sauvegarde → restauration ─────────────────────────────────────────────────────────────────────────────────────────────
test("sauvegarde → restauration : pages, éléments, style, état et MÊME adresse secrète ; mode test non sauvegardé ; bornes réappliquées", async () => {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "$2a$12$x", locale: "fr" } });
  await setSetting("setup.completed", true);
  const { demoKey } = await setup();
  const p1 = (await S.createPage({ name: "Principale", width: 3440, height: 1440, style: { text: "dark", background: "soft", corners: "square" } })).page;
  const p2 = (await S.createPage({ name: "Pause", width: 1920, height: 1080 })).page;
  await db.prisma.overlayPage.update({ where: { id: p1.id }, data: { elements: JSON.stringify([place("aaaaaa", demoKey, "clock", { options: { size: 70 } }), place("bbbbbb", "ancien", "x", { visible: false })]), testUntil: new Date(Date.now() + 600_000) } });
  await S.setActive(p2.id, false);
  const secret1 = await S.readSecret(p1.id), secret2 = await S.readSecret(p2.id);
  const backup = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  assert.equal(backup.manifest.counts.overlayPages, 2);
  await S.deletePage(p2.id); await S.renamePage(p1.id, "Autre nom"); await S.resetPageSecret(p1.id);
  const opened = Rs.openBackup(backup.buffer, "un-mot-de-passe-solide", 1000);
  assert.ok(opened.ok, opened.error);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o@example.org" });
  assert.ok(report.ok, JSON.stringify(report));
  const pages = await S.listPages();
  assert.deepEqual(pages.map((p) => [p.name, p.width, p.height, p.active]), [["Principale", 3440, 1440, true], ["Pause", 1920, 1080, false]]);
  const back = pages[0];
  assert.deepEqual(back.style, { text: "dark", background: "soft", corners: "square" });
  assert.deepEqual(back.elements.map((e) => [e.uid, e.instance, e.element, e.visible]), [["aaaaaa", demoKey, "clock", true], ["bbbbbb", "ancien", "x", false]], "l'élément dont le module a disparu est conservé");
  assert.equal(back.elements[0].options.size, 70);
  assert.equal(back.testUntil, null, "le mode test n'est pas sauvegardé");
  assert.equal(await S.readSecret(back.id), secret1); assert.equal(await S.readSecret(pages[1].id), secret2);
  assert.equal((await S.getPageBySecret(Sec.hashSecret(secret1))).id, back.id, "l'adresse collée dans OBS fonctionne encore");
  const raw = fs.readFileSync(path.join(db.dir, "test.db")).toString("latin1");
  void raw;
  // Fichier de sauvegarde forgé : bornes dures réappliquées (20 pages, 10 actives, secrets invalides régénérés, doublons écartés).
  const { fromBackupRows } = await import("@/core/overlays/backup");
  const forged = fromBackupRows(Array.from({ length: 40 }, (_, i) => ({ id: `id${i}`, name: `P${i}`, width: 99999, height: 1, active: true, secret: i === 3 ? "court" : Sec.newSecret(), style: "x", elements: Array.from({ length: 80 }, (_, j) => place(`u${String(j).padStart(6, "0")}`, "a", "b")) })));
  assert.equal(forged.length, 20); assert.equal(forged.filter((p) => p.active).length, 10);
  assert.ok(forged.every((p) => p.width === 7680 && p.height === 320 && JSON.parse(p.elements).length === 30 && /^[0-9a-f]{64}$/.test(p.secretHash)));
  assert.equal(new Set(forged.map((p) => p.secretHash)).size, 20);
  assert.deepEqual(fromBackupRows("pas une liste"), []); assert.deepEqual(fromBackupRows([{ id: 5 }, null, { id: "x", name: "" }]), []);
});

test("sauvegarde : le fichier de pages est dans l'archive et listé parmi les fichiers contrôlés", async () => {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "$2a$12$x" } });
  await S.createPage({ name: "Une", width: 1920, height: 1080 });
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  assert.ok(b.manifest.files.some((f) => f.path === "data/overlay-pages.json"));
  const { readTarGz } = await import("@/core/backup/tar");
  const file = readTarGz(b.plain).find((f) => f.path === "data/overlay-pages.json");
  const rows = JSON.parse(file.content.toString("utf8"));
  assert.equal(rows.length, 1); assert.match(rows[0].secret, Sec.SECRET_RE);
});

// ── Plusieurs lecteurs d'un même élément ─────────────────────────────────────────────────────────────────────────────────
test("multi-lecteurs : le fil du module d'exemple, lu par trois pages à la fois, par la vraie route et le vrai stockage", async () => {
  const { assertMultiReaders } = await import("../../testsupport/overlayElements.mjs");
  const { demoKey } = await setup();
  const mod = await R.getModule("overlay-demo");
  const inst = (await R.getActiveInstances()).find((a) => a.instance.key === demoKey);
  const ctx = await buildContext(mod, inst.instance, "fr");
  const feed = (after) => mod.def.routes.feed(new Request(`http://x/m/${demoKey}/feed?after=${encodeURIComponent(after)}`), ctx).then((r) => r.json());
  await assertMultiReaders({
    publish: async (text) => { await mod.def.adminActions.push(ctx, { text }); await new Promise((r) => setTimeout(r, 3)); },
    open: async () => { let cursor = (await feed("now")).cursor; return { read: async () => { const r = await feed(cursor); cursor = r.cursor; return r.events; } }; },
    readers: 4,
  });
});
