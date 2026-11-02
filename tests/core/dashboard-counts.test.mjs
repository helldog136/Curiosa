import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { dashboardEntryCounts, entryStateCounts, sumByItem, listDrafts, unlistedEntries } = await import("@/core/content/dashboardCounts");
const { listAdminEntries } = await import("@/core/content/adminList");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
async function inst(id, nickname) {
  await db.fixture(id);
  const manifest = FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
  return createInstance(db.prisma, { manifest, names: { en: nickname, fr: nickname }, nickname });
}
const add = (i, title, status) => createEntry(db.prisma, { instanceId: i.id, locale: "en", title, status });
const item = (i, name, extra = {}) => ({ id: i.id, key: i.key, name, icon: "x", content: true, error: false, ...extra });

async function site() {
  const blog = await inst("blog", "blog"), pages = await inst("pages", "pages"), links = await inst("links", "links");
  await add(blog, "Article", "published");
  await add(pages, "Brouillon page", "draft");
  await add(links, "Brouillon lien", "draft");
  return { blog, pages, links };
}

test("les brouillons sont comptés par extension, avec leur nom", async () => {
  const { blog, pages, links } = await site();
  const c = await dashboardEntryCounts([item(blog, "Blog"), item(pages, "Pages"), item(links, "Liste de liens")]);
  assert.equal(c.published.total, 1);
  assert.deepEqual(c.published.parts.map((p) => [p.name, p.n]), [["Blog", 1]]);
  assert.equal(c.draft.total, 2);
  assert.deepEqual(c.draft.parts.map((p) => [p.name, p.n]).sort(), [["Liste de liens", 1], ["Pages", 1]]);
});

test("une extension désinstallée, sans liste ou en erreur n'est pas comptée", async () => {
  const { blog, pages, links } = await site();
  // « désinstallée » : absente de la navigation, alors que ses entrées restent en base.
  assert.equal((await dashboardEntryCounts([item(blog, "Blog"), item(links, "Liens")])).draft.total, 1);
  assert.equal((await dashboardEntryCounts([item(blog, "Blog"), item(pages, "Pages", { content: false }), item(links, "Liens", { error: true })])).draft.total, 0);
  assert.deepEqual(await dashboardEntryCounts([]), { published: { total: 0, parts: [] }, draft: { total: 0, parts: [] } });
});

test("une entrée programmée ou expirée n'est ni publiée ni brouillon, comme dans la liste", async () => {
  const blog = await inst("blog", "blog");
  const live = await add(blog, "Visible", "published");
  const future = await add(blog, "Plus tard", "published");
  const past = await add(blog, "Fini", "published");
  await db.prisma.entry.update({ where: { id: future.id }, data: { publishedAt: new Date(Date.now() + 864e5) } });
  await db.prisma.entry.update({ where: { id: past.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  void live;
  const c = await dashboardEntryCounts([item(blog, "Blog")]);
  assert.equal(c.published.total, 1);
  assert.equal(c.draft.total, 0);
  const n = await entryStateCounts(blog.id);
  assert.deepEqual([n.all, n.published, n.draft, n.scheduled, n.expired], [3, 1, 0, 1, 1]);
});

test("la liste ouverte par la carte montre exactement les éléments comptés", async () => {
  const { blog, pages, links } = await site();
  const items = [item(blog, "Blog"), item(pages, "Pages"), item(links, "Liens")];
  const c = await dashboardEntryCounts(items);
  for (const [state, count] of [["draft", c.draft], ["published", c.published]]) {
    for (const part of count.parts) {
      const i = [blog, pages, links].find((x) => x.key === part.key);
      const list = await listAdminEntries({ instance: i, defaultLocale: "en", page: 1, state });
      assert.equal(list.total, part.n, `${state} ${part.key}`);
    }
  }
  const n = await entryStateCounts(pages.id);
  assert.deepEqual([n.all, n.draft, n.published], [1, 1, 0]);
});

test("sumByItem : les extensions à zéro disparaissent, les plus fournies d'abord", () => {
  const items = [{ id: "a", key: "a", name: "A", icon: "", content: true, error: false }, { id: "b", key: "b", name: "B", icon: "", content: true, error: false }, { id: "c", key: "c", name: "C", icon: "", content: true, error: false }];
  const r = sumByItem(items, new Map([["a", 1], ["b", 3]]));
  assert.deepEqual(r.parts.map((p) => p.key), ["b", "a"]);
  assert.equal(r.total, 4);
});

test("À finir : les brouillons de tous les modules, avec leur nom, les plus récents d'abord, et un total complet", async () => {
  const { blog, pages, links } = await site();
  const items = [item(blog, "Blog"), item(pages, "Pages"), item(links, "Liste de liens")];
  const all = await listDrafts(items, "en", { limit: 5 });
  assert.equal(all.total, 2);
  assert.deepEqual(all.rows.map((r) => r.name).sort(), ["Liste de liens", "Pages"]);
  assert.ok(all.rows.every((r) => r.title));
  const one = await listDrafts(items, "en", { limit: 1 });
  assert.equal(one.rows.length, 1);
  assert.equal(one.total, 2, "le total ne dépend pas du nombre montré");
  assert.deepEqual((await listDrafts([item(blog, "Blog")], "en", { limit: 5 })).rows, [], "Blog n'a aucun brouillon");
  assert.deepEqual(await listDrafts([], "en", { limit: 5 }), { total: 0, rows: [] });
});

test("intégrité : la destination de chaque lien du tableau de bord contient au moins un des éléments comptés", async () => {
  const { blog, pages, links } = await site();
  const byKey = { blog, pages, links };
  const items = [item(blog, "Blog"), item(pages, "Pages"), item(links, "Liste de liens")];
  const c = await dashboardEntryCounts(items);
  // cartes « publiés » : /admin/entries?c=<clé>&state=published
  for (const p of c.published.parts) assert.ok((await listAdminEntries({ instance: byKey[p.key], defaultLocale: "en", page: 1, state: "published" })).total >= 1, p.key);
  // « À finir » : chaque « Ouvrir » mène à une entrée qui existe, et « Voir tous » (/admin/drafts) montre exactement le total
  const d = await listDrafts(items, "en", { limit: 5 });
  for (const r of d.rows) {
    assert.ok(await db.prisma.entry.findUnique({ where: { id: r.id } }), r.title);
    const list = await listAdminEntries({ instance: byKey[r.key], defaultLocale: "en", page: 1, state: "draft" });
    assert.ok(list.rows.some((e) => e.id === r.id), "elle figure aussi dans la liste filtrée de son extension");
  }
  assert.equal(d.total, c.draft.total);
});

test("éléments rangés dans une extension sans liste : jamais comptés, mais signalés en mode avancé", async () => {
  const { blog, pages, links } = await site();
  const faq = await inst("collection", "faq");
  await add(faq, "Question", "draft");
  const items = [item(blog, "Blog"), item(pages, "Pages"), item(links, "Liens"), item(faq, "Questions", { content: false })];
  assert.equal((await dashboardEntryCounts(items)).draft.total, 2);
  assert.equal((await listDrafts(items, "en", { limit: 5 })).total, 2);
  const u = await unlistedEntries(items);
  assert.equal(u.total, 1);
  assert.deepEqual(u.parts, [{ name: "Questions", n: 1 }]);
  assert.equal((await unlistedEntries([item(blog, "Blog"), item(pages, "Pages"), item(links, "Liens")])).parts[0].name, "", "extension retirée : pas de nom");
});

test("tableau de bord : flèche sur ce qui s'ouvre, rien sur ce qui n'est qu'un chiffre, mode simple épuré", () => {
  const page = read("src/app/admin/(panel)/page.tsx");
  assert.match(page, /\/admin\/entries\?c=\$\{p\.key\}&state=published/);
  assert.match(page, /href="\/admin\/drafts"/);
  assert.match(page, /\/admin\/entries\/\$\{d\.id\}/);
  assert.match(page, /dashboard\.draftsNone/, "état vide qui dit quoi");
  assert.ok(page.indexOf('data-testid="to-finish"') < page.indexOf('data-testid="in-numbers"'), "les brouillons passent avant les chiffres");
  const numbers = page.slice(page.indexOf('data-testid="in-numbers"'));
  assert.match(numbers, /redirects > 0 &&/, "Liens courts masqués s'il n'y en a pas");
  assert.match(numbers, /advanced && stat\(t\("dashboard\.instances"/);
  assert.match(numbers, /advanced && stat\(t\("dashboard\.modules"/);
  assert.match(numbers, /stat\(t\("dashboard\.extensions"/);
  assert.doesNotMatch(page, /dashboard\.drafts"/, "plus de carte « Brouillons » sans destination claire");
  const plain = page.slice(page.indexOf("const plain"), page.indexOf("const link"));
  assert.doesNotMatch(plain, /hover:/, "un bloc informatif n'a pas l'allure d'un bouton");
  const list = read("src/app/admin/(panel)/entries/page.tsx");
  assert.match(list, /entries-state-chips/);
  assert.match(list, /entryStateCounts/);
  assert.match(read("src/app/admin/(panel)/drafts/page.tsx"), /adminCtx\("editor"\)/);
});

test("textes : français et anglais, vouvoiement, pas de jargon en mode simple", () => {
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  for (const k of ["dashboard.toFinish", "dashboard.draftsAll", "dashboard.draftsNone", "dashboard.draftOpen", "dashboard.shortLinks", "dashboard.unlisted", "drafts.title", "drafts.intro", "drafts.empty", "drafts.count", "dashboard.extensions", "entries.chip.all", "entries.chip.published", "entries.chip.draft", "entries.chip.scheduled", "entries.chip.expired"]) {
    assert.ok(fr[k] && en[k], k);
    assert.deepEqual(fr[k].match(/\{\w+\}/g)?.sort(), en[k].match(/\{\w+\}/g)?.sort(), `variables ${k}`);
  }
  assert.equal(fr["dashboard.published"], "Contenus publiés");
  assert.doesNotMatch(Object.entries(fr).filter(([k]) => /^(dashboard\.(toFinish|draft|shortLinks|extensions)|drafts\.)/.test(k)).map(([, v]) => v).join(" "), /instance|entrée/i);
  assert.equal(fr["dashboard.extensions"], "Extensions installées");
  assert.doesNotMatch(fr["dashboard.extensions"], /instance|module/i);
});
