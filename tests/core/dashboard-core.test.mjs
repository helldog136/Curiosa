// TABLEAU DE BORD (logique, sans page) : « À faire », « Ce qui s'est passé », mise en route, santé, visites, actions rapides, blocs par palier.
// Vraie base SQLite, vrai code du cœur ; les pages ne sont pas rendues ici (voir la PR d'intégration).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const A = await import("@/core/dashboard/activity");
const Tdo = await import("@/core/dashboard/todo");
const Su = await import("@/core/dashboard/setup");
const H = await import("@/core/dashboard/health");
const V = await import("@/core/dashboard/visits");
const Q = await import("@/core/dashboard/quick");
const L = await import("@/core/dashboard/layout");
const Rt = await import("@/core/auth/rights");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { parseManifest } = await import("@/core/modules/manifest");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const t = makeTranslator("fr");
const MODULES = ["blog", "pages", "demo-journal"].map((id) => ({ moduleId: id, name: { fr: id, en: id }, rights: [] }));
const CAT = Rt.rightsCatalogue(MODULES);
function user(level, extra = []) {
  return { id: `u-${level}`, email: `${level}@example.org`, name: level, level, roles: [level], rights: new Set([...Rt.systemRights(level, CAT), ...extra]), locale: null, advanced: false, totp: true, passkeys: 0, twoFactor: true, needsTwoFactor: false, mustChangePassword: false };
}
const [owner, coordinator, admin, editor] = ["owner", "coordinator", "admin", "editor"].map((l) => user(l));
const none = user("none");
const NOW = Date.now();
const row = (action, extra = {}) => ({ action, module: "", actor: "someone@example.org", target: "", createdAt: new Date(NOW), level: "info", actorKind: "person", ...extra });
const log = (action, over = {}, ago = 0) => prisma.auditLog.create({ data: { actor: "someone@example.org", actorKind: "person", action, target: "", createdAt: new Date(NOW - ago * 60_000), ...over } });

// ── Ce qui s'est passé ─────────────────────────────────────────────────────────────────────────────────────────────

test("activité : qui peut voir quoi, sans aucun droit élargi", () => {
  const sees = (u, action, module = "") => A.canSeeEvent(u, row(action, { module }));
  // Rédaction : ses contenus et ses liens courts, rien d'autre.
  for (const a of ["entry.create", "entry.update", "redirect.create"]) assert.equal(sees(editor, a), true, a);
  for (const a of ["login", "login.locked", "access.denied", "user.create", "user.role", "settings.update", "home.update", "backup.create", "update.start", "mcp.token.create", "module.install", "appearance.update", "inconnu.action"]) assert.equal(sees(editor, a), false, a);
  // Administration : les réglages et l'apparence ; pas la sécurité, ni les sauvegardes et mises à jour (droits réservés).
  for (const a of ["entry.create", "settings.update", "home.update", "navigation.update", "skin.activate", "module.install", "instance.create", "content.check"]) assert.equal(sees(admin, a), true, a);
  for (const a of ["login", "access.denied", "user.create", "role.update", "backup.create", "update.start", "mcp.token.create", "mcp.maintenance.approve", "security.2fa.require"]) assert.equal(sees(admin, a), false, a);
  // Coordination technique : ce que ses droits réservés ouvrent.
  for (const a of ["backup.create", "update.start", "mcp.maintenance.approve", "login", "user.create", "settings.update", "entry.create"]) assert.equal(sees(coordinator, a), true, a);
  assert.equal(sees(owner, "login"), true);
  // Un compte sans palier ni droit ne voit rien ; avec « modifier les contenus » il voit les contenus.
  assert.equal(sees(none, "entry.create"), false);
  assert.equal(sees(user("none", ["core:entries.edit"]), "entry.create"), true);
  // Une ligne d'extension : le droit « historique » de CETTE extension (administration par défaut).
  assert.equal(sees(admin, "thing.done", "demo-journal"), true);
  assert.equal(sees(editor, "thing.done", "demo-journal"), false);
  assert.equal(sees(user("editor", ["demo-journal:history"]), "thing.done", "demo-journal"), true);
  assert.equal(sees(user("admin", []), "thing.done", "autre-module"), false, "extension inconnue : droit inexistant, refus");
});

test("activité : un compte au mot de passe temporaire ou sans double vérification ne voit rien", () => {
  assert.equal(A.canSeeEvent({ ...owner, mustChangePassword: true }, row("entry.create")), false);
  assert.equal(A.canSeeEvent({ ...owner, needsTwoFactor: true }, row("entry.create")), false);
});

test("activité : mode simple = ce qui parle à une personne non technique", () => {
  const plain = (action, extra, info) => A.isPlain(row(action, extra), info ?? null);
  for (const a of ["entry.create", "entry.delete", "redirect.create", "home.update", "settings.update", "backup.create", "update.start", "module.install", "skin.activate"]) assert.equal(plain(a), true, a);
  for (const a of ["login", "login.passkey", "access.denied", "entry.update", "user.create", "mcp.token.create", "service.routing", "instance.settings", "module.enable", "unknown.thing"]) assert.equal(plain(a), false, a);
  assert.equal(plain("thing.done", { module: "m" }, { declared: true, frequent: false }), true);
  assert.equal(plain("hit", { module: "m" }, { declared: true, frequent: true }), false, "événement très fréquent : mode avancé");
  assert.equal(plain("whatever", { module: "m" }, { declared: false, frequent: false }), false, "ligne générique sans données : mode avancé");
  assert.equal(plain("whatever", { module: "m", level: "error" }, { declared: false, frequent: false }), true, "une erreur se voit toujours");
  assert.equal(plain("thing.done", { module: "m", actorKind: "assistant" }, { declared: true, frequent: false }), false);
});

test("activité : la même action sur la même chose dans l'heure ne fait qu'une ligne", () => {
  const at = (min) => new Date(NOW - min * 60_000);
  const rows = [
    { action: "entry.update", actor: "a@x", target: "Mon article", module: "", createdAt: at(1) },
    { action: "entry.update", actor: "a@x", target: "Mon article", module: "", createdAt: at(5) },
    { action: "entry.update", actor: "a@x", target: "Autre", module: "", createdAt: at(6) },
    { action: "entry.update", actor: "b@x", target: "Mon article", module: "", createdAt: at(7) },
    { action: "entry.update", actor: "a@x", target: "Mon article", module: "", createdAt: at(90) },
  ];
  assert.deepEqual(A.collapse(rows).map((r) => [r.actor, r.target, NOW - r.createdAt.getTime()]).map(([a, b, c]) => [a, b, Math.round(c / 60000)]), [["a@x", "Mon article", 1], ["a@x", "Autre", 6], ["b@x", "Mon article", 7], ["a@x", "Mon article", 90]]);
});

async function seedJournal() {
  await db.fixture("demo-journal");
  const parsed = parseManifest(JSON.parse(fs.readFileSync("tests/fixtures/extras/modules/demo-journal/module.json", "utf8")));
  await createInstance(prisma, { manifest: parsed.manifest, names: { en: "journal" } });
  await log("login", {}, 0);
  await log("entry.create", { target: "Bonjour" }, 1);
  await log("settings.update", {}, 2);
  await log("backup.create", {}, 3);
  await log("user.create", { target: "x@y.z" }, 4);
  await log("thing.done", { module: "demo-journal", instance: "journal", actor: "module:demo-journal", actorKind: "module", data: JSON.stringify({ name: "Alpha", count: 2, urgent: true }) }, 5);
  await log("hit", { module: "demo-journal", instance: "journal", actor: "module:demo-journal", actorKind: "module", data: JSON.stringify({ name: "Beta" }) }, 6);
  await log("entry.update", { target: "Bonjour" }, 7);
}
const opts = (advanced) => ({ t, locale: "fr", defaultLocale: "fr", advanced });

test("activité : phrases en clair, plus récent d'abord, filtrées par droits et par mode", async () => {
  await seedJournal();
  const sentences = async (u, advanced) => (await A.recentActivity(u, opts(advanced))).lines.map((l) => l.code);
  assert.deepEqual(await sentences(owner, true), ["login", "entry.create", "settings.update", "backup.create", "user.create", "thing.done", "hit", "entry.update"]);
  assert.deepEqual(await sentences(owner, false), ["entry.create", "settings.update", "backup.create", "thing.done"], "mode simple : ni connexion, ni compte, ni événement fréquent, ni enregistrement répété");
  assert.deepEqual(await sentences(editor, true), ["entry.create", "entry.update"]);
  assert.deepEqual(await sentences(admin, true), ["entry.create", "settings.update", "thing.done", "hit", "entry.update"]);
  assert.deepEqual(await sentences(none, true), []);
  const lines = (await A.recentActivity(owner, opts(false))).lines;
  const thing = lines.find((l) => l.code === "thing.done");
  assert.match(thing.sentence, /Chose faite : Alpha/, "la phrase de l'extension, avec ses champs");
  assert.equal(thing.kind, "module");
  assert.ok(lines.every((l, i) => i === 0 || l.when <= lines[i - 1].when), "du plus récent au plus ancien");
});

test("activité : le Journal d'audit complet n'est proposé qu'à qui y a droit", async () => {
  assert.equal((await A.recentActivity(owner, opts(false))).fullJournal, true);
  assert.equal((await A.recentActivity(coordinator, opts(false))).fullJournal, true);
  assert.equal((await A.recentActivity(admin, opts(false))).fullJournal, false);
  assert.equal((await A.recentActivity(editor, opts(false))).fullJournal, false);
});

test("activité : 10 lignes au plus, et on cherche plus loin quand le début est filtré", async () => {
  for (let i = 0; i < 60; i++) await log("login", {}, i);
  for (let i = 0; i < 15; i++) await log("entry.create", { target: `Article ${i}` }, 100 + i);
  const r = await A.recentActivity(editor, opts(false));
  assert.equal(r.lines.length, 10, "les 60 connexions sont passées, les 10 plus récentes créations sont trouvées");
  assert.equal(r.lines[0].target, "Article 0");
  assert.equal((await A.recentActivity(editor, { ...opts(false), limit: 3 })).lines.length, 3);
  assert.equal((await A.recentActivity(editor, { ...opts(false), limit: 99 })).lines.length, 10, "jamais plus de 10");
});

test("activité : sans rien au journal, une liste vide (jamais d'erreur)", async () => {
  assert.deepEqual((await A.recentActivity(owner, opts(true))).lines, []);
});

// ── À faire ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function content(id, nickname) {
  await db.fixture(id);
  const manifest = FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
  return createInstance(db.prisma, { manifest, names: { en: nickname, fr: nickname }, nickname });
}
const navOf = (i, name, extra = {}) => ({ id: i.id, key: i.key, name, icon: "📝", content: true, error: false, badge: 0, moduleId: "x", ...extra });

test("à faire : les brouillons avec leurs titres, du plus récemment modifié au plus ancien", async () => {
  const blog = await content("blog", "blog"), pages = await content("pages", "pages");
  await createEntry(prisma, { instanceId: blog.id, locale: "en", title: "Publié", status: "published" });
  const old = await createEntry(prisma, { instanceId: blog.id, locale: "en", title: "Vieux brouillon", status: "draft" });
  await prisma.entry.update({ where: { id: old.id }, data: { updatedAt: new Date(NOW - 86400_000) } });
  await createEntry(prisma, { instanceId: pages.id, locale: "en", title: "Page à finir", status: "draft" });
  const env = { locale: "fr", defaultLocale: "en", nav: [navOf(blog, "Blog"), navOf(pages, "Pages")] };
  const d = await Tdo.draftsToFinish(env);
  assert.equal(d.total, 2);
  assert.deepEqual(d.rows.map((r) => [r.title, r.detail]), [["Page à finir", "Pages"], ["Vieux brouillon", "Blog"]]);
  assert.match(d.rows[0].href, /^\/admin\/entries\/[A-Za-z0-9]+$/);
  assert.equal(d.byKey.get(blog.key), 1);
  // Une extension en erreur, sans liste ou retirée n'est jamais comptée (on ne pourrait pas retrouver ses brouillons).
  assert.equal((await Tdo.draftsToFinish({ ...env, nav: [navOf(blog, "Blog", { error: true }), navOf(pages, "Pages", { content: false })] })).total, 0);
  assert.equal((await Tdo.draftsToFinish({ ...env, nav: [] })).total, 0);
  assert.equal((await Tdo.draftsToFinish(env, 1)).rows.length, 1, "le nombre de lignes est borné");
});

test("à faire : une tâche n'apparaît que pour qui peut agir dessus", async () => {
  const blog = await content("blog", "blog");
  await createEntry(prisma, { instanceId: blog.id, locale: "en", title: "Brouillon", status: "draft" });
  const nav = [navOf(blog, "Blog"), { id: "m1", key: "reviews", name: "Avis", icon: "⭐", content: false, error: false, badge: 3, moduleId: "reviews" }];
  const base = { t, locale: "fr", defaultLocale: "en", nav };
  const ids = async (u) => (await Tdo.loadCoreTodo({ ...base, user: u })).map((i) => i.id);
  const editorIds = await ids(editor);
  assert.ok(editorIds.includes("drafts"));
  assert.ok(!editorIds.some((i) => /^(backup|update|ai)/.test(i)), "une rédaction ne voit ni sauvegarde, ni mises à jour, ni assistants");
  assert.ok(editorIds.includes("badge-m1"));
  const ownerIds = await ids(owner);
  assert.ok(ownerIds.includes("drafts") && ownerIds.includes("backup"), "le propriétaire voit aussi la sauvegarde jamais faite");
  assert.deepEqual(await ids(none), ["badge-m1"], "sans droit sur les contenus : pas de brouillons");
});

test("à faire : les brouillons montrent leurs titres et mènent à la liste réglée sur les brouillons", async () => {
  const blog = await content("blog", "blog");
  await createEntry(prisma, { instanceId: blog.id, locale: "en", title: "Mon brouillon", status: "draft" });
  const items = await Tdo.loadCoreTodo({ t, user: editor, locale: "fr", defaultLocale: "en", nav: [navOf(blog, "Blog")] });
  const d = items.find((i) => i.id === "drafts");
  assert.equal(d.label, "1 brouillon à finir");
  assert.equal(d.rows[0].title, "Mon brouillon");
  assert.equal(d.href, "/admin/drafts");
  assert.equal((await Tdo.loadCoreTodo({ t, user: editor, locale: "fr", defaultLocale: "en", nav: [navOf(blog, "Blog")], skipDrafts: true })).some((i) => i.id === "drafts"), false, "le bloc « À finir » les montre déjà");
});

test("à faire : la sauvegarde jamais faite, puis faite, puis trop ancienne", async () => {
  const ids = async () => (await Tdo.loadCoreTodo({ t, user: owner, locale: "fr", defaultLocale: "en", nav: [] })).find((i) => i.id === "backup");
  assert.match((await ids()).label, /première sauvegarde/);
  await log("backup.create", {}, 60);
  assert.equal(await ids(), undefined, "faite il y a une heure : rien à faire");
  await prisma.auditLog.deleteMany({});
  await log("backup.create", {}, 60 * 24 * 10);
  assert.match((await ids()).label, /nouvelle sauvegarde/);
});

test("à faire : les extensions à régler et les tâches d'extensions se placent à la suite du cœur", async () => {
  const items = await Tdo.loadCoreTodo({ t, user: admin, locale: "fr", defaultLocale: "en", nav: [], toSetUp: [{ id: "i9", name: "Discord", icon: "💬", summary: "il manque le lien d'invitation" }] });
  assert.deepEqual(items.map((i) => [i.kind, i.label, i.href]).filter(([k]) => k === "setup"), [["setup", "Discord est à régler", "/admin/instances/i9"]]);
  const merged = Tdo.mergeTodo(items, [{ moduleId: "reviews", id: "pending", icon: "⭐", label: "3 avis à valider", n: 3, href: "/admin/instances/i1?tab=pending" }]);
  assert.equal(merged.at(-1).kind, "module");
  assert.equal(merged.at(-1).count, 3);
});

// ── Mise en route ──────────────────────────────────────────────────────────────────────────────────────────────────

test("mise en route : calculée, progression, disparaît quand tout est fait ou quand on la masque", () => {
  const none = { nameChosen: false, taglineWritten: false, logoSent: false, pagePublished: false, socialAdded: false, lookChosen: false };
  const fresh = Su.evaluateSetup(none, false);
  assert.deepEqual([fresh.done, fresh.total, fresh.percent, fresh.visible], [0, 6, 0, true]);
  assert.deepEqual(fresh.steps.map((s) => s.id), ["name", "tagline", "logo", "page", "social", "look"]);
  const half = Su.evaluateSetup({ ...none, nameChosen: true, logoSent: true, pagePublished: true }, false);
  assert.deepEqual([half.done, half.percent, half.visible], [3, 50, true]);
  assert.equal(Su.evaluateSetup({ ...none, nameChosen: true }, true).visible, false, "masquée par la personne");
  const all = Su.evaluateSetup(Object.fromEntries(Object.keys(none).map((k) => [k, true])), false);
  assert.deepEqual([all.complete, all.visible, all.percent], [true, false, 100]);
  assert.ok(fresh.steps.every((s) => s.href.startsWith("/admin/")));
});

test("mise en route : les faits viennent du site, et seule l'administration la voit et la masque", async () => {
  const facts = () => Su.loadSetupFacts({ contentInstanceIds: [], locale: "fr" });
  assert.deepEqual(await facts(), { nameChosen: false, taglineWritten: false, logoSent: false, pagePublished: false, socialAdded: false, lookChosen: false });
  await setSetting("site.name", "Mon site", "fr");
  await setSetting("site.tagline", "Une accroche", "fr");
  await setSetting("site.logo", "/uploads/logo.png");
  await setSetting("theme.accent", "#ff0000");
  const blog = await content("blog", "blog");
  await createEntry(prisma, { instanceId: blog.id, locale: "en", title: "Hop", status: "published" });
  const f = await Su.loadSetupFacts({ contentInstanceIds: [blog.id], locale: "fr" });
  assert.deepEqual([f.nameChosen, f.taglineWritten, f.logoSent, f.pagePublished, f.lookChosen], [true, true, true, true, true]);
  assert.equal((await Su.loadSetupFacts({ contentInstanceIds: [blog.id], locale: "fr" })).pagePublished, true);
  assert.equal(Su.canSeeSetup(admin), true);
  assert.equal(Su.canSeeSetup(editor), false);
  assert.equal(await Su.setSetupHidden(editor, true), false);
  assert.equal((await Su.loadSetup({ contentInstanceIds: [], locale: "fr" })).hidden, false);
  assert.equal(await Su.setSetupHidden(admin, true), true);
  assert.equal((await Su.loadSetup({ contentInstanceIds: [], locale: "fr" })).hidden, true);
  assert.equal(await Su.setSetupHidden(admin, false), true);
  assert.equal((await Su.loadSetup({ contentInstanceIds: [], locale: "fr" })).hidden, false);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "settings.update", target: "dashboard.setup.hide" } }), "le choix est noté au journal");
});

// ── Santé ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test("santé : une pastille, « tout va bien » ou des points, chacun avec son écran", () => {
  const good = { glance: { databaseOk: true, disk: "ok", instancesSetAside: 0, updateFailed: false, backup: { at: "2026-10-30T10:00:00Z", recent: true } }, contentLook: false };
  assert.deepEqual(H.summarize(H.healthPoints(owner, good, t)), { points: [], ok: true, problems: 0 });
  const bad = { glance: { databaseOk: false, disk: "critical", instancesSetAside: 2, updateFailed: true, backup: { at: null, recent: false } }, contentLook: true };
  const ownerHealth = H.summarize(H.healthPoints(owner, bad, t));
  assert.deepEqual(ownerHealth.points.map((p) => p.id), ["database", "disk", "update", "backup", "instances", "content"]);
  assert.equal(ownerHealth.problems, 4);
  assert.equal(ownerHealth.points.find((p) => p.id === "instances").href, "/admin/extensions");
  assert.equal(ownerHealth.points.find((p) => p.id === "disk").href, "/admin#storage", "le disque plein mène à la carte Stockage, qui dit quoi faire");
  // Une rédaction ne voit pas la santé technique.
  assert.deepEqual(H.healthPoints(editor, bad, t), []);
  // L'administration voit les extensions mises de côté et le contrôle du contenu, pas la sauvegarde ni les mises à jour.
  assert.deepEqual(H.healthPoints(admin, bad, t).map((p) => p.id), ["instances", "content"]);
  // Coordination technique : base, disque, mise à jour, sauvegarde, extensions.
  assert.ok(H.healthPoints(coordinator, bad, t).some((p) => p.id === "update" && p.href === "/admin/updates"));
});

test("santé : lue sur un site neuf sans erreur", async () => {
  const h = await H.loadHealth(owner, t);
  assert.ok(h.points.every((p) => ["backup", "disk"].includes(p.id)) || h.ok, "sur un site neuf, au plus la sauvegarde jamais faite");
  assert.equal((await H.loadHealth(editor, t)).ok, true);
});

// ── Visites ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("visites : l'évolution contre la période d'avant, sans pourcentage quand il n'y avait rien", () => {
  assert.equal(V.compare({ visitors: 150, views: 0 }, { visitors: 100, views: 0 }).change, 50);
  assert.equal(V.compare({ visitors: 50, views: 0 }, { visitors: 100, views: 0 }).change, -50);
  assert.equal(V.compare({ visitors: 10, views: 0 }, { visitors: 0, views: 0 }).change, null);
  assert.equal(V.compare({ visitors: 150, views: 0 }, { visitors: 100, views: 0 }, false).change, null, "historique trop court");
});

test("visites : le préfixe de langue se sépare du chemin", () => {
  assert.deepEqual(V.splitLocale("/en/blog/mon-article"), { locale: "en", path: "/blog/mon-article" });
  assert.deepEqual(V.splitLocale("/fr"), { locale: "fr", path: "/" });
  assert.deepEqual(V.splitLocale("/blog/x"), { locale: null, path: "/blog/x" });
  assert.deepEqual(V.splitLocale("/zz/blog"), { locale: null, path: "/zz/blog" }, "deux lettres qui ne sont pas une langue");
});

const day = (ago) => { const d = new Date(NOW); d.setDate(d.getDate() - ago); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const visitsOn = (ago, visitors, kind = "site", key = "") => prisma.visitDaily.create({ data: { day: day(ago), kind, key, views: visitors * 2, visitors } });

test("visites : 7 et 30 jours contre les périodes d'avant", async () => {
  assert.equal((await V.visitsOverview(new Date(NOW))).empty, true);
  for (let i = 0; i < 7; i++) await visitsOn(i, 20);        // 7 derniers jours : 140
  for (let i = 7; i < 14; i++) await visitsOn(i, 10);       // 7 jours d'avant : 70
  for (let i = 14; i < 60; i++) await visitsOn(i, 5);       // reste : 5 par jour
  const o = await V.visitsOverview(new Date(NOW));
  assert.equal(o.empty, false);
  assert.deepEqual([o.week.current.visitors, o.week.previous.visitors, o.week.change, o.week.comparable], [140, 70, 100, true]);
  assert.equal(o.month.current.visitors, 140 + 70 + 5 * 16);
  assert.equal(o.month.previous.visitors, 5 * 30);
  assert.equal(o.today.visitors, 20);
  assert.equal(o.days.length, 30);
  assert.equal(o.days.at(-1).visitors, 20);
});

test("visites : un site qui a moins de deux périodes d'historique ne montre pas de pourcentage", async () => {
  for (let i = 0; i < 10; i++) await visitsOn(i, 10);
  const o = await V.visitsOverview(new Date(NOW));
  assert.equal(o.week.comparable, false);
  assert.equal(o.week.change, null);
  assert.equal(o.month.comparable, false);
});

test("visites : les pages les plus lues portent leur titre, pas leur adresse", async () => {
  const blog = await content("blog", "blog");
  const e = await createEntry(prisma, { instanceId: blog.id, locale: "en", title: "Mon premier article", status: "published", slug: "mon-premier" });
  const slug = (await prisma.entryTranslation.findFirst({ where: { entryId: e.id } })).slug;
  const base = blog.basePath;
  await visitsOn(0, 9, "site");
  await visitsOn(0, 8, "page", "/");
  await visitsOn(0, 7, "page", `/${base}/${slug}`);
  await visitsOn(0, 6, "page", `/${base}`);
  await visitsOn(0, 5, "page", `/en/${base}/${slug}`);
  await visitsOn(0, 4, "page", "/page-inconnue");
  const top = await V.topPagesTitled({ t, locale: "fr", defaultLocale: "en", limit: 8 });
  const byPath = Object.fromEntries(top.map((p) => [p.path, p]));
  assert.equal(byPath["/"].title, "Accueil");
  assert.equal(byPath[`/${base}/${slug}`].title, "Mon premier article");
  assert.equal(byPath[`/en/${base}/${slug}`].title, "Mon premier article");
  assert.equal(byPath[`/${base}`].title, "blog", "la page de l'extension porte son nom");
  assert.deepEqual([byPath["/page-inconnue"].title, byPath["/page-inconnue"].known], ["/page-inconnue", false], "une adresse inconnue reste lisible, sans rien inventer");
  assert.ok(top.every((p, i) => i === 0 || p.views <= top[i - 1].views));
});

test("visites : les liens courts les plus cliqués par destination, seulement si « compter les clics » est activé", async () => {
  const r1 = await prisma.redirect.create({ data: { path: "insta", targetUrl: "https://instagram.com/moi", hits: 40 } });
  const r2 = await prisma.redirect.create({ data: { path: "ig", targetUrl: "https://www.instagram.com/moi/?utm_source=x", hits: 10 } });
  const r3 = await prisma.redirect.create({ data: { path: "yt", targetUrl: "https://youtube.com/@moi", hits: 5 } });
  const dayStr = day(0);
  for (const [r, n] of [[r1, 40], [r2, 10], [r3, 5]]) await prisma.redirectDay.create({ data: { redirectId: r.id, day: dayStr, hits: n } });
  assert.deepEqual(await V.topLinks(), { enabled: false, links: [] });
  await setSetting("redirects.measureLinks", true);
  const out = await V.topLinks();
  assert.equal(out.enabled, true);
  assert.equal(out.links.length, 2);
  assert.match(out.links[0].destination, /instagram\.com\/moi/);
  assert.deepEqual([out.links[0].month, out.links[0].shortLinks], [50, ["/insta", "/ig"]], "deux liens courts, une seule destination, les plus cliqués d'abord");
  assert.deepEqual([out.links[1].month, out.links[1].shortLinks], [5, ["/yt"]]);
});

// ── Créer, blocs par palier ────────────────────────────────────────────────────────────────────────────────────────

test("créer : les extensions d'abord, le cœur pour le reste, filtré par droits, sans doublon", () => {
  const nav = [{ id: "i1", key: "blog", name: "Blog", icon: "📰", content: true, error: false, badge: 0, moduleId: "blog" }, { id: "i2", key: "pages", name: "Pages", icon: "📄", content: true, error: false, badge: 0, moduleId: "pages" }, { id: "i3", key: "x", name: "En erreur", icon: "⚠️", content: true, error: true, badge: 0, moduleId: "x" }];
  const declared = [{ moduleId: "blog", instanceId: "i1", id: "write", icon: "✍️", label: "Écrire un article", href: "/admin/entries/new?c=blog", moduleName: "Blog", instanceKey: "blog", instanceName: "Blog", several: false }];
  const core = Q.coreQuickActions({ user: owner, t, advanced: false, nav, declared });
  assert.deepEqual(core.map((a) => a.id), ["add-i2", "short-link"], "Blog a déclaré sa propre action ; l'extension en erreur est ignorée ; « Ajouter une extension » est pour le mode avancé");
  const all = Q.mergeQuick(declared, core);
  assert.deepEqual(all.map((a) => a.label), ["Écrire un article", "Ajouter dans Pages", "Créer un lien court"]);
  assert.ok(Q.coreQuickActions({ user: owner, t, advanced: true, nav, declared }).some((a) => a.id === "extension"));
  assert.ok(!Q.coreQuickActions({ user: editor, t, advanced: true, nav, declared }).some((a) => a.id === "extension"), "l'ajout d'extension est réservé à l'administration");
  assert.deepEqual(Q.coreQuickActions({ user: none, t, advanced: false, nav, declared }), []);
  // Même adresse : une seule fois ; au plus 6.
  const dup = Q.mergeQuick([{ ...declared[0], href: "/admin/redirects" }], core);
  assert.equal(dup.filter((a) => a.href === "/admin/redirects").length, 1);
  const lots = Array.from({ length: 10 }, (_, k) => ({ id: `a${k}`, icon: "x", label: `L${k}`, href: `/admin/x${k}`, from: "core" }));
  assert.equal(Q.mergeQuick([], lots).length, 6);
});

test("blocs : le journal (ce qui s'est passé) est le dernier bloc, dans tous les modes et pour tous les paliers", () => {
  for (const u of [owner, admin, coordinator, editor, none]) for (const adv of [false, true]) {
    const b = L.dashboardPlan(u, adv).blocks;
    assert.equal(b.at(-1), "activity");
    assert.equal(b.filter((x) => x === "activity").length, 1);
  }
  assert.equal(L.BLOCKS.at(-1), "activity");
});

test("blocs : chaque palier voit les siens, le mode simple en a moins", () => {
  const plan = (u, advanced) => L.dashboardPlan(u, advanced);
  assert.deepEqual(plan(editor, false).blocks, ["todo", "drafts", "create", "visits", "modules", "numbers", "activity"]);
  assert.deepEqual(plan(coordinator, false).blocks, ["health", "todo", "modules", "numbers", "storage", "activity"]);
  assert.deepEqual(plan(admin, false).blocks, ["setup", "health", "todo", "drafts", "create", "visits", "modules", "numbers", "storage", "activity"]);
  assert.deepEqual(plan(owner, true).blocks, plan(admin, false).blocks);
  assert.deepEqual(plan(none, true).blocks, ["todo", "drafts", "create", "modules", "numbers", "activity"]);
  assert.deepEqual([plan(admin, false).cards, plan(admin, true).cards], [2, 4]);
  assert.ok(!plan(editor, true).blocks.includes("setup") && !plan(editor, true).blocks.includes("health"));
  for (const u of [owner, admin, coordinator, editor, none]) for (const adv of [false, true]) assert.ok(L.dashboardPlan(u, adv).blocks.every((b) => L.BLOCKS.includes(b)));
});

test("textes : toutes les clés du tableau de bord existent en français et en anglais, avec les mêmes variables", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = Object.keys(fr).filter((k) => k.startsWith("dash."));
  assert.ok(keys.length > 20);
  for (const k of keys) {
    assert.ok(k in en, `${k} manque en anglais`);
    assert.deepEqual([...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k);
    assert.doesNotMatch(fr[k] + en[k], /!/, `${k} : pas de point d'exclamation`);
  }
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith("dash.") && !(k in fr)), []);
});
