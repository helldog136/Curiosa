// Liens courts : total par destination (regroupement normalisé, alias, totaux, bornes, outil MCP, vue d'administration) et
// « Compter les clics sur mes liens » (réécriture sûre des boutons du site, droits, sauvegarde, assistant pour les modules).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb, settleBackground } from "../helpers/db.mjs";

process.env.AUTH_SECRET = "test-auth-secret-redirect-insights";
const db = await useTestDb();
const { prisma } = db;
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const D = await import("@/core/redirectDestination");
const G = await import("@/core/redirectGroups");
const M = await import("@/core/redirectMeasure");
const R = await import("@/core/redirects");
const { redirectsToolProvider } = await import("@/core/redirectMcp");
const { canUse } = await import("@/core/services/mcp/access");
const { setSetting, getSetting } = await import("@/core/settings");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { DestinationList } = await import("@/components/admin/DestinationList");
const { DestinationCurve } = await import("@/components/admin/DestinationCurve");
const { entryHref } = await import("@/components/site/EntryList");
const Act = await import("@/app/admin/(panel)/redirects/actions");
const { makeApi } = await import("@/core/modules/api");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { RedirectError } = await import("next/navigation");
const Roles = await import("@/core/auth/roles");

after(() => db.close());
const NOW = Date.parse("2026-06-15T12:00:00Z");
const HUMAN = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
let T;
beforeEach(async () => {
  await db.reset();
  globalThis.curiosaRedirectStats = undefined; globalThis.curiosaRedirectGate = undefined; globalThis.curiosaRedirectMeasure = undefined; globalThis.curiosaTestSession = null;
  await setSetting("site.timezone", "UTC");
  const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
  T = { owner: await mk("olive", "owner"), admin: await mk("adam", "admin"), editor: await mk("emma", "editor") };
  await Roles.syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: "owner" } } : null; };
const form = (entries) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
const outcome = async (fn) => { try { await fn(); return "ok"; } catch (e) { if (e instanceof RedirectError) return e.url; throw e; } };
const day = (back) => new Date(NOW - back * 86400_000).toISOString().slice(0, 10);
const mk = async (path, target, over = {}, days = {}) => {
  const r = await prisma.redirect.create({ data: { path, targetUrl: target, ...over } });
  for (const [back, hits] of Object.entries(days)) await prisma.redirectDay.create({ data: { redirectId: r.id, day: day(Number(back)), hits } });
  return r;
};

/* ───────────── A. Normalisation ───────────── */

test("destinationKey : schéma, www., casse du domaine, barre finale, port par défaut, point final, ordre et suivi ignorés", () => {
  const same = [
    "https://www.instagram.com/emma", "http://instagram.com/emma", "HTTPS://WWW.Instagram.COM/emma/", "https://instagram.com/emma///", "https://instagram.com:443/emma",
    "https://instagram.com./emma", "https://instagram.com/emma?utm_source=site&igsh=abc&fbclid=zz", "  https://instagram.com/emma?  ",
  ];
  const keys = same.map(D.destinationKey);
  assert.ok(keys.every((k) => k === "instagram.com/emma"), JSON.stringify(keys));
  assert.equal(D.destinationKey("https://youtube.com/watch?v=abc&t=5"), D.destinationKey("http://www.youtube.com/watch?t=5&v=abc"), "ordre des paramètres sans importance");
  assert.equal(D.destinationKey("https://youtu.be/abc?si=partage"), D.destinationKey("https://youtu.be/abc"));
  assert.equal(D.destinationKey("https://shop.example/"), D.destinationKey("https://SHOP.example"), "adresse racine");
});

test("destinationKey : ce qui désigne un autre endroit reste différent (chemin, paramètres significatifs, autre sous-domaine, port, fragment) ; ce qui n'est pas http(s) n'est pas comparé", () => {
  const distinct = [
    "https://instagram.com/emma", "https://instagram.com/Emma", "https://instagram.com/emma2", "https://m.instagram.com/emma", "https://instagram.com/emma?v=1", "https://instagram.com/emma?v=2",
    "https://instagram.com/emma#contact", "https://instagram.com:8443/emma", "https://instagram.org/emma", "https://youtube.com/watch?v=abc", "https://youtube.com/watch?v=abd",
  ];
  assert.equal(new Set(distinct.map(D.destinationKey)).size, distinct.length);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.example", "tel:+32123", "ftp://a.example/x", "/relatif", "//evil.example/x", "pas une adresse", "", "https://"]) assert.equal(D.destinationKey(bad), null, bad);
});

/* ───────────── A. Regroupement, totaux, classement ───────────── */

test("trois alias, une destination : totaux (aujourd'hui, 7 jours, 30 jours, total), classement, courbe sommée, états gardés", async () => {
  await mk("instagram", "https://www.instagram.com/emma/", { hits: 120 }, { 0: 3, 2: 4, 10: 5, 29: 1 });
  await mk("ig", "https://instagram.com/emma?utm_source=bio", { hits: 40 }, { 0: 2, 6: 1 });
  await mk("insta", "http://INSTAGRAM.com/emma", { hits: 15, active: false }, { 1: 7 });
  await mk("yt", "https://youtube.com/@emma", { hits: 500 }, { 3: 9 });
  await mk("youtube", "https://www.youtube.com/@emma/", { hits: 100, expiresAt: new Date(NOW - 86400_000) }, { 4: 2, 40: 50 });
  await mk("tiktok", "https://tiktok.com/@emma", { hits: 8 }, { 0: 1 });
  const s = await G.destinationSummary(NOW);
  assert.equal(s.linksRead, 6); assert.equal(s.linksTotal, 6); assert.equal(s.hidden, 0);
  assert.deepEqual(s.groups.map((g) => [g.key, g.links.length]), [["youtube.com/@emma", 2], ["instagram.com/emma", 3], ["tiktok.com/@emma", 1]], "classées par total (600 > 175 > 8)");
  const yt = s.groups[0], ig = s.groups[1];
  assert.equal(yt.total, 600, "yt (500) + youtube (100) : un seul total pour la destination");
  assert.equal(yt.month, 11, "9 + 2 ; les 50 d'il y a 40 jours sortent des 30 jours mais restent dans le total");
  assert.equal(yt.week, 11); assert.equal(yt.today, 0);
  assert.equal(ig.total, 175); assert.equal(ig.month, 3 + 4 + 5 + 1 + 2 + 1 + 7); assert.equal(ig.week, 3 + 4 + 2 + 1 + 7); assert.equal(ig.today, 5);
  assert.deepEqual(ig.links.map((l) => [l.path, l.state]), [["instagram", "active"], ["ig", "active"], ["insta", "off"]], "alias du plus au moins visité, état conservé (un lien coupé garde ses clics)");
  assert.deepEqual(yt.links.map((l) => [l.path, l.state]), [["yt", "active"], ["youtube", "ended"]]);
  assert.equal(ig.series.length, 30); assert.equal(ig.series.reduce((a, p) => a + p.hits, 0), ig.month);
  assert.equal(ig.series[29].hits, 5, "dernier élément = aujourd'hui"); assert.equal(ig.destination, "https://www.instagram.com/emma/", "adresse du lien le plus visité, telle que saisie");
  assert.equal(ig.links.reduce((a, l) => a + l.total, 0), ig.total);
});

test("total jamais inférieur aux 30 jours ; lien sans destination valable ignoré", async () => {
  await mk("a", "https://a.example/x", { hits: 0 }, { 0: 4 });
  const s = await G.destinationSummary(NOW);
  assert.equal(s.groups[0].total, 4, "même règle que la fiche d'un lien (max du total et des 30 jours)");
  await prisma.redirect.create({ data: { path: "bad", targetUrl: "mailto:a@b.example", hits: 9 } }); // ancien contenu restauré : jamais regroupé, jamais planter
  const s2 = await G.destinationSummary(NOW);
  assert.equal(s2.groups.length, 1); assert.equal(s2.linksRead, 2);
});

test("bornes : 200 liens lus au plus (les plus visités), 50 destinations montrées, 30 jours, rien à lire quand il n'y a rien", async () => {
  assert.deepEqual((await G.destinationSummary(NOW)).groups, []);
  await prisma.redirect.createMany({ data: Array.from({ length: 230 }, (_, i) => ({ path: `l${String(i).padStart(3, "0")}`, targetUrl: `https://dest${i}.example/p`, hits: 1000 - i })) });
  const s = await G.destinationSummary(NOW);
  assert.equal(s.linksRead, G.GROUP_MAX_LINKS); assert.equal(s.linksTotal, 230);
  assert.equal(s.groups.length, G.GROUP_MAX_DESTINATIONS); assert.equal(s.hidden, 200 - 50);
  assert.equal(s.groups[0].links[0].path, "l000", "les plus visités d'abord"); assert.ok(!JSON.stringify(s).includes('"l229"') && !JSON.stringify(s).includes('"l200"'), "les 30 moins visités ne sont pas lus");
  assert.ok(s.groups.every((g) => g.series.length === 30));
  assert.ok(G.GROUP_READ_CHUNK <= 50 && G.GROUP_DAYS === 30);
  // des jours en trop (hors des 30) sont ignorés par la lecture
  const one = await prisma.redirect.findUnique({ where: { path: "l000" } });
  await prisma.redirectDay.create({ data: { redirectId: one.id, day: day(31), hits: 99 } });
  assert.equal((await G.destinationSummary(NOW)).groups[0].month, 0);
});

test("aucune donnée personnelle : seulement des nombres par lien et par jour (le modèle n'a aucune autre colonne), robots non comptés", async () => {
  const model = fs.readFileSync("prisma/schema.prisma", "utf8").match(/model RedirectDay \{([\s\S]*?)\n\}/)[1];
  const cols = model.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => c && !c.startsWith("//") && !c.startsWith("@@") && c !== "redirect");
  assert.deepEqual(cols, ["redirectId", "day", "hits"]);
  const src = fs.readFileSync("src/core/redirectGroups.ts", "utf8") + fs.readFileSync("src/core/redirectMeasure.ts", "utf8");
  assert.doesNotMatch(src, /userAgent|x-forwarded-for|cookies\(|headers\(\)/);
  await mk("ig", "https://instagram.com/emma");
  await R.resolveRedirect("ig", { userAgent: HUMAN }, NOW);
  await R.resolveRedirect("ig", { userAgent: "WhatsApp/2.23" }, NOW);
  await R.resolveRedirect("ig", { userAgent: "Googlebot/2.1" }, NOW);
  await R.resolveRedirect("ig", { userAgent: HUMAN, prefetch: true }, NOW);
  const s = await G.destinationSummary(NOW);
  assert.equal(s.groups[0].total, 1, "un clic de personne, ni robot, ni aperçu, ni préchargement");
  assert.deepEqual(Object.keys(s).sort(), ["groups", "hidden", "linksRead", "linksTotal"]);
  assert.deepEqual(Object.keys(s.groups[0]).sort(), ["destination", "key", "links", "month", "series", "today", "total", "week"]);
});

/* ───────────── A. Outil MCP ───────────── */

test("outil MCP redirects_summary : lecture accordée d'office, liste classée, filtre par adresse ou nom court, erreurs lisibles, aucun jeton d'écriture requis", async () => {
  const tools = await redirectsToolProvider.list();
  assert.deepEqual(tools.map((t) => t.name), ["redirects_list", "redirects_stats", "redirects_summary", "redirects_create", "redirects_update", "redirects_delete"]);
  const tool = tools.find((t) => t.name === "redirects_summary");
  assert.equal(tool.readOnly, true); assert.equal(tool.default, true); assert.equal(tool.destructive, false); assert.equal(tool.source, "core");
  assert.equal(canUse(tool, { scope: "read", grants: {} }), true);
  await mk("ig", "https://instagram.com/emma", { hits: 5 }, { 0: 2 });
  await mk("insta", "https://www.instagram.com/emma/", { hits: 3 }, { 1: 1 });
  await mk("yt", "https://youtube.com/@emma", { hits: 50 });
  // Les lignes de passages sont datées par rapport à NOW ; l'outil lit « maintenant » : on en crée pour aujourd'hui.
  const ig = await prisma.redirect.findUnique({ where: { path: "ig" } });
  await prisma.redirectDay.create({ data: { redirectId: ig.id, day: new Date().toISOString().slice(0, 10), hits: 4 } });
  const actor = { name: "assistant" };
  const all = await tool.call({}, actor);
  assert.deepEqual(all.destinations.map((d) => [d.rank, d.total, d.aliases.map((a) => a.path)]), [[1, 50, ["yt"]], [2, 8, ["ig", "insta"]]]);
  assert.equal(all.destinations[1].aliases[0].address, R.redirectShortUrl("ig")); assert.equal(all.truncated, false); assert.equal(all.destinations[0].series, undefined, "pas de courbe dans la liste");
  for (const ask of ["https://instagram.com/emma", "www.instagram.com/emma/?utm_medium=x", "ig", "/insta"]) {
    const one = await tool.call({ destination: ask }, actor);
    assert.equal(one.destinations.length, 1, ask); assert.equal(one.destinations[0].rank, 2); assert.equal(one.destinations[0].series.length, 30); assert.equal(one.destinations[0].today, 4);
  }
  await assert.rejects(tool.call({ destination: "https://inconnu.example/x" }, actor), /destination not found/);
  await assert.rejects(tool.call({ destination: "javascript:alert(1)" }, actor), /destination not found/);
  await assert.rejects(tool.call({ surprise: 1 }, actor), /unexpected argument/);
  await assert.rejects(tool.call({ destination: "x".repeat(2001) }, actor), /too long|maxLength|at most/i);
  assert.doesNotMatch(JSON.stringify(all), /userAgent|cookie|"ip"|origin/i);
  const stats = tools.find((t) => t.name === "redirects_stats");
  assert.deepEqual(Object.keys(stats.input.properties), ["redirect"], "redirects_stats est inchangé");
});

/* ───────────── A. Vue d'administration ───────────── */

test("vue « Par destination » : total, alias dessous, courbe accessible (texte alternatif + tableau), aucune ressource venue d'ailleurs ; FR et EN", async () => {
  await mk("instagram", "https://www.instagram.com/emma", { hits: 20 }, { 0: 3, 5: 2, 12: 1 });
  await mk("ig", "https://instagram.com/emma/", { hits: 5 }, { 1: 4 });
  await mk("insta", "https://instagram.com/emma?igsh=1", { hits: 1 });
  await mk("vide", "https://rien.example/", { hits: 0 });
  const summary = await G.destinationSummary(NOW);
  const fmt = (d) => d.slice(5);
  for (const lang of ["fr", "en"]) {
    const t = makeTranslator(lang);
    const html = renderToStaticMarkup(React.createElement(DestinationList, { summary, t, format: fmt }));
    assert.equal((html.match(/data-testid="destination-row"/g) ?? []).length, 2);
    for (const p of ["/instagram", "/ig", "/insta"]) assert.ok(html.includes(`>${p}<`), `${lang} alias ${p}`);
    assert.match(html, /data-testid="destination-today">3</); assert.match(html, /data-testid="destination-total">26</);
    assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="[^"]+"/, "courbe : image décrite"); assert.match(html, /<svg[\s\S]*<title>[^<]+<\/title>/);
    assert.match(html, /<details[\s\S]*<table[^>]*>[\s\S]*<th[^>]*>/, "tableau sous la courbe");
    assert.match(html, /<td[^>]*>\d\d-\d\d<\/td><td[^>]*>3<\/td>/);
    assert.doesNotMatch(html, /<script|<img|<link|<iframe|src="https?:|url\(/i, "aucun chargement tiers");
    assert.doesNotMatch(html, /redirects\.[a-z.]+/i, "aucune clé de traduction brute");
    assert.match(html, lang === "fr" ? /Par destination|Liens courts qui mènent ici \(3\)/ : /Short links that lead here \(3\)/);
  }
  const empty = renderToStaticMarkup(React.createElement(DestinationCurve, { series: Array.from({ length: 30 }, (_, i) => ({ day: `2026-06-${String(i + 1).padStart(2, "0")}`, hits: 0 })), labels: { alt: "a", table: "t", day: "d", hits: "h", none: "Aucun clic" }, format: fmt }));
  assert.match(empty, /Aucun clic/); assert.doesNotMatch(empty, /<svg/);
  const none = renderToStaticMarkup(React.createElement(DestinationList, { summary: { groups: [], linksRead: 0, linksTotal: 0, hidden: 0 }, t: makeTranslator("fr"), format: fmt }));
  assert.match(none, /Aucun lien court pour l(?:'|&#x27;)instant/);
  const cut = renderToStaticMarkup(React.createElement(DestinationList, { summary: { ...summary, linksRead: 200, linksTotal: 230, hidden: 3 }, t: makeTranslator("en"), format: fmt }));
  assert.match(cut, /Only the 200 most visited links \(out of 230\)/); assert.match(cut, /3 other destinations/);
});

test("la page « Redirections » : même droit qu'avant (édition), vue choisie par l'adresse, réglage réservé à l'administration", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/redirects/page.tsx", "utf8");
  assert.match(page, /adminCtx\("editor"\)/); assert.match(page, /hasRole\(user, "admin"\)/); assert.match(page, /view=destinations/);
  const actions = fs.readFileSync("src/app/admin/(panel)/redirects/actions.ts", "utf8");
  assert.match(actions, /export async function saveMeasureLinks[\s\S]*?adminCtx\("admin"\)/);
});

/* ───────────── B. Réécriture des boutons ───────────── */

const mapOf = async (now) => { M.invalidateRedirectMeasure(); return M.loadMeasureMap(now); };

test("réglage désactivé (défaut) : aucune adresse ne change et aucun lien n'est lu", async () => {
  await mk("ig", "https://instagram.com/emma");
  assert.equal(await getSetting(M.MEASURE_SETTING), undefined);
  const map = await mapOf(NOW);
  assert.equal(map.size, 0);
  assert.equal(M.measureHref(map, "https://instagram.com/emma"), "https://instagram.com/emma");
  assert.equal(await M.measuredHref("https://instagram.com/emma"), "https://instagram.com/emma");
});

test("réglage activé : le bouton passe par le lien court actif (casse, www, barre finale, suivi) ; sinon il reste tel quel", async () => {
  await setSetting(M.MEASURE_SETTING, true);
  await mk("ig", "https://www.instagram.com/emma/");
  await mk("yt", "https://youtube.com/watch?v=abc");
  const map = await mapOf(NOW);
  for (const same of ["https://instagram.com/emma", "http://INSTAGRAM.com/emma", "https://www.instagram.com/emma/?utm_source=menu&igsh=x"]) assert.equal(M.measureHref(map, same), "/ig", same);
  assert.equal(M.measureHref(map, "https://youtube.com/watch?v=abc", { absolute: true }), R.redirectShortUrl("yt"));
  for (const other of ["https://instagram.com/autre", "https://youtube.com/watch?v=zzz", "https://youtube.com/watch", "https://m.instagram.com/emma", "https://instagram.com/Emma"]) assert.equal(M.measureHref(map, other), other, `${other} : autre endroit`);
});

test("sûr : jamais de schéma dangereux, de chemin du site, de lien court déjà court (pas de chaîne), d'adresse du site, d'hôte différent de celui du lien d'origine", async () => {
  await setSetting(M.MEASURE_SETTING, true);
  await mk("ig", "https://instagram.com/emma");
  const map = await mapOf(NOW);
  for (const keep of ["javascript:alert(1)", "data:text/html,x", "mailto:emma@example.org", "tel:+3212345", "/ig", "/instagram", "#haut", "", "//instagram.com/emma", "ftp://instagram.com/emma", R.redirectShortUrl("ig")]) assert.equal(M.measureHref(map, keep), keep, keep || "(vide)");
  const out = M.measureHref(map, "https://www.instagram.com/emma?utm_campaign=x");
  assert.equal(out, "/ig"); assert.equal(M.measureHref(map, out), out, "appliquer deux fois ne change rien : jamais de chaîne");
  // le lien court mène à un hôte identique à celui du bouton d'origine (aux « www. » près), par construction
  const resolved = await R.resolveRedirect("ig", { userAgent: HUMAN }, NOW);
  for (const origin of ["https://instagram.com/emma", "http://www.INSTAGRAM.com/emma/"]) {
    assert.equal(new URL(resolved.url).hostname.replace(/^www\./, ""), new URL(origin).hostname.toLowerCase().replace(/^www\./, ""));
    assert.equal(D.destinationKey(resolved.url), D.destinationKey(origin));
  }
  // un lien qui viserait une page du site lui-même (ancien contenu) n'est jamais utilisé
  await prisma.redirect.create({ data: { path: "interne", targetUrl: R.redirectShortUrl("ig") } });
  const m2 = await mapOf(NOW); assert.equal(M.measureHref(m2, R.redirectShortUrl("interne")), R.redirectShortUrl("interne"));
  await prisma.redirect.create({ data: { path: "dangereux", targetUrl: "javascript:alert(1)" } });
  assert.equal((await mapOf(NOW)).size, 1, "une destination refusée à la redirection ne sert pas ici");
  assert.equal(M.measureHref(map, "x".repeat(3000)), "x".repeat(3000));
});

test("lien inactif, terminé (même après la mise en cache) ou supprimé : le bouton garde son adresse ; le plus ancien lien est toujours choisi", async () => {
  await setSetting(M.MEASURE_SETTING, true);
  await mk("off", "https://a.example/p", { active: false });
  await mk("fini", "https://b.example/p", { expiresAt: new Date(NOW - 1000) });
  await mk("bientot", "https://c.example/p", { expiresAt: new Date(NOW + 3600_000) });
  const first = await mk("zz-ancien", "https://d.example/p", { createdAt: new Date("2025-01-01T00:00:00Z") });
  await mk("aa-recent", "https://www.d.example/p/", { createdAt: new Date("2026-01-01T00:00:00Z") });
  const map = await mapOf(NOW);
  assert.equal(M.measureHref(map, "https://a.example/p", { now: NOW }), "https://a.example/p", "désactivé");
  assert.equal(M.measureHref(map, "https://b.example/p", { now: NOW }), "https://b.example/p", "terminé");
  assert.equal(M.measureHref(map, "https://c.example/p", { now: NOW }), "/bientot");
  assert.equal(M.measureHref(map, "https://c.example/p", { now: NOW + 7200_000 }), "https://c.example/p", "la date de fin passe pendant que la carte est en mémoire : vérifiée au rendu");
  assert.equal(M.measureHref(map, "https://d.example/p"), "/zz-ancien", "le plus ancien gagne, même si son nom vient après");
  await prisma.redirect.delete({ where: { id: first.id } }); M.invalidateRedirectMeasure();
  assert.equal(M.measureHref(await M.loadMeasureMap(NOW), "https://d.example/p"), "/aa-recent", "supprimé : le suivant prend le relais");
});

test("une entrée suivie par un lien court : sa destination actuelle sert à la comparaison, aussi dans le total par destination", async () => {
  await setSetting(M.MEASURE_SETTING, true);
  await db.fixture("blog");
  const { createInstance } = await import("@/core/instanceService");
  const { createEntry } = await import("@/core/content/service");
  const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
  const blog = await createInstance(prisma, { manifest: FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest, nickname: "Actus", names: { fr: "Actus" } });
  const e = await createEntry(prisma, { instanceId: blog.id, locale: "fr", title: "Boutique", status: "published", url: "https://shop.example/emma" });
  await mk("boutique", "https://repli.example/", { entryId: e.id }, { 0: 2 });
  await mk("shop", "https://www.shop.example/emma/", {}, { 0: 1 });
  const map = await mapOf(NOW);
  assert.equal(M.measureHref(map, "https://shop.example/emma"), "/boutique", "le plus ancien des deux, suivi de l'entrée");
  assert.equal(M.measureHref(map, "https://repli.example"), "https://repli.example", "l'adresse de repli n'est plus la destination");
  const s = await G.destinationSummary(NOW);
  assert.deepEqual(s.groups.map((g) => [g.key, g.today, g.links.map((l) => l.path)]), [["shop.example/emma", 3, ["boutique", "shop"]]]);
});

test("changer un lien ou le réglage met la carte à jour tout de suite (pas de minuteur)", async () => {
  const create = await R.createRedirectRecord({ path: "ig", targetUrl: "https://instagram.com/emma" });
  assert.equal(create.ok, true);
  assert.equal(M.measureHref(await M.loadMeasureMap(NOW), "https://instagram.com/emma"), "https://instagram.com/emma", "réglage désactivé");
  as(T.admin);
  assert.equal(await outcome(() => Act.saveMeasureLinks(null, form([["measureLinks", "on"]]))), "ok");
  assert.equal(await getSetting(M.MEASURE_SETTING), true);
  assert.equal(M.measureHref(await M.loadMeasureMap(NOW), "https://instagram.com/emma"), "/ig", "activé : pris en compte aussitôt");
  await R.updateRedirectRecord(create.redirect.id, { active: false });
  assert.equal(M.measureHref(await M.loadMeasureMap(NOW), "https://instagram.com/emma"), "https://instagram.com/emma", "lien coupé : le bouton revient à l'adresse d'origine aussitôt");
  await R.updateRedirectRecord(create.redirect.id, { active: true });
  assert.equal(M.measureHref(await M.loadMeasureMap(NOW), "https://instagram.com/emma"), "/ig");
  assert.equal(await outcome(() => Act.saveMeasureLinks(null, form([]))), "ok");
  assert.equal(await getSetting(M.MEASURE_SETTING), false);
  assert.equal(M.measureHref(await M.loadMeasureMap(NOW), "https://instagram.com/emma"), "https://instagram.com/emma");
  assert.ok((await prisma.auditLog.findMany()).some((a) => a.action === "settings.update" && a.target === M.MEASURE_SETTING));
});

test("droits : le réglage est réservé à l'administration ; l'édition, un compte sans palier et une personne anonyme sont refusées sans rien changer", async () => {
  for (const [who, expected] of [["owner", "ok"], ["admin", "ok"]]) { as(T[who]); assert.equal(await outcome(() => Act.saveMeasureLinks(null, form([["measureLinks", "on"]]))), expected, who); }
  await setSetting(M.MEASURE_SETTING, false);
  as(T.editor); assert.equal(await outcome(() => Act.saveMeasureLinks(null, form([["measureLinks", "on"]]))), "/admin?denied=1");
  as(null); assert.equal(await outcome(() => Act.saveMeasureLinks(null, form([["measureLinks", "on"]]))), "/admin/login");
  assert.equal(await getSetting(M.MEASURE_SETTING), false, "aucun refus n'a modifié le réglage");
});

test("boutons du site : le menu, l'en-tête et les listes passent par la réécriture ; le pied de page du cœur n'a aucun lien sortant à réécrire", async () => {
  const header = fs.readFileSync("src/components/site/Header.tsx", "utf8");
  for (const needle of ["loadMeasureMap", "measured(i.href)", "measured(c.href)", "measured(s.href)", "local(config.header.secondary.href)", "local(config.header.button.href)"]) assert.ok(header.includes(needle), needle);
  assert.match(header, /const local = \(path: string\) => measured\(/);
  await setSetting(M.MEASURE_SETTING, true);
  await mk("boutique", "https://shop.example/emma");
  const map = await mapOf(NOW);
  const entry = { url: "https://www.shop.example/emma/" };
  assert.equal(entryHref(entry, { clickAction: "external" }, "fr", map).href, "/boutique");
  assert.equal(entryHref(entry, { clickAction: "external" }, "fr").href, "https://www.shop.example/emma/", "sans carte : comme avant");
  assert.equal(entryHref({ url: "javascript:alert(1)", slug: "s", locale: "fr" }, { clickAction: "external" }, "fr", map).href.startsWith("javascript:"), false);
  const footer = fs.readFileSync("src/components/site/Footer.tsx", "utf8");
  assert.deepEqual([...footer.matchAll(/href=\{([^}]+)\}/g)].map((m) => m[1].replace(/^`\$\{/, "").split("(")[0]), ["withLocale", "withLocale", "feedPath", "CREDIT_URL"]);
});

/* ───────────── B. Assistant pour les modules ───────────── */

test("ctx.api.links.measured : sans réglage l'adresse revient telle quelle, avec réglage le lien court (chemin ou adresse complète) ; ne lève jamais", async () => {
  const api = makeApi({ id: "i1", key: "contact", moduleId: "contact-form", names: {} }, "fr");
  await mk("ig", "https://instagram.com/emma");
  assert.equal(await api.links.measured("https://instagram.com/emma"), "https://instagram.com/emma");
  await setSetting(M.MEASURE_SETTING, true); M.invalidateRedirectMeasure();
  assert.equal(await api.links.measured("https://www.instagram.com/emma/"), "/ig");
  assert.equal(await api.links.measured("https://www.instagram.com/emma/", { absolute: true }), R.redirectShortUrl("ig"));
  assert.equal(await api.links.measured("mailto:a@b.example"), "mailto:a@b.example");
  assert.equal(await api.links.measured(undefined), ""); assert.equal(await api.links.measured(42), "42");
  const fake = await import("../../testsupport/fakeCtx.mjs");
  const ctx = (fake.fakeCtx ?? fake.default)?.({});
  if (ctx) assert.equal(await ctx.api.links.measured("https://x.example/a"), "https://x.example/a", "le faux contexte des essais de modules rend l'adresse telle quelle");
});

/* ───────────── Sauvegarde et restauration ───────────── */

test("sauvegarde et restauration : le réglage voyage avec les autres réglages ; aucun nouveau fichier ni nouvelle table dans la sauvegarde", async () => {
  await setSetting(M.MEASURE_SETTING, true);
  await mk("ig", "https://instagram.com/emma", { hits: 7 }, { 0: 3 });
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.ok(opened.ok);
  assert.ok(opened.backup.data.settings.some((s) => s.key === M.MEASURE_SETTING && s.value === true));
  assert.deepEqual(Object.keys(opened.backup.data).sort(), ["entries", "entryTranslations", "instanceTranslations", "instances", "modules", "overlayPages", "records", "redirects", "retired", "roles", "settings", "uploadFiles", "userRoles", "users"].sort(), "même forme qu'avant");
  await db.reset(); await setSetting("site.name", "Autre");
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "olive@example.org" });
  assert.equal(report.ok, true); await settleBackground();
  assert.equal(await getSetting(M.MEASURE_SETTING), true);
  assert.equal((await prisma.redirect.findUnique({ where: { path: "ig" } })).hits, 7);
  const src = fs.readFileSync("src/core/backup/export.ts", "utf8") + fs.readFileSync("src/core/backup/restore.ts", "utf8") + fs.readFileSync("src/core/backup/schema.ts", "utf8");
  assert.doesNotMatch(src, /redirectMeasure|redirectGroups|measureLinks/, "le code de sauvegarde ne connaît pas la nouveauté");
});
