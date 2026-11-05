// Process-level settings cache: one read of the table serves many getSetting calls, and every write made through the client is seen by the very next read.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { getSetting, getSettingByLocale, setSetting, deleteSetting, getSiteConfig, resetSettingsCache } = await import("@/core/settings");
const { prisma } = db;
beforeEach(async () => { await db.reset(); resetSettingsCache(); });
after(() => db.close());

/** Counts the `Setting` reads made by `fn` (the client's own `findMany`). */
async function countReads(fn) {
  const original = prisma.setting.findMany;
  let n = 0;
  prisma.setting.findMany = (...args) => { n++; return original.apply(prisma.setting, args); };
  try { await fn(); } finally { prisma.setting.findMany = original; }
  return n;
}

test("many getSetting calls outside a page render read the table once", async () => {
  await setSetting("a", 1); await setSetting("b", "x", "fr");
  const reads = await countReads(async () => { for (let i = 0; i < 200; i++) { await getSetting("a"); await getSetting("b", "fr"); } });
  assert.ok(reads <= 1, `expected one read, got ${reads}`);
});

test("every write through the client is visible to the next read: set, overwrite, delete, createMany, transaction, deleteMany", async () => {
  await setSetting("k", "one");
  assert.equal(await getSetting("k"), "one");
  await setSetting("k", "two");
  assert.equal(await getSetting("k"), "two", "upsert");
  await deleteSetting("k");
  assert.equal(await getSetting("k"), undefined, "delete");
  await prisma.setting.createMany({ data: [{ key: "m1", locale: "", value: "1" }, { key: "m2", locale: "en", value: "\"v\"" }] });
  assert.equal(await getSetting("m1"), 1, "createMany");
  assert.deepEqual(await getSettingByLocale("m2"), { en: "v" });
  await prisma.$transaction(async (tx) => { await tx.setting.update({ where: { key_locale: { key: "m1", locale: "" } }, data: { value: "9" } }); });
  assert.equal(await getSetting("m1"), 9, "interactive transaction");
  await prisma.setting.deleteMany();
  assert.equal(await getSetting("m1"), undefined, "deleteMany");
});

test("locale fallback is unchanged: asked locale, then the plain value, then the site default locale", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("t", "bonjour", "fr"); await setSetting("t", "hello", "en");
  assert.equal(await getSetting("t", "en"), "hello");
  assert.equal(await getSetting("t", "de"), "bonjour", "falls back to the default locale");
  await setSetting("t", "plain");
  assert.equal(await getSetting("t", "de"), "plain", "the plain value comes before the default locale");
});

test("a caller that mutates a value cannot change what the next read sees", async () => {
  await setSetting("list", [1, 2]);
  const first = await getSetting("list");
  first.push(3);
  assert.deepEqual(await getSetting("list"), [1, 2]);
});

test("unreadable JSON is skipped like before", async () => {
  await prisma.setting.create({ data: { key: "bad", locale: "", value: "{not json" } });
  assert.equal(await getSetting("bad"), undefined);
  assert.deepEqual(await getSettingByLocale("bad"), {});
});

test("a write made behind the client's back is picked up after the safety delay (reset stands in for it)", async () => {
  await setSetting("x", 1);
  assert.equal(await getSetting("x"), 1);
  await prisma.$executeRawUnsafe("UPDATE Setting SET value = '2' WHERE key = 'x'");
  assert.equal(await getSetting("x"), 1, "raw SQL is not seen until the delay or a reset");
  resetSettingsCache();
  assert.equal(await getSetting("x"), 2);
});

test("getSiteConfig reflects a setting changed just before", async () => {
  await setSetting("site.name", "First");
  assert.equal((await getSiteConfig()).name, "First");
  await setSetting("site.name", "Second");
  // getSiteConfig is memoised per render by React `cache`; outside a render it recomputes
  assert.equal((await getSiteConfig()).name, "Second");
});
