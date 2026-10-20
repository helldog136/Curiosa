import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const E = await import("@/core/content/entries");
const P = await import("@/core/content/pagination");
const A = await import("@/core/content/adminList");
const { setSetting } = await import("@/core/settings");
const { sortSettingKey } = await import("@/core/content/sort");
const { getInstanceByKey } = await import("@/core/instances");
const R = await import("@/core/modules/registry");
const F = await import("@/core/feeds");
const { FIXTURE_MODULES: BUILTIN_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
async function blog(nickname = "blog", id = "blog") {
  await db.fixture(id);
  return createInstance(db.prisma, { manifest: manifest(id), names: { en: nickname, fr: nickname }, nickname });
}
const DAY = 86_400_000;
/** `n` entrées publiées, la i-ième parue il y a i jours : « Article 0 » est la plus récente. */
async function fill(instance, n, { locale = "en", expired = [] } = {}) {
  for (let i = 0; i < n; i++) {
    const e = await createEntry(db.prisma, { instanceId: instance.id, locale, title: `Article ${i}`, status: "published" });
    await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - (i + 1) * DAY), expiresAt: expired.includes(i) ? new Date(Date.now() - 1000) : null } });
  }
}
const titles = (page) => page.items.map((e) => e.title);

test("page : 30 entrées dont 3 expirées — pages 1 à 3 au bon contenu, les expirées à la fin", async () => {
  const c = await blog();
  await fill(c, 30, { expired: [0, 1, 15] });   // les deux plus récentes sont expirées : elles passent quand même après les autres
  const pages = [];
  for (const n of [1, 2, 3]) pages.push(await E.listEntriesPage({ instance: c.key, locale: "en", page: n }));
  assert.deepEqual(pages.map((p) => [p.page, p.pages, p.total, p.items.length]), [[1, 3, 30, 12], [2, 3, 30, 12], [3, 3, 30, 6]]);
  const all = pages.flatMap(titles);
  assert.equal(new Set(all).size, 30, "aucun doublon, aucun oubli");
  const expectedFresh = Array.from({ length: 30 }, (_, i) => i).filter((i) => ![0, 1, 15].includes(i)).map((i) => `Article ${i}`);
  assert.deepEqual(all.slice(0, 27), expectedFresh, "non expirées, plus récentes d'abord");
  assert.deepEqual(new Set(all.slice(27)), new Set(["Article 0", "Article 1", "Article 15"]), "expirées à la fin");
  assert.ok(pages[2].items.slice(3).every((e) => e.expired) && pages[2].items.slice(0, 3).every((e) => !e.expired));
  // Même résultat que la lecture complète historique.
  assert.deepEqual(all, (await E.listEntries({ instance: c.key, locale: "en" })).map((e) => e.title));
});

test("page : hors plage — vide, nombre de pages exact ; valeur invalide ramenée à 1 ; perPage borné à 50", async () => {
  const c = await blog();
  await fill(c, 13);
  const out = await E.listEntriesPage({ instance: c.key, locale: "en", page: 99 });
  assert.deepEqual([out.items.length, out.page, out.pages, out.total], [0, 99, 2, 13]);
  assert.equal((await E.listEntriesPage({ instance: c.key, locale: "en", page: 0 })).page, 1);
  assert.equal((await E.listEntriesPage({ instance: c.key, locale: "en", page: Number.NaN })).page, 1);
  assert.equal((await E.listEntriesPage({ instance: c.key, locale: "en", page: 1, perPage: 5000 })).perPage, 50);
  assert.equal((await E.listEntriesPage({ instance: c.key, locale: "en", page: 1, perPage: 5000 })).items.length, 13);
  const none = await E.listEntriesPage({ instance: "inconnue", locale: "en", page: 1 });
  assert.deepEqual([none.items.length, none.pages, none.total], [0, 1, 0]);
});

test("adresse ?page=N : 1, 0, abc, négatif, décimal, répété → invalide (redirection) ; 2 et plus → page", () => {
  assert.deepEqual(P.parsePageParam(undefined), { kind: "first" });
  for (const bad of ["1", "0", "abc", "-3", "2.5", "02", "", " 2", "1e3", "99999999", ["2", "3"]]) assert.deepEqual(P.parsePageParam(bad), { kind: "invalid" }, JSON.stringify(bad));
  assert.deepEqual(P.parsePageParam("2"), { kind: "page", page: 2 });
  assert.deepEqual(P.parsePageParam("99"), { kind: "page", page: 99 });
  assert.equal(P.pageHref("/blog", 1), "/blog");
  assert.equal(P.pageHref("/blog", 3), "/blog?page=3");
  assert.equal(P.pageHref("/admin/entries?c=blog", 2), "/admin/entries?c=blog&page=2");
  assert.deepEqual(P.pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(P.pageWindow(10, 20), [1, null, 9, 10, 11, null, 20]);
  assert.deepEqual(P.pageWindow(2, 20), [1, 2, 3, null, 20]);
});

test("non-régression : sous 12 entrées, la page 1 est exactement la liste d'avant, et aucune pagination n'est affichée", async () => {
  for (const sort of ["newest", "oldest", "title", "manual"]) {
    await db.reset();
    const c = await blog();
    await setSetting(sortSettingKey(c.id), sort);
    await fill(c, 11, { expired: [4] });
    const page = await E.listEntriesPage({ instance: c.key, locale: "en", page: 1 });
    assert.deepEqual(page.items.map((e) => e.id), (await E.listEntries({ instance: c.key, locale: "en" })).map((e) => e.id), sort);
    assert.equal(page.pages, 1, sort);
  }
  const nav = fs.readFileSync("src/components/site/Pagination.tsx", "utf8");
  assert.match(nav, /if \(pages <= 1\) return null/, "une seule page : rien à l'écran");
  const list = fs.readFileSync("src/app/(site)/[...path]/page.tsx", "utf8");
  assert.match(list, /<EntryList entries=\{entries\} collection=\{instance\} locale=\{locale\} defaultLocale=\{config\.defaultLocale\} \/>\s*<Pagination /, "la liste est rendue comme avant, la navigation vient après");
});

test("tri par titre : paginé en mémoire ; au-delà de 5 000 entrées, repli sur « plus récent » et signalé", async () => {
  const c = await blog();
  await setSetting(sortSettingKey(c.id), "title");
  for (const t of ["delta", "Alpha", "charlie", "Bravo", "echo", "Foxtrot", "golf", "Hotel", "india", "Juliet", "kilo", "Lima", "mike", "November"]) {
    await createEntry(db.prisma, { instanceId: c.id, locale: "en", title: t, status: "published" });
  }
  const p1 = await E.listEntriesPage({ instance: c.key, locale: "en", page: 1 });
  const p2 = await E.listEntriesPage({ instance: c.key, locale: "en", page: 2 });
  assert.deepEqual([...titles(p1), ...titles(p2)], ["Alpha", "Bravo", "charlie", "delta", "echo", "Foxtrot", "golf", "Hotel", "india", "Juliet", "kilo", "Lima", "mike", "November"]);
  assert.equal(p1.titleSortCapped, false);

  await db.prisma.entry.updateMany({ where: { instanceId: c.id }, data: { publishedAt: new Date(Date.now() - 10 * DAY) } });
  // 5 001 entrées créées d'un coup (ligne à ligne serait trop lent).
  const when = new Date(Date.now() - DAY);
  const ids = Array.from({ length: E.TITLE_SORT_MAX + 1 }, (_, i) => `bulk${String(i).padStart(5, "0")}`);
  await db.prisma.entry.createMany({ data: ids.map((id, i) => ({ id, instanceId: c.id, status: "published", publishedAt: new Date(when.getTime() - i * 1000), sourceLocale: "en" })) });
  await db.prisma.entryTranslation.createMany({ data: ids.map((id) => ({ entryId: id, instanceId: c.id, locale: "en", slug: id, title: `Zed ${id}` })) });
  const capped = await E.listEntriesPage({ instance: c.key, locale: "en", page: 1 });
  assert.equal(capped.titleSortCapped, true);
  assert.equal(capped.items.length, 12);
  assert.equal(capped.total, E.TITLE_SORT_MAX + 1 + 14);
  assert.deepEqual(titles(capped).slice(0, 2), ["Zed bulk00000", "Zed bulk00001"], "plus récent d'abord, pas par titre");
});

test("langues : une langue par liste ; avec repli, toute entrée apparaît une fois ; sans repli, seulement la langue demandée ; total = nombre affiché", async () => {
  const c = await blog();
  await fill(c, 14, { locale: "en" });
  for (let i = 0; i < 5; i++) {
    const e = await createEntry(db.prisma, { instanceId: c.id, locale: "fr", title: `Billet ${i}`, status: "published" });
    await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - (i + 40) * DAY) } });
  }
  const count = async (locale) => {
    const first = await E.listEntriesPage({ instance: c.key, locale, page: 1 });
    const second = await E.listEntriesPage({ instance: c.key, locale, page: 2 });
    return { first, shown: first.items.length + second.items.length };
  };
  await db.prisma.moduleInstance.update({ where: { id: c.id }, data: { fallbackToDefault: true } });
  let r = await count("fr");
  assert.equal(r.first.total, 19, "repli : les 14 articles anglais s'affichent aussi en français");
  assert.equal(r.shown, 19);
  await db.prisma.moduleInstance.update({ where: { id: c.id }, data: { fallbackToDefault: false } });
  r = await count("fr");
  assert.deepEqual([r.first.total, r.shown, r.first.pages], [5, 5, 1], "sans repli : seulement les 5 billets français");
  r = await count("en");
  assert.deepEqual([r.first.total, r.shown, r.first.pages], [14, 14, 2]);
  const ref = (await E.listEntries({ instance: await getInstanceByKey(c.key), locale: "fr" })).length;
  assert.equal(ref, 5, "même règle que la lecture complète");
});

test("RSS : 50 dernières entrées par instance, quel que soit le tri de l'instance ; expirées exclues", async () => {
  const c = await blog();
  await setSetting(sortSettingKey(c.id), "oldest");
  await fill(c, 70, { expired: [0] });
  assert.equal(F.FEED_DEFAULT_ITEMS, 50);
  const feed = await F.buildFeed({ locale: "en" });
  assert.equal(feed.items.length, 50);
  assert.equal(feed.items[0].title, "Article 1", "la plus récente non expirée");
  assert.equal(feed.items[49].title, "Article 50");
  const latest = await E.latestEntries({ instance: await getInstanceByKey(c.key), locale: "en", limit: 3 });
  assert.deepEqual(titles({ items: latest }), ["Article 1", "Article 2", "Article 3"]);
  assert.equal((await E.latestEntries({ instance: await getInstanceByKey(c.key), locale: "en", limit: 3, includeExpired: true }))[0].title, "Article 0");
  assert.equal((await E.latestEntries({ instance: await getInstanceByKey(c.key), locale: "en", limit: 100000 })).length, 69, "plafond de 100");
});

const consumer = { instance: { id: "consommateur" }, mod: { manifest: { id: "conso", consumes: [{ topic: "core.entry" }] } } };

test("sujet core.entry : curseur sans doublon ni oubli, 200 au plus par page, expirées écartées, curseur illisible refusé", async () => {
  const T = await import("@/core/services/topics");
  const a = await blog("alpha"), b = await blog("beta");
  await fill(a, 130, { expired: [3] });
  await fill(b, 100);
  const seen = [];
  let cursor;
  let calls = 0;
  do {
    const page = await T.collectPage(consumer, "core.entry", { locale: "en", limit: 200, cursor });
    assert.ok(page.items.length <= 200);
    seen.push(...page.items.map((i) => `${i.source.instance}:${i.title}`));
    cursor = page.next ?? undefined;
    calls++;
  } while (cursor && calls < 10);
  assert.equal(seen.length, 229, "129 + 100, l'expirée en moins");
  assert.equal(new Set(seen).size, 229, "pas de doublon");
  assert.ok(calls >= 2, "plusieurs pages");
  // Petites pages : même total.
  const small = [];
  cursor = undefined;
  for (let i = 0; i < 100; i++) {
    const page = await T.collectPage(consumer, "core.entry", { locale: "en", limit: 50, cursor });
    small.push(...page.items.map((x) => `${x.source.instance}:${x.title}`));
    if (!page.next) break;
    cursor = page.next;
  }
  assert.deepEqual(small, seen, "l'ordre ne dépend pas de la taille de page");
  assert.equal((await T.collectPage(consumer, "core.entry", { locale: "en", limit: 999 })).items.length, 200, "plafond 200");
  await assert.rejects(() => T.collectPage(consumer, "core.entry", { locale: "en", cursor: "pas-un-curseur" }), /invalid cursor/);
  await assert.rejects(() => T.collectPage(consumer, "core.entry", { locale: "en", cursor: Buffer.from(JSON.stringify(["inconnue", null])).toString("base64url") }), /invalid cursor/);
  assert.ok(R, "registre chargé");
});

test("sujet core.entry : filtre par rubrique sur plusieurs pages, la dernière page se termine par next = null", async () => {
  const T = await import("@/core/services/topics");
  const a = await blog("alpha");
  await fill(a, 30);
  const rows = await db.prisma.entry.findMany({ where: { instanceId: a.id }, orderBy: { publishedAt: "desc" } });
  for (const [i, r] of rows.entries()) if (i % 10 === 0) await db.prisma.entry.update({ where: { id: r.id }, data: { tags: '["promo"]' } });
  await T.setSources(consumer.instance.id, "core.entry", { instances: null, tags: ["promo"] });
  const page = await T.collectPage(consumer, "core.entry", { locale: "en", limit: 2 });
  assert.equal(page.items.length, 2);
  assert.ok(page.next);
  const rest = await T.collectPage(consumer, "core.entry", { locale: "en", limit: 2, cursor: page.next });
  assert.equal(rest.items.length, 1);
  assert.equal(rest.next, null);
});

test("MCP list_entries : 100 au plus + curseur ; forme d'avant (tableau) tant qu'il n'y a pas de page suivante", async () => {
  const { contentToolProvider } = await import("@/core/content/mcp");
  const c = await blog("alpha");
  await fill(c, 7);
  await db.prisma.entry.update({ where: { id: (await db.prisma.entry.findFirst({ where: { instanceId: c.id } })).id }, data: { status: "draft" } });
  const tools = await contentToolProvider.list();
  const list = tools.find((t) => t.name === `${c.key}__list_entries`);
  assert.deepEqual(list.input.properties.limit, { type: "integer", minimum: 1, maximum: 100 });
  assert.ok(list.input.properties.cursor);
  const all = await list.call({}, { name: "t", tokenId: "x" });
  assert.ok(Array.isArray(all) && all.length === 6, "publiées seulement, comme avant, en tableau");
  const first = await list.call({ limit: 4 }, { name: "t", tokenId: "x" });
  assert.equal(first.items.length, 4);
  assert.ok(typeof first.next === "string");
  const second = await list.call({ limit: 4, cursor: first.next }, { name: "t", tokenId: "x" });
  assert.equal(second.items.length, 2);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.items, ...second.items].map((i) => i.id)).size, 6, "pas de doublon");
  await assert.rejects(() => list.call({ cursor: "n'importe quoi" }, { name: "t", tokenId: "x" }), /invalid cursor/);
  const everything = await list.call({ status: "all", limit: 100 }, { name: "t", tokenId: "x" });
  assert.equal(everything.length, 7);
});

test("administration : 50 par page, recherche (titre et adresse), filtre d'état, insensible à la casse y compris hors ASCII", async () => {
  const c = await blog("alpha");
  await fill(c, 55);
  const inst = await getInstanceByKey(c.key);
  const page = (o) => A.listAdminEntries({ instance: inst, defaultLocale: "en", ...o });
  const p1 = await page({ page: 1 });
  assert.deepEqual([p1.rows.length, p1.pages, p1.total, p1.perPage], [50, 2, 55, 50]);
  assert.equal((await page({ page: 2 })).rows.length, 5);
  assert.equal((await page({ page: 99 })).page, 2, "page hors plage ramenée à la dernière");
  assert.equal((await page({ page: 1, q: "article 5" })).total, 6, "Article 5, 50 à 54, insensible à la casse");
  assert.equal((await page({ page: 1, q: "article-54" })).total, 1, "l'adresse (slug) est aussi cherchée");
  await createEntry(db.prisma, { instanceId: c.id, locale: "en", title: "Été indien", status: "published" });
  await createEntry(db.prisma, { instanceId: c.id, locale: "en", title: "Brouillon d'ÉTÉ" });
  assert.equal((await page({ page: 1, q: "été" })).total, 2, "É / é : SQLite seul ne les confond pas, les variantes de casse oui");
  assert.equal((await page({ page: 1, q: "ÉTÉ" })).total, 2);
  assert.equal((await page({ page: 1, q: "100%" })).total, 0, "le % cherché est un caractère, pas un joker");
  assert.equal((await page({ page: 1, q: "x".repeat(500) })).total, 0, "recherche bornée à 100 caractères");
  assert.equal((await page({ page: 1, state: "draft" })).total, 1);
  assert.equal((await page({ page: 1, state: "published" })).total, 56);
  await db.prisma.entry.updateMany({ where: { translations: { some: { title: "Été indien" } } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await page({ page: 1, state: "expired" })).total, 1);
  await db.prisma.entry.updateMany({ where: { translations: { some: { title: "Article 3" } } }, data: { publishedAt: new Date(Date.now() + DAY) } });
  assert.equal((await page({ page: 1, state: "scheduled" })).total, 1);
  assert.equal((await page({ page: 1, state: "published" })).total, 54);
  assert.equal(A.parseAdminState("n'importe quoi"), "all");
  assert.deepEqual(A.caseVariants("été").sort(), ["ÉTÉ", "Été", "été"].sort());
});

test("plan du site : inchangé sous 50 000 adresses ; au-delà, pages fixes + les plus récentes, 50 000 au plus", async () => {
  const S = await import("@/core/sitemap");
  const fixed = [{ url: "https://x.test/" }, { url: "https://x.test/blog" }];
  const entries = Array.from({ length: 49_998 }, (_, i) => ({ url: `https://x.test/blog/e${i}`, lastModified: new Date(1_700_000_000_000 + i * 1000) }));
  const ok = S.capSitemap(fixed, entries);
  assert.deepEqual([ok.urls.length, ok.truncated, ok.total], [50_000, false, 50_000]);
  assert.deepEqual(ok.urls, [...fixed, ...entries], "même contenu, même ordre");
  const over = S.capSitemap(fixed, [...entries, { url: "https://x.test/blog/vieux", lastModified: new Date(1000) }]);
  assert.deepEqual([over.urls.length, over.truncated, over.total], [50_000, true, 50_001]);
  assert.ok(!over.urls.some((u) => u.url.endsWith("/vieux")), "la plus ancienne est retirée");
  assert.ok(over.urls.slice(0, 2).every((u, i) => u.url === fixed[i].url), "pages fixes toujours conservées");
  // Journalisation unique.
  const seen = [];
  const original = console.error;
  console.error = (m) => seen.push(String(m));
  try {
    S.resetSitemapReport();
    await db.reset();
    await blog("alpha");
    await S.buildSitemap(1);
    await S.buildSitemap(1);
  } finally { console.error = original; }
  assert.equal(seen.filter((m) => m.includes("[sitemap]")).length, 1, "l'erreur n'est écrite qu'une fois");
});

test("accessibilité : navigation étiquetée, page courante, précédent/suivant, textes en français ET en anglais", () => {
  const nav = fs.readFileSync("src/components/site/Pagination.tsx", "utf8");
  assert.match(nav, /<nav aria-label=/);
  assert.match(nav, /aria-current/);
  assert.match(nav, /rel="prev"/);
  assert.match(nav, /rel="next"/);
  assert.match(nav, /aria-hidden="true">←/, "flèches décoratives masquées aux lecteurs d'écran");
  assert.match(nav, /min-h-11 min-w-11/, "cibles tactiles confortables");
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = Object.keys(fr).filter((k) => k.startsWith("site.pagination.") || /^entries\.(search|stateLabel|filter|clearFilter|noMatch|rangeCount|pagesLabel|titleSortCapped|state\.all)/.test(k) || k === "ai.sitemapTruncated");
  assert.ok(keys.length >= 15);
  for (const k of keys) assert.ok(en[k], `anglais manquant : ${k}`);
  assert.equal(fr["site.pagination.previous"], "Page précédente");
  assert.equal(fr["site.pagination.next"], "Page suivante");
  const page = fs.readFileSync("src/app/(site)/[...path]/page.tsx", "utf8");
  assert.match(page, /pagination: \{ previous:/, "rel=prev/next via metadata.pagination");
  assert.match(page, /languages: pageNo === 1 \? alt\.languages : undefined/, "hreflang seulement sur la page 1");
  assert.match(page, /if \(pageNo > data\.pages\) notFound\(\)/);
  assert.match(page, /param\.kind === "invalid"\) redirect\(listPath\)/);
});
