import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Instance lifecycle (src/core/instanceLifecycle.ts, src/core/instanceKeys.ts): one place creates an instance, one place erases its rows, one place spells the
// book-keeping keys. Behaviour is covered by the first-instance, seed-instance, instance-setup, data-migrations and default-instance-race tests; this file pins the guarantees.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { prisma } = db;
const cat = createCatalogue();
after(() => { cat.close(); return db.close(); });
const I = await import("@/core/modules/installer");
const { getModule } = await import("@/core/modules/registry");
const { addInstance, eraseInstanceRows, instanceRowErasures } = await import("@/core/instanceLifecycle");
const K = await import("@/core/instanceKeys");

const base = (over = {}) => ({
  manifest: { name: { fr: "Module", en: "Module" }, description: { fr: "d", en: "d" }, instances: "multiple", settings: [], permissions: [], ...(over.manifest ?? {}) },
  files: over.files ?? {},
});
const HOOK = "export default { hooks: { async onInstanceCreate(ctx) { await ctx.api.store.add('seen', { ok: 1 }); } } };";
const hooks = () => prisma.moduleRecord.count({ where: { collection: "seen" } });
const setting = async (key) => { const r = await prisma.setting.findFirst({ where: { key, locale: "" } }); return r ? JSON.parse(r.value) : undefined; };

beforeEach(async () => { await db.reset(); await cat.clear?.(); });

async function installed(id, over) {
  await cat.add(id, base(over));
  assert.equal((await I.installFromCatalogue(id, { firstInstance: false, dependencies: false })).ok, true);
  return (await getModule(id)).manifest;
}

test("key helpers: one spelling for the prefix and the book-keeping keys", () => {
  assert.equal(K.instanceKeyPrefix("abc"), "instance.abc.");
  assert.equal(K.instanceSettingKey("abc", "title"), "instance.abc.title");
  assert.equal(K.seenFeaturesKey("abc"), "instance.abc.__seenFeatures");
  assert.equal(K.dataVersionKey("abc"), "instance.abc.__dataVersion");
  assert.equal(K.dataStatusKey("abc"), "instance.abc.__dataStatus");
  assert.deepEqual(K.instanceSettingsWhere("abc"), { key: { startsWith: "instance.abc." } });
});

test("no source file other than instanceKeys.ts builds the __seenFeatures / __dataVersion / __dataStatus keys", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const offenders = [];
  for (const file of walk("src").filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))) {
    if (file.endsWith(path.join("core", "instanceKeys.ts"))) continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // comments may name the keys
      if (/__(seenFeatures|dataVersion|dataStatus)/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "use seenFeaturesKey / dataVersionKey / dataStatusKey (src/core/instanceKeys.ts)");
});

test("instances are created and erased through the lifecycle module only", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const calls = [];
  for (const file of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
    if (/core[\\/]instance(Lifecycle|Service)\.ts$/.test(file)) continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (/\bcreateInstance\(/.test(line) || /moduleInstance\.delete(Many)?\(/.test(line)) calls.push(`${file}:${i + 1}`);
    });
  }
  // Backup restore (stage.ts) wipes the whole table by design; retired.ts keeps its own strict `delete` (it must fail if the instance is already gone, so the snapshot rolls back).
  assert.deepEqual(calls.filter((c) => !/backup[\\/]conversion[\\/]stage\.ts|modules[\\/]retired\.ts/.test(c)), []);
});

test("addInstance: creates with default names and the book-keeping settings; the creation hook runs only when afterCommit is called", async () => {
  const manifest = await installed("lifecycle-a", { files: { "index.mjs": HOOK }, manifest: { dataVersion: 3 } });
  const { instance, afterCommit } = await addInstance(manifest, { nickname: "News", locales: ["en", "fr"] });
  assert.equal(instance.key, "news");
  assert.equal(instance.nickname, "News");
  const names = await prisma.instanceTranslation.findMany({ where: { instanceId: instance.id }, orderBy: { locale: "asc" } });
  assert.deepEqual(names.map((n) => [n.locale, n.name]), [["en", "News"], ["fr", "News"]]);
  assert.deepEqual(await setting(K.seenFeaturesKey(instance.id)), []);
  assert.equal(await setting(K.dataVersionKey(instance.id)), 3);
  assert.equal(await hooks(), 0, "the hook has not run yet");
  await afterCommit();
  assert.equal(await hooks(), 1);
});

test("addInstance: a version-1 module gets no __dataVersion; an explicit key and names are used as given", async () => {
  const manifest = await installed("lifecycle-b");
  const { instance } = await addInstance(manifest, { key: "chosen-key", names: { en: "Chosen" } });
  assert.equal(instance.key, "chosen-key");
  assert.equal(await setting(K.dataVersionKey(instance.id)), undefined);
  assert.equal(await setting(K.seenFeaturesKey(instance.id)) !== undefined, true);
});

test("addInstance in a transaction: a rollback leaves nothing, and the hook is the caller's to run after the commit", async () => {
  const manifest = await installed("lifecycle-c", { files: { "index.mjs": HOOK } });
  await assert.rejects(addInstance(manifest, { tx: prisma }), /pass `names` or `locales`/);
  const hooksToRun = [];
  await assert.rejects(prisma.$transaction(async (tx) => {
    const { afterCommit } = await addInstance(manifest, { tx, locales: ["en"] });
    hooksToRun.push(afterCommit);
    throw new Error("abort");
  }), /abort/);
  assert.equal(await prisma.moduleInstance.count({ where: { moduleId: "lifecycle-c" } }), 0);
  assert.equal(await prisma.setting.count({ where: { key: { startsWith: "instance." } } }), 0);
  assert.equal(await hooks(), 0);
  const kept = await prisma.$transaction((tx) => addInstance(manifest, { tx, locales: ["en"] }));
  assert.equal(await hooks(), 0, "nothing runs inside the transaction");
  await kept.afterCommit();
  assert.equal(await hooks(), 1);
});

test("eraseInstanceRows: erases the settings, the stored records and the row of each instance, and nothing of the others", async () => {
  const manifest = await installed("lifecycle-d", { manifest: { dataVersion: 2 } });
  const a = (await addInstance(manifest, { key: "inst-a", locales: ["en"] })).instance;
  const b = (await addInstance(manifest, { key: "inst-b", locales: ["en"] })).instance;
  const c = (await addInstance(manifest, { key: "inst-c", locales: ["en"] })).instance;
  for (const i of [a, b, c]) {
    await prisma.setting.create({ data: { key: K.instanceSettingKey(i.id, "title"), locale: "en", value: '"x"' } });
    await prisma.moduleRecord.create({ data: { instanceId: i.id, collection: "things", data: "{}" } });
  }
  await eraseInstanceRows([a.id, b.id, "no-such-instance"]);
  for (const i of [a, b]) {
    assert.equal(await prisma.moduleInstance.count({ where: { id: i.id } }), 0);
    assert.equal(await prisma.moduleRecord.count({ where: { instanceId: i.id } }), 0);
    assert.equal(await prisma.setting.count({ where: K.instanceSettingsWhere(i.id) }), 0);
    assert.equal(await prisma.instanceTranslation.count({ where: { instanceId: i.id } }), 0);
  }
  assert.equal(await prisma.moduleInstance.count({ where: { id: c.id } }), 1);
  assert.equal(await prisma.moduleRecord.count({ where: { instanceId: c.id } }), 1);
  assert.ok((await prisma.setting.count({ where: K.instanceSettingsWhere(c.id) })) >= 3, "title, __seenFeatures, __dataVersion");
  await eraseInstanceRows([]);   // nothing to do, no error
});

test("instanceRowErasures can be batched in one transaction", async () => {
  const manifest = await installed("lifecycle-e");
  const a = (await addInstance(manifest, { locales: ["en"] })).instance;
  await prisma.moduleRecord.create({ data: { instanceId: a.id, collection: "things", data: "{}" } });
  await prisma.$transaction([...instanceRowErasures(prisma, [a.id])]);
  assert.equal(await prisma.moduleInstance.count(), 0);
  assert.equal(await prisma.moduleRecord.count(), 0);
  assert.equal(await prisma.setting.count({ where: K.instanceSettingsWhere(a.id) }), 0);
});

test("purgeModule: an instance created between the read and the erasure is erased too, with its settings", async () => {
  const manifest = await installed("lifecycle-f");
  await addInstance(manifest, { key: "purge-a", locales: ["en"] });
  const original = prisma.moduleInstance.findMany;
  let late = null, calls = 0;
  prisma.moduleInstance.findMany = async (...args) => {
    const rows = await original.apply(prisma.moduleInstance, args);
    if (calls++ === 0) late = (await addInstance(manifest, { key: "purge-late", locales: ["en"] })).instance;   // arrives after the read
    return rows;
  };
  try { await I.purgeModule("lifecycle-f"); } finally { prisma.moduleInstance.findMany = original; }
  assert.ok(late);
  assert.equal(await prisma.moduleInstance.count({ where: { moduleId: "lifecycle-f" } }), 0);
  assert.equal(await prisma.setting.count({ where: K.instanceSettingsWhere(late.id) }), 0, "no orphaned settings");
  assert.equal(await prisma.module.findUnique({ where: { id: "lifecycle-f" } }), null);
});

test("retireInstance: an instance erased meanwhile rolls the snapshot back (no retired copy of erased data)", async () => {
  const { retireInstance } = await import("@/core/modules/retired");
  const manifest = await installed("lifecycle-g");
  const a = (await addInstance(manifest, { key: "retire-a", locales: ["en"] })).instance;
  const original = prisma.moduleRecord.findMany;
  prisma.moduleRecord.findMany = async (...args) => {
    const rows = await original.apply(prisma.moduleRecord, args);
    await eraseInstanceRows([a.id]);   // a concurrent deleteInstance(keepData: false) finishes after the snapshot was read
    return rows;
  };
  try { await assert.rejects(retireInstance(a.id, "delete")); } finally { prisma.moduleRecord.findMany = original; }
  assert.equal(await prisma.retiredInstance.count({ where: { id: a.id } }), 0);
});
