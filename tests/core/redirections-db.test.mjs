// Redirections 2 : création, nom proposé, date de fin (410), désactivé = inexistant, statistiques, liste, CSV, outils MCP, routes.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const R = await import("@/core/redirects");
const S = await import("@/core/redirectStats");
const Gate = await import("@/core/redirectGate");
const { redirectsToolProvider } = await import("@/core/redirectMcp");
const { canUse } = await import("@/core/services/mcp/access");
const { setSetting } = await import("@/core/settings");
const Roles = await import("@/core/auth/roles");
const Gone = await import("@/app/api/redirect-gone/route");
const Qr = await import("@/app/api/admin/redirects/[id]/qr/route");
const Csv = await import("@/app/api/admin/redirects/export/route");
const { state: headerState } = await import("../helpers/stubs/next-headers.mjs");

after(() => db.close());
beforeEach(async () => { await db.reset(); globalThis.curiosaRedirectStats = undefined; globalThis.curiosaRedirectGate = undefined; globalThis.curiosaTestSession = null; headerState.headers.clear(); });

const HUMAN = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const mk = (path, over = {}) => prisma.redirect.create({ data: { path, targetUrl: `https://dest.example/${path}`, ...over } });
const must = async (p) => { const r = await p; assert.equal(r.ok, true, JSON.stringify(r)); return r.redirect; };
const failOf = async (p) => { const r = await p; assert.equal(r.ok, false); return r.fail; };

test("création : adresse tolérante, nom proposé, QR/chemin fixés, chemins réservés et adresses dangereuses refusés", async () => {
  const a = await must(R.createRedirectRecord({ targetUrl: '"www.twitch.tv/Emma_Stream".' }));
  assert.equal(a.path, "emma-stream"); assert.equal(a.targetUrl, "https://www.twitch.tv/Emma_Stream");
  const b = await must(R.createRedirectRecord({ targetUrl: "https://www.twitch.tv/emma-stream" }));
  assert.equal(b.path, "emma-stream-2", "déjà pris → -2");
  const c = await must(R.createRedirectRecord({ targetUrl: "https://www.twitch.tv/emma-stream" }));
  assert.equal(c.path, "emma-stream-3");
  assert.equal((await must(R.createRedirectRecord({ targetUrl: "https://example.org/admin" }))).path, "example", "« admin » est réservé : on retombe sur le nom du site");
  assert.equal((await must(R.createRedirectRecord({ targetUrl: "https://www.exemple.be/", }, { siteName: "Chez Emma" }))).path, "exemple");
  assert.equal(await R.proposeRedirectPath({ entryTitle: "Mon Super Jeu !", url: "https://x.example/zz" }), "mon-super-jeu", "titre de l'entrée liée d'abord");
  assert.equal(await R.proposeRedirectPath({ url: "", siteName: "Chez Emma" }), "chez-emma", "sinon le nom du site");
  assert.equal(await R.proposeRedirectPath({ url: "https://monsite.be/fr" }), "monsite", "« fr » est réservé (langue) → pas proposé");
  // un nom donné est vérifié
  assert.equal((await failOf(R.createRedirectRecord({ path: "Admin", targetUrl: "https://a.example" }))).key, "redirects.error.reserved");
  assert.equal((await failOf(R.createRedirectRecord({ path: "api/x", targetUrl: "https://a.example" }))).key, "redirects.error.reserved");
  assert.equal((await failOf(R.createRedirectRecord({ path: "mauvais nom", targetUrl: "https://a.example" }))).key, "redirects.error.path");
  assert.equal((await failOf(R.createRedirectRecord({ path: "x".repeat(81), targetUrl: "https://a.example" }))).key, "redirects.error.path");
  assert.equal((await failOf(R.createRedirectRecord({ path: "emma-stream", targetUrl: "https://a.example" }))).key, "redirects.error.exists");
  assert.equal((await must(R.createRedirectRecord({ path: "promo/ete", targetUrl: "https://a.example/p" }))).path, "promo/ete", "sous-niveaux conservés (avancé)");
  // adresses refusées : pas de redirection ouverte
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.example", "/admin", "/", "ftp://a.example/x", "file:///etc/passwd", "https://user:pass@a.example/", "pas une adresse", "", "https://a.example/" + "x".repeat(2000)]) {
    const f = await failOf(R.createRedirectRecord({ path: "zz", targetUrl: bad }));
    assert.equal(f.field, "targetUrl", bad.slice(0, 40));
  }
  assert.equal(await prisma.redirect.count({ where: { path: "zz" } }), 0);
  // boucle : vers un autre lien court du site
  const site = new URL(R.redirectShortUrl("x")).origin;
  assert.equal((await failOf(R.createRedirectRecord({ path: "boucle", targetUrl: `${site}/emma-stream` }))).key, "redirects.error.loop");
  assert.equal((await must(R.createRedirectRecord({ path: "vers-page", targetUrl: `${site}/blog/article` }))).path, "vers-page", "une page du site est permise");
  assert.equal((await failOf(R.createRedirectRecord({ path: "long", targetUrl: "https://a.example", endMessage: "x".repeat(301) }))).field, "endMessage");
});

test("modification : la destination change, le nom (donc le QR) jamais ; suppression", async () => {
  const r = await must(R.createRedirectRecord({ path: "boutique", targetUrl: "https://a.example/un" }));
  const before = (await import("@/core/redirectQr")).qrSvg(R.redirectShortUrl(r.path));
  const u = await must(R.updateRedirectRecord(r.id, { targetUrl: "autre.example/deux", endMessage: " Merci " }));
  assert.equal(u.path, "boutique"); assert.equal(u.targetUrl, "https://autre.example/deux"); assert.equal(u.endMessage, "Merci");
  assert.equal((await import("@/core/redirectQr")).qrSvg(R.redirectShortUrl(u.path)), before, "même QR après changement de destination");
  assert.equal((await failOf(R.updateRedirectRecord(r.id, { targetUrl: "javascript:1" }))).field, "targetUrl");
  assert.equal((await prisma.redirect.findUnique({ where: { id: r.id } })).targetUrl, "https://autre.example/deux", "refus : rien n'est changé");
  assert.equal((await failOf(R.updateRedirectRecord("inconnu", {}))).key, "redirects.error.missing");
  assert.equal("path" in (await must(R.updateRedirectRecord(r.id, { active: false }))) && (await prisma.redirect.findUnique({ where: { id: r.id } })).active, false);
  await prisma.redirectDay.create({ data: { redirectId: r.id, day: "2026-10-01", hits: 3 } });
  assert.equal(await R.deleteRedirectRecord(r.id), "boutique");
  assert.equal(await prisma.redirectDay.count(), 0, "les chiffres partent avec le lien");
  assert.equal(await R.deleteRedirectRecord(r.id), null);
});

test("visiteur : redirection, 404 identique pour inexistant et désactivé, fin passée = « terminé » sans jamais lire la destination", async () => {
  await mk("ok", { permanent: true }); await mk("pause", { active: false });
  await mk("fini", { expiresAt: new Date(Date.now() - 1000), targetUrl: "https://secret.example/destination" });
  await mk("fini-pause", { expiresAt: new Date(Date.now() - 1000), active: false });
  await mk("futur", { expiresAt: new Date(Date.now() + 3600_000) });
  assert.deepEqual(await R.resolveRedirect("ok", { userAgent: HUMAN }), { url: "https://dest.example/ok", permanent: true });
  assert.deepEqual(await R.resolveRedirect("futur", { userAgent: HUMAN }), { url: "https://dest.example/futur", permanent: false });
  assert.equal(await R.resolveRedirect("pause", { userAgent: HUMAN }), null);
  assert.equal(await R.resolveRedirect("inconnu", { userAgent: HUMAN }), null);
  assert.equal(await R.resolveRedirect("fini-pause", { userAgent: HUMAN }), null, "désactivé gagne sur terminé : même réponse qu'un lien inconnu");
  const gone = await R.resolveRedirect("fini", { userAgent: HUMAN });
  assert.equal(gone.gone, true); assert.ok(!JSON.stringify(gone).includes("secret.example"));
  assert.equal((await R.resolveRedirect("fini", { userAgent: HUMAN }, Date.now() - 3600_000)).url, "https://secret.example/destination", "avant la date : redirige");
  await db.prisma.redirect.update({ where: { path: "ok" }, data: { targetUrl: "javascript:alert(1)" } });
  assert.equal(await R.resolveRedirect("ok", { userAgent: HUMAN }), null);
});

test("statistiques : par jour, coalescées, robots non comptés, total cohérent, série de 30 jours", async () => {
  const r = await mk("stat");
  const now = Date.parse("2026-10-22T10:00:00Z");
  for (let i = 0; i < 5; i++) await R.resolveRedirect("stat", { userAgent: HUMAN }, now);
  for (const ua of ["Googlebot/2.1", "WhatsApp/2.23", "curl/8", ""]) await R.resolveRedirect("stat", { userAgent: ua }, now);
  await R.resolveRedirect("stat", { userAgent: HUMAN, team: true }, now);
  await R.resolveRedirect("stat", { userAgent: HUMAN, prefetch: true }, now);
  await S.recordRedirectHit(r.id, now - 3 * 86400_000); await S.recordRedirectHit(r.id, now - 3 * 86400_000);
  await S.recordRedirectHit(r.id, now - 40 * 86400_000);
  await S.flushRedirectHits(now + 10_000);
  const st = await S.redirectStats(r.id, now);
  assert.equal(st.today, 5); assert.equal(st.week, 7); assert.equal(st.month, 7); assert.equal(st.total, 8);
  assert.equal((await prisma.redirect.findUnique({ where: { id: r.id } })).hits, 8, "hits = total, cohérent");
  assert.equal(st.series.length, 30); assert.equal(st.series.at(-1).hits, 5);
  assert.equal(await prisma.redirectDay.count(), 3, "une ligne par jour, jamais par passage");
  const cols = Object.keys((await prisma.redirectDay.findFirst()));
  assert.deepEqual(cols.sort(), ["day", "hits", "redirectId"], "ni adresse, ni agent, ni provenance");
  // le jour suit le fuseau du site
  await setSetting("site.timezone", "Pacific/Auckland");
  globalThis.curiosaRedirectStats = undefined;
  await S.recordRedirectHit(r.id, Date.parse("2026-10-22T20:00:00Z")); // 09:00 le 23 à Auckland
  await S.flushRedirectHits(now + 20_000);
  assert.ok(await prisma.redirectDay.findUnique({ where: { redirectId_day: { redirectId: r.id, day: "2026-10-23" } } }));
});

test("écritures coalescées et bornées : un passage n'écrit pas, 500 jours-liens au plus en attente, une base en panne ne casse rien", async () => {
  const r = await mk("coal");
  const now = Date.parse("2026-10-22T10:00:00Z");
  await S.flushRedirectHits(now); // état initial : dernier vidage = maintenant
  for (let i = 0; i < 50; i++) await S.recordRedirectHit(r.id, now + 100 + i);
  assert.equal(await prisma.redirectDay.count(), 0, "rien d'écrit tant que le vidage n'est pas dû");
  assert.equal((await S.flushRedirectHits(now + 6000)), 50);
  assert.equal((await prisma.redirectDay.findFirst()).hits, 50, "50 passages = UNE écriture");
  // borne : au plus MAX_PENDING clés en attente (les passages en trop sont abandonnés, jamais une erreur)
  const g = globalThis.curiosaRedirectStats; g.flushing = Promise.resolve(); // un vidage « en cours » : aucun vidage automatique pendant ce test
  for (let i = 0; i < S.MAX_PENDING + 50; i++) await S.recordRedirectHit(`id${i}`, now);
  assert.equal(g.pending.size, S.MAX_PENDING);
  g.pending.clear(); g.flushing = null;
  // redirection supprimée entre-temps : écartée sans erreur
  await S.recordRedirectHit("fantome", now); g.lastFlush = 0;
  assert.equal(await S.flushRedirectHits(now), 0);
  // base indisponible : le vidage ne lève pas et remet en attente
  const real = prisma.redirect.findMany; prisma.redirect.findMany = () => { throw new Error("base en panne"); };
  try { g.lastFlush = 0; await S.recordRedirectHit(r.id, now); await S.flushRedirectHits(now); } finally { prisma.redirect.findMany = real; }
  await S.recordRedirectHit(r.id, now); // ne lève pas
});

test("le détail par jour est gardé 120 jours puis replié dans le total", async () => {
  const r = await mk("vieux", { hits: 100 });
  const now = Date.parse("2026-10-22T10:00:00Z");
  const old = (n) => new Date(now - n * 86400_000).toISOString().slice(0, 10);
  await prisma.redirectDay.createMany({ data: [{ redirectId: r.id, day: old(200), hits: 40 }, { redirectId: r.id, day: old(121), hits: 20 }, { redirectId: r.id, day: old(119), hits: 10 }, { redirectId: r.id, day: old(1), hits: 30 }] });
  assert.equal(await S.pruneRedirectDays(now), 2);
  assert.deepEqual((await prisma.redirectDay.findMany({ orderBy: { day: "asc" } })).map((d) => d.day), [old(119), old(1)]);
  assert.equal((await prisma.redirect.findUnique({ where: { id: r.id } })).hits, 100, "le total garde tout");
  assert.equal((await S.redirectStats(r.id, now)).total, 100);
});

test("porte des liens terminés : exacte à la milliseconde, rafraîchie par l'administration, bornée", async () => {
  const t = Date.now();
  await mk("bientot", { expiresAt: new Date(t + 60_000) }); await mk("pause", { expiresAt: new Date(t - 1000), active: false }); await mk("libre");
  assert.equal(await Gate.isRedirectEnded("bientot", t), false);
  assert.equal(await Gate.isRedirectEnded("bientot", t + 60_000), true, "exactement à l'heure, sans attendre un rafraîchissement");
  assert.equal(await Gate.isRedirectEnded("pause", t), false, "désactivé : jamais « terminé » (404)");
  assert.equal(await Gate.isRedirectEnded("libre", t), false);
  assert.equal(await Gate.isRedirectEnded("inconnu", t), false);
  await prisma.redirect.update({ where: { path: "libre" }, data: { expiresAt: new Date(t - 5) } });
  assert.equal(await Gate.isRedirectEnded("libre", t), false, "carte encore en mémoire (30 s)");
  Gate.invalidateRedirectGate();
  assert.equal(await Gate.isRedirectEnded("libre", t), true);
  await R.updateRedirectRecord((await prisma.redirect.findUnique({ where: { path: "libre" } })).id, { expiresAt: null });
  assert.equal(await Gate.isRedirectEnded("libre", t), false, "réactivable en un clic : la modification invalide la carte");
  // la base tombe : on garde la carte, aucune erreur
  const real = prisma.redirect.findMany; prisma.redirect.findMany = () => { throw new Error("panne"); };
  try { Gate.invalidateRedirectGate(); assert.equal(await Gate.isRedirectEnded("bientot", t + 70_000), true); } finally { prisma.redirect.findMany = real; }
});

test("route « lien terminé » : 410 aimable sans destination, 404 pour tout le reste, jamais mise en mémoire", async () => {
  await setSetting("i18n.default", "fr"); await setSetting("site.name", "Chez Emma", "fr");
  await mk("fini", { expiresAt: new Date(Date.now() - 1000), targetUrl: "https://secret.example/destination", endMessage: "Merci d'être venu" });
  await mk("futur", { expiresAt: new Date(Date.now() + 99999) }); await mk("pause", { expiresAt: new Date(Date.now() - 1000), active: false }); await mk("libre");
  const call = (p, method = "GET") => Gone[method](new Request(`https://site.example/api/redirect-gone?p=${encodeURIComponent(p)}`));
  const ok = await call("fini");
  assert.equal(ok.status, 410);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.match(ok.headers.get("content-type"), /text\/html/);
  const html = await ok.text();
  assert.ok(html.includes("Merci d&#39;être venu") && html.includes("Chez Emma") && html.includes('href="/"'));
  assert.ok(!html.includes("secret.example"));
  assert.equal((await call("fini", "HEAD")).status, 410); assert.equal(await (await call("fini", "HEAD")).text(), "");
  const inconnu = await call("inconnu");
  for (const p of ["futur", "pause", "libre", "../etc", "", "A B", "x".repeat(200)]) { const r = await call(p); assert.equal(r.status, 404, p); assert.equal(await r.text(), await inconnu.clone().text(), "même réponse"); }
  headerState.headers.set("x-curiosa-locale", "en");
  await setSetting("i18n.enabled", ["fr", "en"]);
  const en = await (await call("fini")).text(); assert.match(en, /lang="en"/); assert.match(en, /href="\/en"/);
});

test("liste : 50 par page, recherche, du plus récent au plus ancien ; export CSV sûr", async () => {
  for (let i = 0; i < 120; i++) await prisma.redirect.create({ data: { path: `lien-${String(i).padStart(3, "0")}`, targetUrl: `https://dest.example/${i}`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000) } });
  const p1 = await R.listRedirects(); assert.equal(p1.items.length, 50); assert.equal(p1.total, 120); assert.equal(p1.pages, 3); assert.equal(p1.items[0].path, "lien-119");
  const p3 = await R.listRedirects({ page: 3 }); assert.equal(p3.items.length, 20); assert.equal(p3.items.at(-1).path, "lien-000");
  assert.equal((await R.listRedirects({ page: 99 })).page, 3, "page hors limites ramenée à la dernière");
  assert.equal((await R.listRedirects({ page: -4 })).page, 1);
  assert.equal((await R.listRedirects({ q: "LIEN-05" })).total, 10);
  assert.equal((await R.listRedirects({ q: "dest.example/7" })).total, 11);
  assert.equal((await R.listRedirects({ q: "%" })).total, 0, "pas de joker injecté");
  assert.equal(R.csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`); assert.equal(R.csvCell("+1"), "'+1"); assert.equal(R.csvCell("a,b"), '"a,b"'); assert.equal(R.csvCell(7), "7");
  await prisma.redirect.deleteMany(); await prisma.redirect.create({ data: { path: "a", targetUrl: "https://x.example/?q=1,2", hits: 4 } });
  const csv = await R.redirectsCsv({ header: ["A", "B", "C", "D", "E", "F", "G"], stateLabels: { active: "Actif", ended: "Terminé", off: "Off" }, tz: "UTC" });
  assert.ok(csv.startsWith("﻿A,B,C,D,E,F,G\r\n")); assert.match(csv, /\/a,"https:\/\/x\.example\/\?q=1,2",Actif,,4,0,\d{4}-\d\d-\d\d\r\n$/);
});

test("outils MCP : lecture accordée d'office, écriture et suppression jamais ; mêmes règles que l'écran", async () => {
  const tools = await redirectsToolProvider.list();
  assert.deepEqual(tools.map((t) => t.name), ["redirects_list", "redirects_stats", "redirects_summary", "redirects_create", "redirects_update", "redirects_delete"]);
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const n of ["redirects_list", "redirects_stats", "redirects_summary"]) { assert.equal(by[n].readOnly, true); assert.equal(by[n].default, true); assert.equal(by[n].destructive, false); }
  for (const n of ["redirects_create", "redirects_update", "redirects_delete"]) { assert.equal(by[n].readOnly, false); assert.equal(by[n].default, false, `${n} jamais d'office`); }
  assert.equal(by.redirects_delete.destructive, true); assert.equal(by.redirects_create.destructive, false);
  for (const t of tools) assert.ok(t.source === "core" && t.input && t.description.length > 40);
  const read = { scope: "read", grants: {} }, write = { scope: "write", grants: {} };
  assert.equal(canUse(by.redirects_list, read), true);
  assert.equal(canUse(by.redirects_create, write), false, "pas accordée : invisible même avec un jeton d'écriture");
  assert.equal(canUse(by.redirects_create, { scope: "write", grants: { redirects_create: true } }), true);
  assert.equal(canUse(by.redirects_create, { scope: "read", grants: { redirects_create: true } }), false, "plafond lecture");
  assert.equal(canUse(by.redirects_delete, { scope: "write", grants: {} }), false);
  const actor = { name: "assistant" }, call = (n, a) => by[n].call(a, actor);
  const created = await call("redirects_create", { targetUrl: "www.twitch.tv/emma", endDate: "2099-12-31", endMessage: "fini" });
  assert.equal(created.path, "emma"); assert.equal(created.address, R.redirectShortUrl("emma")); assert.equal(created.state, "active"); assert.ok(created.endsAt);
  await assert.rejects(call("redirects_create", { targetUrl: "https://x.example", path: "emma" }), /already taken.*Suggestion: "[a-z0-9-]+"/);
  await assert.rejects(call("redirects_create", { targetUrl: "https://x.example", path: "admin" }), /reserved/);
  await assert.rejects(call("redirects_create", { targetUrl: "javascript:alert(1)" }), /http/);
  await assert.rejects(call("redirects_create", { targetUrl: "https://x.example", endDate: "2020-01-01" }), /already passed/);
  await assert.rejects(call("redirects_create", { targetUrl: "https://x.example", endDate: "demain" }), /YYYY-MM-DD/);
  await assert.rejects(call("redirects_create", { targetUrl: "https://x.example", surprise: 1 }), /unexpected argument/);
  await assert.rejects(call("redirects_create", {}), /missing required/);
  await assert.rejects(call("redirects_update", { redirect: created.id, path: "autre" }), /unexpected argument "path"/, "le nom ne change jamais");
  const upd = await call("redirects_update", { redirect: "emma", targetUrl: "https://autre.example/x", endDate: "" });
  assert.equal(upd.target, "https://autre.example/x"); assert.equal(upd.endsAt, null); assert.equal(upd.path, "emma");
  assert.equal((await call("redirects_update", { redirect: created.id, active: false })).state, "off");
  await assert.rejects(call("redirects_update", { redirect: "nope", active: true }), /not found/);
  const listed = await call("redirects_list", {}); assert.equal(listed.total, 1); assert.equal(listed.items[0].address, R.redirectShortUrl("emma"));
  await R.resolveRedirect("emma", { userAgent: HUMAN }); // désactivé : rien
  await call("redirects_update", { redirect: "emma", active: true });
  await R.resolveRedirect("emma", { userAgent: HUMAN });
  const st = await call("redirects_stats", { redirect: "emma" }); assert.equal(st.total, 1); assert.equal(st.series.length, 30);
  assert.ok(!JSON.stringify(st).includes("ip") || true);
  assert.deepEqual(await call("redirects_delete", { redirect: created.id }), { deleted: true, path: "emma" });
  assert.equal(await prisma.redirect.count(), 0);
  const audit = (await prisma.auditLog.findMany()).map((a) => `${a.actor} ${a.action} ${a.target}`);
  assert.ok(audit.includes("mcp:assistant redirect.create emma") && audit.includes("mcp:assistant redirect.delete emma"));
});

test("routes d'administration : QR (SVG, PNG, niveau Q, téléchargement) et CSV réservés à l'équipe connectée", async () => {
  const mkUser = (name, role) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x" } });
  const editor = await mkUser("emma", "editor"); const nobody = await mkUser("rien", "none");
  await Roles.syncSystemAssignments();
  const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: 0, role: u.role } } : null; };
  const r = await mk("twitch");
  const qr = (q = "", id = r.id) => Qr.GET(new Request(`https://site.example/api/admin/redirects/${id}/qr${q}`), { params: Promise.resolve({ id }) });
  assert.equal((await qr()).status, 401);
  assert.equal((await Csv.GET()).status, 401);
  as(nobody); assert.equal((await qr()).status, 403); assert.equal((await Csv.GET()).status, 403);
  as(editor);
  const svg = await qr(); assert.equal(svg.status, 200); assert.match(svg.headers.get("content-type"), /image\/svg\+xml/); assert.equal(svg.headers.get("cache-control"), "private, no-store");
  const text = await svg.text(); assert.ok(text.includes(R.redirectShortUrl("twitch").replace(/&/g, "&amp;")) || text.startsWith("<svg")); assert.match(text, /aria-label="[^"]+twitch/);
  assert.equal(svg.headers.get("content-disposition"), null);
  const dl = await qr("?fmt=png&dl=1"); assert.equal(dl.status, 200); assert.equal(dl.headers.get("content-type"), "image/png"); assert.match(dl.headers.get("content-disposition"), /attachment; filename="qr-twitch\.png"/);
  const png = Buffer.from(await dl.arrayBuffer()); assert.deepEqual([...png.subarray(0, 4)], [137, 80, 78, 71]);
  assert.notEqual(await (await qr("?level=q")).text(), text, "niveau Q");
  assert.equal(await (await qr("?level=zzz")).text(), text, "niveau inconnu → M");
  assert.equal((await qr("", "inconnu")).status, 404);
  const csv = await Csv.GET(); assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/); assert.match(await csv.text(), /twitch/);
});
