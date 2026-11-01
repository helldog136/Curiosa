import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { dashboardEntryCounts, entryStateCounts, sumByItem } = await import("@/core/content/dashboardCounts");
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

test("tableau de bord : liens vers la liste filtrée, carte unique en mode simple, instances en avancé", () => {
  const page = read("src/app/admin/(panel)/page.tsx");
  assert.match(page, /\/admin\/entries\?c=\$\{key\}&state=\$\{state\}/);
  assert.match(page, /entryStat\(t\("dashboard\.drafts"\), counts\.draft, "draft"/);
  const simple = page.slice(page.indexOf(") : ("), page.indexOf("</section>", page.indexOf('data-testid="in-numbers"')));
  assert.match(simple, /dashboard\.extensions/);
  assert.doesNotMatch(simple, /dashboard\.instances|dashboard\.modules/);
  assert.match(page, /advanced \? \([\s\S]*dashboard\.instances[\s\S]*dashboard\.modules/);
  const list = read("src/app/admin/(panel)/entries/page.tsx");
  assert.match(list, /entries-state-chips/);
  assert.match(list, /entryStateCounts/);
});

test("textes : français et anglais, vouvoiement, pas de jargon en mode simple", () => {
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  for (const k of ["dashboard.entriesIn", "dashboard.extensions", "entries.chip.all", "entries.chip.published", "entries.chip.draft", "entries.chip.scheduled", "entries.chip.expired"]) {
    assert.ok(fr[k] && en[k], k);
    assert.deepEqual(fr[k].match(/\{\w+\}/g)?.sort(), en[k].match(/\{\w+\}/g)?.sort(), `variables ${k}`);
  }
  assert.equal(fr["dashboard.extensions"], "Extensions installées");
  assert.doesNotMatch(fr["dashboard.extensions"], /instance|module/i);
});
