// Content features newly declared by a module update reach its existing instances (core 0.45.1, src/core/modules/instanceFeatures.ts).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { forgetModule } = await import("@/core/modules/registry");
const { migrateModuleInstances } = await import("@/core/modules/dataMigrations");
const { adoptModuleFeatures, adoptAllInstanceFeatures, seenFeaturesKey } = await import("@/core/modules/instanceFeatures");
const { contentToolProvider } = await import("@/core/content/mcp");
const { accessRevision } = await import("@/core/services/mcp/listSeen");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
const base = FIXTURE_MODULES.find((b) => b.manifest.id === "pages").manifest;

beforeEach(async () => { await db.reset(); });
after(() => { db.close(); });

const ACTOR = { name: "assistant", tokenId: "t1" };
const featuresOf = async (id) => JSON.parse((await db.prisma.moduleInstance.findUnique({ where: { id } })).features).sort();
const seenOf = async (id) => { const r = await db.prisma.setting.findFirst({ where: { key: seenFeaturesKey(id) } }); return r ? JSON.parse(r.value) : null; };

/** The installed module declares `features` from now on (a new version), as a module update does. */
async function declare(features, version) {
  const file = path.join(db.dir, "modules", "pages", "module.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  m.version = version;
  m.content.features = features;
  fs.writeFileSync(file, JSON.stringify(m));
  await db.prisma.module.update({ where: { id: "pages" }, data: { version } });
  forgetModule("pages");
}
async function site(manifestFeatures = ["cover", "summary", "body"]) {
  await db.fixture("pages");
  const manifest = { ...base, content: { ...base.content, features: manifestFeatures } };
  return createInstance(db.prisma, { manifest, names: { en: "Pages", fr: "Pages" }, nickname: "Pages" });
}

test("an update adds a newly declared feature to existing instances", async () => {
  const a = await site();
  const b = await createInstance(db.prisma, { manifest: { ...base, content: { ...base.content, features: ["cover", "summary", "body"] } }, names: { en: "More", fr: "Plus" }, nickname: "More", basePath: "more" });
  await declare(["cover", "summary", "body", "skin"], "9.0.1");
  await migrateModuleInstances("pages");
  assert.deepEqual(await featuresOf(a.id), ["body", "cover", "skin", "summary"]);
  assert.deepEqual(await featuresOf(b.id), ["body", "cover", "skin", "summary"]);
});

test("a feature the owner removed stays removed unless newly declared", async () => {
  const a = await site();
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { features: JSON.stringify(["cover", "body"]) } });   // owner unticked "summary"
  await declare(["cover", "summary", "body", "skin"], "9.0.1");
  await migrateModuleInstances("pages");
  assert.deepEqual(await featuresOf(a.id), ["body", "cover", "skin"], "summary stays removed, skin added");
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { features: JSON.stringify(["cover", "body"]) } });   // owner unticks skin too
  await declare(["cover", "summary", "body", "skin", "tags"], "9.0.2");
  await migrateModuleInstances("pages");
  assert.deepEqual(await featuresOf(a.id), ["body", "cover", "tags"], "only tags is new");
});

test("catch-up: an instance with no seen list gets only skin", async () => {
  const a = await site();
  await db.prisma.setting.deleteMany({ where: { key: seenFeaturesKey(a.id) } });
  (await import("@/core/settings")).resetSettingsCache();
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { features: JSON.stringify(["cover", "body"]) } });   // summary unticked long ago
  await declare(["cover", "summary", "body", "skin"], "9.0.1");
  assert.equal(await adoptAllInstanceFeatures(), 1);
  assert.deepEqual(await featuresOf(a.id), ["body", "cover", "skin"]);
  assert.deepEqual((await seenOf(a.id)).sort(), ["body", "cover", "skin", "summary"]);
});

test("running the adoption twice changes nothing", async () => {
  const a = await site();
  await declare(["cover", "summary", "body", "skin"], "9.0.1");
  assert.equal(await adoptModuleFeatures("pages"), 1);
  const after1 = [await featuresOf(a.id), await seenOf(a.id)];
  assert.equal(await adoptModuleFeatures("pages"), 0);
  assert.deepEqual([await featuresOf(a.id), await seenOf(a.id)], after1);
});

test("a new instance copies all the features of the manifest and has seen them", async () => {
  await db.fixture("pages");
  const manifest = { ...base, content: { ...base.content, features: ["cover", "summary", "body", "skin"] } };
  const i = await createInstance(db.prisma, { manifest, names: { en: "Pages", fr: "Pages" }, nickname: "Pages" });
  assert.deepEqual(await featuresOf(i.id), ["body", "cover", "skin", "summary"]);
  assert.deepEqual((await seenOf(i.id)).sort(), ["body", "cover", "skin", "summary"]);
});

test("the assistant create_draft accepts skin after the update path, and the reconnect revision moves", async () => {
  const a = await site();
  const token = { scope: "all", grants: {} };
  const rows = async () => db.prisma.moduleInstance.findMany({ select: { key: true, moduleId: true, features: true } });
  const before = accessRevision(token, await rows());
  const toolOf = async () => (await contentToolProvider.list()).find((t) => t.name === `${a.key}__create_draft`);
  assert.ok(!(await toolOf()).input.properties.skin);
  await declare(["cover", "summary", "body", "skin"], "9.0.1");
  await migrateModuleInstances("pages");
  const create = await toolOf();
  assert.ok(create.input.properties.skin);
  const made = await create.call({ title: "Look", skin: "none" }, ACTOR);
  assert.equal(made.status, "draft");
  assert.notEqual(accessRevision(token, await rows()), before);
});
