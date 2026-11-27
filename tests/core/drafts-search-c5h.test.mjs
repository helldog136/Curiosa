// Admin redesign C5h: the drafts page search asks the server (R15), over every translation, without changing what the list shows without a search.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { listDrafts } = await import("@/core/content/dashboardCounts");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

async function inst(id, nickname) {
  await db.fixture(id);
  const manifest = FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
  return createInstance(db.prisma, { manifest, names: { en: nickname, fr: nickname }, nickname });
}
const item = (i, name) => ({ id: i.id, key: i.key, name, icon: "x", content: true, error: false });

test("drafts: a search filters in the query (total and rows), is case-tolerant, and an empty search changes nothing", async () => {
  const pages = await inst("pages", "pages"), links = await inst("links", "links");
  await createEntry(db.prisma, { instanceId: pages.id, locale: "en", title: "Summer plan", status: "draft" });
  await createEntry(db.prisma, { instanceId: links.id, locale: "en", title: "Winter list", status: "draft" });
  await createEntry(db.prisma, { instanceId: links.id, locale: "en", title: "Summer holiday", status: "published" });
  const items = [item(pages, "Pages"), item(links, "Links")];
  assert.equal((await listDrafts(items, "en", { limit: 50 })).total, 2);
  assert.equal((await listDrafts(items, "en", { limit: 50, q: "" })).total, 2);
  const found = await listDrafts(items, "en", { limit: 50, q: "summer" });
  assert.equal(found.total, 1, "a published entry never shows up among the drafts");
  assert.deepEqual(found.rows.map((r) => r.title), ["Summer plan"]);
  assert.equal((await listDrafts(items, "en", { limit: 50, q: "WINTER" })).total, 1);
  assert.equal((await listDrafts(items, "en", { limit: 50, q: "nothing here" })).total, 0);
});
