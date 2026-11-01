import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const F = await import("@/core/feeds");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES: BUILTIN_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
async function blog(nickname, names = { en: nickname ?? "Blog" }) {
  await db.fixture("blog");
  return createInstance(db.prisma, { manifest: manifest("blog"), nickname, names });
}
const publish = (instanceId, title, when, extra = {}) =>
  createEntry(db.prisma, { instanceId, locale: "en", title, status: "published", ...extra }).then((e) => db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(when) } }));

test("rendu : XML valide, éléments échappés, date de construction = élément le plus récent (jamais l'heure courante)", () => {
  const xml = F.renderRss({ title: 'A & "B"', link: "https://x.test", description: "", language: "fr", self: "https://x.test/feed.xml", items: [
    { id: "1", title: "<script>x</script>", link: "https://x.test/a?b=1&c=2", summary: "S\u0001", publishedAt: new Date("2026-01-02T03:04:05Z") },
    { id: "2", title: "Sans date", link: "https://x.test/b", summary: "", publishedAt: null },
  ] });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><rss version="2.0"/);
  assert.ok(xml.includes("A &amp; &quot;B&quot;"));
  assert.ok(xml.includes("&lt;script&gt;x&lt;/script&gt;") && !xml.includes("<script>"));
  assert.ok(xml.includes("b=1&amp;c=2"));
  assert.ok(!xml.includes("\u0001"), "caractère interdit en XML retiré");
  assert.ok(xml.includes("<lastBuildDate>Fri, 02 Jan 2026 03:04:05 GMT</lastBuildDate>"));
  assert.equal((xml.match(/<pubDate>/g) ?? []).length, 1);
  assert.equal(F.renderRss({ title: "T", link: "l", description: "d", language: "en", self: "s", items: [] }).includes("lastBuildDate"), false);
});

test("rendu : déterministe — mêmes données, mêmes octets, quel que soit l'ordre d'arrivée", () => {
  const items = [
    { id: "b", title: "B", link: "https://x.test/b", summary: "", publishedAt: new Date("2026-01-01") },
    { id: "a", title: "A", link: "https://x.test/a", summary: "", publishedAt: new Date("2026-01-01") },
    { id: "c", title: "C", link: "https://x.test/c", summary: "", publishedAt: new Date("2026-03-01") },
    { id: "d", title: "D", link: "https://x.test/d", summary: "", publishedAt: null },
  ];
  const feed = (list) => F.renderRss({ title: "T", link: "l", description: "d", language: "en", self: "s", items: F.sortItems(list) });
  const one = feed(items), two = feed([...items].reverse());
  assert.equal(one, two);
  assert.deepEqual(F.sortItems(items).map((i) => i.id), ["c", "a", "b", "d"], "récent d'abord, égalité par adresse, sans date à la fin");
});

test("flux : entrées publiées de toutes les instances à contenu, brouillons et expirées exclus", async () => {
  const a = await blog("Actus"), b = await blog("Videos");
  await publish(a.id, "Vieux", "2026-01-01");
  await publish(a.id, "Récent", "2026-03-01");
  await publish(b.id, "Vidéo", "2026-02-01");
  await createEntry(db.prisma, { instanceId: a.id, locale: "en", title: "Brouillon" });
  await publish(a.id, "Périmé", "2026-02-15", { expiresAt: new Date("2026-02-16") });
  const items = await F.collectFeedItems({ locale: "en" });
  assert.deepEqual(items.map((i) => i.title), ["Récent", "Vidéo", "Vieux"]);
  assert.match(items[0].link, /^http.*\/[a-z0-9-]+\/recent$/, items[0].link);
});

test("flux : une instance précise, limite bornée, mêmes résultats d'un appel à l'autre", async () => {
  const a = await blog("Actus"), b = await blog("Videos");
  for (let i = 0; i < 5; i++) await publish(a.id, `A${i}`, `2026-01-0${i + 1}`);
  await publish(b.id, "V", "2026-02-01");
  assert.equal((await F.collectFeedItems({ locale: "en", instance: "actus" })).length, 5);
  assert.equal((await F.collectFeedItems({ locale: "en", instance: "videos" })).length, 1);
  assert.equal((await F.collectFeedItems({ locale: "en", limit: 2 })).length, 2);
  assert.deepEqual(await F.collectFeedItems({ locale: "en" }), await F.collectFeedItems({ locale: "en" }));
});

test("flux : une instance qui ne propose pas ses entrées n'apparaît pas", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Public", "2026-01-01");
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { exposed: false } });
  assert.deepEqual(await F.collectFeedItems({ locale: "en" }), []);
  assert.equal(await F.buildFeed({ instance: "actus" }), null);
});

test("flux : un lien d'entrée externe est suivi si l'instance ouvre les liens, sinon la page de l'entrée", async () => {
  const a = await blog("Liens");
  await publish(a.id, "Externe", "2026-01-01", { url: "https://autre.example/page" });
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { clickAction: "external" } });
  assert.equal((await F.collectFeedItems({ locale: "en" }))[0].link, "https://autre.example/page");
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { clickAction: "detail" } });
  assert.match((await F.collectFeedItems({ locale: "en" }))[0].link, /\/[a-z0-9-]+\/externe$/);
});

test("flux complet : titre du site, langue valide ou repli, instance inconnue → null", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr", "en"]);
  await setSetting("site.name", "Ma curiosa", "fr");
  await setSetting("site.name", "My showcase", "en");
  const a = await blog("Actus", { fr: "Actus", en: "News" });
  const fr = await F.buildFeed({});
  assert.equal(fr.title, "Ma curiosa");
  assert.equal(fr.language, "fr");
  assert.equal((await F.buildFeed({ locale: "en" })).title, "My showcase");
  assert.equal((await F.buildFeed({ locale: "xx" })).language, "fr", "langue non activée → langue par défaut");
  assert.equal((await F.buildFeed({ locale: "en", instance: "actus" })).title, "My showcase — News");
  assert.equal(await F.buildFeed({ instance: "inconnue" }), null);
  assert.ok(a);
});

const FEED_PROVIDER = {
  "module.json": { apiVersion: 2, version: "1.0.0", id: "agenda", name: "Agenda", provides: [{ topic: "feed.item" }], main: "index.mjs" },
  "index.mjs": `export default { exports: { "feed.item": () => [
    { id: "ev1", title: "Concert", url: "/agenda/concert", summary: "Ce soir", publishedAt: "2026-02-10T10:00:00Z" },
    { title: "Sans url" },
    { title: "Dangereux", url: "javascript:alert(1)" },
    { title: "Externe", url: "https://billet.example/x", publishedAt: "pas une date" },
  ] } };`,
};

test("flux : un module peut proposer des éléments (sujet feed.item), validés — adresses dangereuses et éléments invalides écartés", async () => {
  await installModule(makeRepo(FEED_PROVIDER).url);

  const mod = await R.getModule("agenda");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { en: "Agenda" } });
  const items = await F.collectFeedItems({ locale: "en" });
  assert.deepEqual(items.map((i) => i.title), ["Concert", "Externe"]);
  const concert = items.find((i) => i.title === "Concert");
  assert.match(concert.link, /^http.*\/agenda\/concert$/, "chemin du site rendu absolu");
  assert.equal(concert.id, "ev1");
  assert.equal(items.find((i) => i.title === "Externe").publishedAt, null, "date illisible ignorée");
  assert.ok(!items.some((i) => /javascript/.test(i.link)));
  assert.equal((await F.buildFeed({ instance: "agenda" })).items.length, 2);
});

test("flux : un module fournisseur en panne ne casse pas le flux", async () => {
  await installModule(makeRepo({ ...FEED_PROVIDER, "index.mjs": `export default { exports: { "feed.item": () => { throw new Error("panne"); } } };` }).url);

  const mod = await R.getModule("agenda");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { en: "Agenda" } });
  const a = await blog("Actus");
  await publish(a.id, "Reste", "2026-01-01");
  const log = console.error; console.error = () => {};
  try { assert.deepEqual((await F.collectFeedItems({ locale: "en" })).map((i) => i.title), ["Reste"]); } finally { console.error = log; }
});

/* ───────────── Rubriques (abonnement à un sous-ensemble) ───────────── */

const AGENDA = (items) => ({
  ...FEED_PROVIDER,
  "index.mjs": `export default { exports: { "feed.item": () => ${JSON.stringify(items)} } };`,
});
async function agenda(items) {
  await installModule(makeRepo(AGENDA(items)).url);

  await createInstance(db.prisma, { manifest: (await R.getModule("agenda")).manifest, names: { en: "Agenda" } });
}

test("rubriques : syntaxe vérifiée, doublons et valeurs invalides retirés, 20 au plus", () => {
  assert.deepEqual(F.parseTopics("announcement, Announcement,@blog"), ["announcement", "@blog"]);
  assert.deepEqual(F.parseTopics("a b,../x,blog/actus,<script>,,@@x,@,UPPER"), ["upper"]);
  assert.deepEqual(F.parseTopics(null), []);
  assert.deepEqual(F.parseTopics(""), []);
  assert.equal(F.parseTopics(Array.from({ length: 50 }, (_, i) => `t${i}`).join(",")).length, 20);
});

test("rubriques : chaque entrée porte « @instance » et ses étiquettes, normalisées (accents, casse)", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Un", "2026-01-01", { tags: ["Café Society", "News"] });
  assert.deepEqual((await F.collectFeedItems({ locale: "en" }))[0].topics, ["@actus", "cafe-society", "news"]);
});

test("rubriques : PLUSIEURS modules publient sur la même rubrique, l'abonné les reçoit tous", async () => {
  const a = await blog("Actus"), b = await blog("Videos");
  await publish(a.id, "Blog announcement", "2026-03-01", { tags: ["announcement"] });
  await publish(b.id, "Video announcement", "2026-02-01", { tags: ["Announcement"] });
  await publish(a.id, "Backstage", "2026-01-15", { tags: ["backstage"] });
  await agenda([{ title: "Concert announcement", url: "/agenda/c", topics: ["announcement", "concert"], publishedAt: "2026-01-01T00:00:00Z" }, { title: "Workshop", url: "/agenda/a", topics: ["workshop"] }]);
  const titles = async (topics, instance) => (await F.collectFeedItems({ locale: "en", topics, instance })).map((i) => i.title);
  assert.deepEqual(await titles(["announcement"]), ["Blog announcement", "Video announcement", "Concert announcement"], "trois modules, une rubrique");
  const feed = await F.buildFeed({ locale: "en", topics: ["announcement"] });
  assert.equal(feed.items.length, 3);
  assert.deepEqual(await titles(["announcement", "workshop"]), ["Blog announcement", "Video announcement", "Concert announcement", "Workshop"], "OU entre rubriques ; sans date à la fin");
  assert.deepEqual(await titles(["concert"]), ["Concert announcement"]);
  assert.deepEqual(await titles(["announcement"], "videos"), ["Video announcement"], "une rubrique, limitée à une instance");
  assert.deepEqual(await titles(["announcement"]), await titles(["announcement"]), "déterministe");
});

test("rubriques : « @instance » suit tout ce qu'une instance publie, quelles que soient ses rubriques", async () => {
  const a = await blog("Actus"), b = await blog("Videos");
  await publish(a.id, "Un", "2026-03-01", { tags: ["x"] });
  await publish(a.id, "Deux", "2026-02-01");
  await publish(b.id, "Trois", "2026-01-01");
  assert.deepEqual((await F.collectFeedItems({ locale: "en", topics: ["@actus"] })).map((i) => i.title), ["Un", "Deux"]);
  assert.deepEqual((await F.collectFeedItems({ locale: "en", topics: ["@actus", "@videos"] })).length, 3);
});

test("rubriques : un module ne peut pas se faire passer pour une instance (@ réservé au cœur)", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Vrai", "2026-01-01");
  await agenda([{ title: "Intrus", url: "/x", topics: ["@actus", "@@actus", "../actus", "actus/x"] }]);
  const actus = await F.collectFeedItems({ locale: "en", topics: ["@actus"] });
  assert.deepEqual(actus.map((i) => i.title), ["Vrai"], "l'abonné à @actus ne reçoit pas l'intrus");
  const intrus = (await F.collectFeedItems({ locale: "en" })).find((i) => i.title === "Intrus");
  assert.equal(intrus.topics[0], "@agenda");
  assert.ok(intrus.topics.slice(1).every((t) => /^[a-z0-9-]+$/.test(t)), JSON.stringify(intrus.topics));
});

test("rubriques : le catalogue distingue rubriques partagées et instances, avec compteurs et fournisseurs", async () => {
  const a = await blog("Actus", { en: "News" });
  await publish(a.id, "Un", "2026-01-01", { tags: ["announcement"] });
  await publish(a.id, "Deux", "2026-01-02");
  await agenda([{ title: "C", url: "/c", topics: ["announcement", "concert"] }]);
  const list = await F.listFeedTopics("en");
  const by = Object.fromEntries(list.map((t) => [t.id, t]));
  assert.deepEqual(Object.keys(by), ["@actus", "@agenda", "announcement", "concert"]);
  assert.deepEqual([by["@actus"].kind, by["@actus"].label, by["@actus"].count], ["instance", "News", 2]);
  assert.deepEqual([by.announcement.kind, by.announcement.count, by.announcement.instances], ["topic", 2, ["actus", "agenda"]], "alimentée par deux modules");
  assert.deepEqual(by.concert.instances, ["agenda"]);
  assert.deepEqual(await F.listFeedTopics("xx"), await F.listFeedTopics("en"), "langue inconnue → langue par défaut");
});

test("rubriques : un flux filtré rappelle ses rubriques ; rubriques toutes inconnues → pas de flux", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Un", "2026-01-01", { tags: ["promo"] });
  const feed = await F.buildFeed({ locale: "en", topics: ["promo", "nope"] });
  assert.ok(feed.title.endsWith("— promo, nope"));
  assert.ok(feed.self.includes("topics=promo,nope"));
  assert.equal(feed.items.length, 1);
  assert.equal(await F.buildFeed({ locale: "en", topics: ["nope", "@autre"] }), null);
  assert.equal((await F.buildFeed({ locale: "en", topics: [] })).items.length, 1);
  assert.equal((await F.buildFeed({ locale: "en", instance: "actus", topics: ["promo"] })).items.length, 1);
});

/* ───────────── Contenu exposé : seul le public sort ───────────── */

test("flux : brouillon, publication planifiée dans le futur et entrée expirée n'apparaissent jamais", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Public", "2026-01-01");
  await createEntry(db.prisma, { instanceId: a.id, locale: "en", title: "Brouillon" });
  await publish(a.id, "Planifié", "2999-01-01");
  await publish(a.id, "Périmé", "2026-01-02", { expiresAt: new Date("2026-01-03") });
  const items = await F.collectFeedItems({ locale: "en" });
  assert.deepEqual(items.map((i) => i.title), ["Public"]);
  // Même avec une horloge avancée dans le futur, le « planifié » ne devient public que lorsque la base le dit publié ET daté : la requête filtre déjà.
  const xml = F.renderRss(await F.buildFeed({ locale: "en" }));
  assert.ok(!xml.includes("Brouillon") && !xml.includes("Planifié") && !xml.includes("Périmé"));
});

test("flux : la limite s'applique APRÈS le tri par date, même si l'instance est triée autrement (du plus ancien au plus récent)", async () => {
  const a = await blog("Actus");
  await setSetting(`instance.${a.id}.__sort`, "oldest"); // l'instance affiche du plus ancien au plus récent : le flux, non
  for (let i = 0; i < 6; i++) await publish(a.id, `Z${i}`, `2026-01-0${i + 1}`);
  await publish(a.id, "A-ancien", "2025-01-01");
  const items = await F.collectFeedItems({ locale: "en", limit: 3 });
  assert.deepEqual(items.map((i) => i.title), ["Z5", "Z4", "Z3"], "les trois plus récents, pas les trois plus anciens");
});

test("flux : borne du nombre d'éléments (100 au plus, 1 au moins)", async () => {
  const a = await blog("Actus");
  for (let i = 0; i < 3; i++) await publish(a.id, `N${i}`, `2026-01-0${i + 1}`);
  assert.equal((await F.collectFeedItems({ locale: "en", limit: 100000 })).length, 3);
  assert.equal((await F.collectFeedItems({ locale: "en", limit: 0 })).length, 1);
  assert.equal(F.FEED_MAX_ITEMS, 100);
});

test("flux : sans résumé, un court extrait du texte ; la couverture devient une adresse absolue", async () => {
  const a = await blog("Actus");
  const e = await publish(a.id, "Avec texte", "2026-01-01", { body: "# Titre\n\nUn **beau** [lien](https://x.test) et ![img](/a.png) <b>html</b>.", cover: "/uploads/c.png" });
  const [item] = await F.collectFeedItems({ locale: "en" });
  assert.equal(item.summary, "Titre Un beau lien et html .");
  assert.match(item.image, /^http.*\/uploads\/c\.png$/);
  assert.ok(e);
  assert.equal(F.excerpt("x".repeat(500)).length <= 281, true);
  assert.ok(F.excerpt("mot ".repeat(200)).endsWith("…"));
});

test("flux : un module ne peut pas annoncer le futur ni répéter un identifiant", async () => {
  await agenda([
    { id: "a", title: "Passé", url: "/p", publishedAt: "2026-01-01T00:00:00Z" },
    { id: "b", title: "Futur", url: "/f", publishedAt: "2999-01-01T00:00:00Z" },
    { id: "a", title: "Doublon", url: "/d", publishedAt: "2026-01-02T00:00:00Z" },
    { id: "c", title: "Protocole", url: "//autre.example/x" },
  ]);
  assert.deepEqual((await F.collectFeedItems({ locale: "en" })).map((i) => i.title), ["Passé"]);
});

test("rendu : titre piégé (]]>, balises, guillemets) échappé, le XML reste bien formé ; rubriques en <category> ; image en <enclosure>", () => {
  const xml = F.renderRss({ title: "T", link: "https://x.test", description: "d", language: "fr", self: "https://x.test/feed.xml?lang=fr", items: [
    { id: "g", title: "a ]]> <img src=x onerror=alert(1)> \"q\" 'r' &amp;", link: "https://x.test/a?x=1&y=2", summary: "<![CDATA[ x ]]>", publishedAt: new Date("2026-01-02T03:04:05Z"), topics: ["@blog", "annonce"], image: "https://x.test/c.png?v=1&w=2" },
  ] });
  assert.ok(!xml.includes("<img") && !xml.includes("<![CDATA[") && !xml.includes("]]>"));
  assert.ok(xml.includes("<category>annonce</category>") && !xml.includes("<category>@blog"));
  assert.ok(xml.includes('<enclosure url="https://x.test/c.png?v=1&amp;w=2" length="0" type="image/png"/>'));
  assert.ok(xml.includes("<atom:link href=\"https://x.test/feed.xml?lang=fr\" rel=\"self\""));
  assert.match(xml, /<pubDate>Fri, 02 Jan 2026 03:04:05 GMT<\/pubDate>/);
});

test("réponse HTTP : ETag stable, Last-Modified, cache ; 304 si rien n'a changé ; flux vide propre", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Un", "2026-01-01");
  const feed = await F.buildFeed({ locale: "en" });
  const first = F.rssResponse(new Request("https://x.test/feed.xml"), feed);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("content-type"), /^application\/rss\+xml; charset=utf-8$/);
  assert.equal(first.headers.get("cache-control"), "public, max-age=300");
  assert.equal(first.headers.get("last-modified"), "Thu, 01 Jan 2026 00:00:00 GMT");
  const etag = first.headers.get("etag");
  assert.equal(F.rssResponse(new Request("https://x.test/feed.xml"), feed).headers.get("etag"), etag, "stable d'un appel à l'autre");
  assert.equal(F.rssResponse(new Request("https://x.test/feed.xml", { headers: { "if-none-match": etag } }), feed).status, 304);
  assert.equal(F.rssResponse(new Request("https://x.test/feed.xml", { headers: { "if-none-match": `W/${etag}` } }), feed).status, 304);
  assert.equal(F.rssResponse(new Request("https://x.test/feed.xml", { headers: { "if-none-match": '"autre"' } }), feed).status, 200);
  assert.equal(F.rssResponse(new Request("https://x.test/feed.xml", { headers: { "if-modified-since": "Fri, 02 Jan 2026 00:00:00 GMT" } }), feed).status, 304);
  assert.equal(F.rssResponse(new Request("https://x.test/feed.xml", { headers: { "if-modified-since": "Wed, 31 Dec 2025 00:00:00 GMT" } }), feed).status, 200);
  const empty = F.rssResponse(new Request("https://x.test/feed.xml"), { title: "T", link: "l", description: "d", language: "en", self: "s", items: [] });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("last-modified"), null);
  assert.ok(!(await empty.text()).includes("<item>"));
});

/* ───────────── Icône du pied de page et bloc d'admin ───────────── */

test("source de flux : vrai seulement s'il y a une instance à contenu publique ou un module feed.item", async () => {
  assert.equal(await F.hasFeedSource(), false);
  const a = await blog("Actus");
  assert.equal(await F.hasFeedSource(), true, "avant même le premier article");
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { exposed: false } });
  assert.equal(await F.hasFeedSource(), false);
  await agenda([]);
  assert.equal(await F.hasFeedSource(), true, "un module qui fournit feed.item suffit");
});

test("réglage « icône du flux » : visible par défaut, masquable", async () => {
  const { getSiteConfig } = await import("@/core/settings");
  assert.equal((await getSiteConfig()).feedLink, true);
  await setSetting("feed.showLink", false);
  assert.equal((await getSiteConfig()).feedLink, false);
  await setSetting("feed.showLink", true);
  assert.equal((await getSiteConfig()).feedLink, true);
});

test("aperçu admin : adresse, compteur, 5 derniers, sources et rubriques", async () => {
  const a = await blog("Actus", { en: "News" });
  for (let i = 0; i < 7; i++) await publish(a.id, `P${i}`, `2026-01-0${i + 1}`, { tags: i < 2 ? ["annonce"] : [] });
  await createEntry(db.prisma, { instanceId: a.id, locale: "en", title: "Brouillon" });
  const o = await F.feedOverview("en");
  assert.match(o.url, /\/feed\.xml\?lang=en$/);
  assert.equal(o.count, 7);
  assert.deepEqual(o.latest.map((i) => i.title), ["P6", "P5", "P4", "P3", "P2"]);
  assert.deepEqual(o.sources.map((s) => [s.key, s.name, s.kind, s.count]), [["actus", "News", "entries", 7]]);
  assert.deepEqual(o.topics.map((t) => [t.id, t.count, t.names]), [["annonce", 2, ["News"]]]);
  assert.match(o.topics[0].url, /topics=annonce$/);
  assert.equal(F.feedPath("fr"), "/feed.xml?lang=fr");
});

test("pied de page : l'icône RSS est liée au réglage et à la présence d'une source, avec nom accessible", async () => {
  const fs = await import("node:fs");
  const footer = fs.readFileSync("src/components/site/Footer.tsx", "utf8");
  assert.match(footer, /config\.feedLink && \(await hasFeedSource\(\)\)/);
  assert.match(footer, /aria-label=\{t\("feed\.link"\)\}/);
  assert.match(footer, /href=\{feedPath\(locale\)\}/);
  assert.match(footer, /aria-hidden="true"/);
});
