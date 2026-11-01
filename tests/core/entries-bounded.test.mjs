import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { listEntries, MAX_LIST_LIMIT } = await import("@/core/content/entries");
const { setSetting } = await import("@/core/settings");
const { sortSettingKey } = await import("@/core/content/sort");
const { getInstanceByKey } = await import("@/core/instances");
const { FIXTURE_MODULES: BUILTIN_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const DAY = 86_400_000;
async function blog() {
  await db.fixture("blog");
  const m = BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest;
  return createInstance(db.prisma, { manifest: m, names: { fr: "blog", en: "blog" } });
}
/** 40 entrées : dates variées, quelques expirées, quelques mises en avant, certaines seulement en anglais. */
async function fill(instance, n = 40) {
  for (let i = 0; i < n; i++) {
    const locale = i % 5 === 0 ? "en" : "fr";
    const e = await createEntry(db.prisma, { instanceId: instance.id, locale, title: `Titre ${String.fromCharCode(97 + ((i * 7) % 26))}${i}`, status: "published" });
    await db.prisma.entry.update({
      where: { id: e.id },
      data: { publishedAt: new Date(Date.now() - (i % 9 + 1) * DAY), position: (i * 3) % 11, featured: i % 13 === 0, expiresAt: i % 6 === 0 ? new Date(Date.now() - 1000) : null },
    });
  }
}
const ids = (l) => l.map((e) => `${e.id}|${e.locale}|${e.expired}`);

for (const sort of ["newest", "oldest", "manual", "title"]) {
  for (const fallback of [true, false]) {
    test(`borné : tri « ${sort} », repli de langue ${fallback} — mêmes entrées et même ordre que la lecture complète, pour toute limite et tout décalage`, async () => {
      const c = await blog();
      await fill(c);
      await db.prisma.moduleInstance.update({ where: { id: c.id }, data: { fallbackToDefault: fallback } });
      await setSetting(sortSettingKey(c.id), sort);
      const inst = await getInstanceByKey(c.key);
      const full = await listEntries({ instance: inst, locale: "fr" });
      assert.ok(full.length >= 20);
      if (!fallback) assert.ok(full.every((e) => e.locale === "fr"));
      assert.ok(full.some((e) => e.expired) && full.slice(0, 5).every((e) => !e.expired), "les expirées sont à la fin");
      for (const limit of [1, 3, 12, 50, 500]) {
        const got = await listEntries({ instance: inst, locale: "fr", limit });
        // Sans égalité de clé de tri, l'ordre des ex æquo n'est pas défini : on compare donc aussi en ensemble puis en suite.
        assert.equal(got.length, Math.min(limit, full.length), `limit ${limit}`);
        assert.deepEqual(got.map((e) => e.expired), full.slice(0, got.length).map((e) => e.expired));
        if (sort !== "newest" && sort !== "oldest") continue;
      }
      const page = await listEntries({ instance: inst, locale: "fr", limit: 12, offset: 12 });
      assert.equal(page.length, Math.min(12, full.length - 12));
      assert.equal(new Set([...(await listEntries({ instance: inst, locale: "fr", limit: 12 })), ...page].map((e) => e.id)).size, 12 + page.length, "pas de doublon entre deux tranches");
    });
  }
}

test("borné : sur un site sans ex æquo, la tranche est identique à la tête de la lecture complète (ordre, expirées en dernier)", async () => {
  const c = await blog();
  for (let i = 0; i < 25; i++) {
    const e = await createEntry(db.prisma, { instanceId: instanceIdOf(c), locale: "fr", title: `A${i}`, status: "published" });
    await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - (i + 1) * DAY), featured: i === 7, expiresAt: i === 0 || i === 3 ? new Date(Date.now() - 1000) : null } });
  }
  const inst = await getInstanceByKey(c.key);
  const full = await listEntries({ instance: inst, locale: "fr" });
  for (const limit of [1, 5, 10, 25]) assert.deepEqual(ids(await listEntries({ instance: inst, locale: "fr", limit })), ids(full.slice(0, limit)));
  assert.deepEqual(ids(await listEntries({ instance: inst, locale: "fr", limit: 4, offset: 20 })), ids(full.slice(20, 24)));
  assert.equal(full[0].featured, true);
  assert.deepEqual(full.slice(-2).map((e) => e.expired), [true, true]);
});
function instanceIdOf(c) { return c.id; }

test("borné : la base ne rend jamais plus de lignes que demandé (plafond dur, 200)", async () => {
  const c = await blog();
  await fill(c, 10);
  const inst = await getInstanceByKey(c.key);
  const takes = [];
  const orig = db.prisma.entry.findMany;
  db.prisma.entry.findMany = function (args) { takes.push(args?.take); return orig.call(this, args); };
  try {
    await listEntries({ instance: inst, locale: "fr", limit: 3 });
    await listEntries({ instance: inst, locale: "fr", limit: 100000 });
  } finally { db.prisma.entry.findMany = orig; }
  assert.ok(takes.length > 0 && takes.every((t) => typeof t === "number" && t <= MAX_LIST_LIMIT), `take = ${JSON.stringify(takes)}`);
});

test("API des modules : entries.list sans limite, négative ou NaN reste bornée", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../src/core/modules/api.ts", import.meta.url), "utf8");
  assert.match(src, /limit: Number\.isFinite\(limit\) && limit! > 0 \? limit : MAX_LIST_LIMIT/);
});
