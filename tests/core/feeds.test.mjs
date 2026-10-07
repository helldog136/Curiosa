import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const F = await import("@/core/feeds");
const { installModule, setModuleEnabled } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const { BUILTIN_MODULES } = await import("@/modules-builtin");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
async function blog(nickname, names = { en: nickname ?? "Blog" }) {
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
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
  await setSetting("site.name", "Ma vitrine", "fr");
  await setSetting("site.name", "My showcase", "en");
  const a = await blog("Actus", { fr: "Actus", en: "News" });
  const fr = await F.buildFeed({});
  assert.equal(fr.title, "Ma vitrine");
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
  await setModuleEnabled("agenda", true);
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
  await setModuleEnabled("agenda", true);
  const mod = await R.getModule("agenda");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { en: "Agenda" } });
  const a = await blog("Actus");
  await publish(a.id, "Reste", "2026-01-01");
  const log = console.error; console.error = () => {};
  try { assert.deepEqual((await F.collectFeedItems({ locale: "en" })).map((i) => i.title), ["Reste"]); } finally { console.error = log; }
});
