import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Core 0.16.0: "installed" means "a first copy exists". Every install path creates the first instance (default key, default settings, creation hook), except the callers that
// have their own way (cascade, seed, first-start wizard, backup restore, a social network with a nickname). Modules already installed without a copy are picked up ONCE by a
// migration that only touches a safe class (docs/MODULES.md, "First instance").
const db = await useTestDb();
const { prisma } = db;
const cat = createCatalogue();
after(() => { cat.close(); return db.close(); });
const I = await import("@/core/modules/installer");
const D = await import("@/core/modules/defaultInstance");
const F = await import("@/core/modules/firstInstances");
const { removeInstance } = await import("@/core/instanceService");

const NAME = { fr: "Module", en: "Module" };
const base = (over = {}) => ({ manifest: { name: NAME, description: { fr: "d", en: "d" }, instances: "multiple", settings: [], permissions: [], ...(over.manifest ?? {}) }, files: over.files ?? {} });
const overlayManifest = { type: "overlay", minCore: "0.5.0", permissions: ["overlay"], overlayElements: [{ id: "box", label: "Box", fit: "scale", size: { width: 200, height: 100 } }] };
const count = (moduleId) => prisma.moduleInstance.count({ where: { moduleId } });
const audits = (action) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

beforeEach(async () => { await db.reset(); await cat.clear?.(); });

test("install from the catalogue: the module gets its first instance, key = module id, default names, reported in the result", async () => {
  await cat.add("plain", base());
  const r = await I.installFromCatalogue("plain");
  assert.equal(r.ok, true);
  assert.equal(await count("plain"), 1);
  const row = await prisma.moduleInstance.findFirst({ where: { moduleId: "plain" }, include: { translations: true } });
  assert.equal(row.key, "plain");
  assert.deepEqual(r.instance, { id: row.id, key: "plain" });
  assert.ok(row.translations.length >= 1);
  assert.equal(r.instanceFailed, undefined);
});

test("install of a personal repository (installModule): same rule", async () => {
  const repo = makeRepo({ "module.json": { apiVersion: 2, id: "perso", name: "Perso", version: "1.0.0", main: "index.mjs" }, "index.mjs": "export default {};" });
  const r = await I.installModule(repo.url);
  assert.equal(r.ok, true);
  assert.equal(await count("perso"), 1);
});

test("the creation hook runs for the first instance", async () => {
  await cat.add("hooked", base({ files: { "index.mjs": "export default { hooks: { async onInstanceCreate(ctx) { await ctx.api.store.add('seen', { ok: 1 }); } } };" } }));
  assert.equal((await I.installFromCatalogue("hooked")).ok, true);
  assert.equal(await prisma.moduleRecord.count({ where: { collection: "seen" } }), 1);
});

test("instanceKey chooses the key; a taken or invalid key does not fail the install: no copy, instanceFailed, and the one-click set-up still works", async () => {
  await cat.add("keyed", base());
  const r = await I.installFromCatalogue("keyed", { instanceKey: "blog-news" });
  assert.equal(r.instance.key, "blog-news");
  await cat.add("clash", base());
  await prisma.moduleInstance.create({ data: { moduleId: "keyed", key: "taken-key", basePath: null, translations: { create: [] } } });
  const bad = await I.installFromCatalogue("clash", { instanceKey: "taken-key" });
  assert.equal(bad.ok, true, "the module is installed");
  assert.equal(bad.instanceFailed, true);
  assert.equal(await count("clash"), 0);
  const later = await D.ensureDefaultInstance("clash");
  assert.equal(later.kind, "created");
  assert.equal(await count("clash"), 1);
});

test("opt-outs: firstInstance:false, restoreKept:false and dependencies cascade callers get no copy from installModule", async () => {
  await cat.add("aa", base()); await cat.add("bb", base());
  assert.equal((await I.installFromCatalogue("aa", { firstInstance: false })).ok, true);
  assert.equal((await I.installFromCatalogue("bb", { restoreKept: false })).ok, true);
  assert.equal(await count("aa"), 0);
  assert.equal(await count("bb"), 0);
});

test("reinstall after 'keep my data': the kept instance comes back, no second one is created", async () => {
  await cat.add("keep", base());
  assert.equal((await I.installFromCatalogue("keep")).ok, true);
  const before = await prisma.moduleInstance.findFirst({ where: { moduleId: "keep" } });
  assert.equal((await I.uninstallModule("keep", { keepData: true })).ok, true);
  const r = await I.installFromCatalogue("keep");
  assert.equal(r.ok, true);
  assert.deepEqual(r.restored, [before.key]);
  assert.equal(r.instance, undefined);
  assert.equal(await count("keep"), 1);
  assert.equal((await prisma.moduleInstance.findFirst({ where: { moduleId: "keep" } })).id, before.id);
});

test("cascade: the consumer and the provider it brings each get exactly one instance; a failing consumer leaves nothing", async () => {
  await cat.add("fourn", { ...base({ manifest: { offers: [{ service: "demo.svc" }] } }), entry: { offers: [{ service: "demo.svc" }] } });
  await cat.add("conso", { ...base({ manifest: { requires: [{ service: "demo.svc" }] } }), entry: { requires: [{ service: "demo.svc" }] } });
  const r = await I.installFromCatalogue("conso");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await count("fourn"), 1);
  assert.equal(await count("conso"), 1);
  assert.deepEqual(r.provided, ["fourn"]);
  await db.reset();
  await cat.add("conso2", base({ manifest: { requires: [{ service: "demo.none" }] } }));
  assert.equal((await I.installFromCatalogue("conso2")).ok, false);
  assert.equal(await prisma.moduleInstance.count(), 0);
  assert.equal(await prisma.module.count(), 0);
});

test("update and reinstall keep the instances and never add one", async () => {
  await cat.add("upd", base());
  await I.installFromCatalogue("upd");
  await removeInstance((await prisma.moduleInstance.findFirst({ where: { moduleId: "upd" } })).id, { keepData: false });
  await cat.add("upd", { ...base(), manifest: { ...base().manifest, version: "1.1.0" } });
  const r = await I.updateModule("upd");
  assert.equal(r.ok, true);
  assert.equal(await count("upd"), 0, "an update never creates a copy the owner removed");
});

// ── The one-time pass for modules already installed without a copy ──────────────────────────────────────────────────────────────

const noCopy = async (id, over) => { await cat.add(id, over); assert.equal((await I.installFromCatalogue(id, { firstInstance: false, dependencies: false })).ok, true); };

test("migration: creates the first instance of overlay modules and of modules whose service another one consumes; one audit line each; second run does nothing", async () => {
  await noCopy("over", { ...base({ manifest: overlayManifest }), files: { "index.mjs": "export default { overlayElements: { box: () => null } };" } });
  await noCopy("svc", base({ manifest: { offers: [{ service: "demo.svc" }] } }));
  await noCopy("user", base({ manifest: { requires: [{ service: "demo.svc", optional: true }] } }));
  await D.ensureDefaultInstance("user");
  const r = await F.runFirstInstances();
  assert.deepEqual(r.created.sort(), ["over", "svc"]);
  assert.equal(await count("over"), 1);
  assert.equal(await count("svc"), 1);
  const lines = await audits("instance.create");
  assert.deepEqual(lines.map((l) => l.module).sort(), ["over", "svc"]);
  assert.ok(lines.every((l) => l.actor === "system"));
  assert.equal((await F.runFirstInstances()).already, true);
  assert.equal((await audits("instance.create")).length, 2);
});

test("migration: never touches a module with a public page, a creation hook, a scheduled task, kept data, a removal in the log, or an unmet requirement", async () => {
  await noCopy("pagey", base({ manifest: { page: true, offers: [{ service: "demo.a" }] } }));
  await noCopy("hooky", { ...base({ manifest: { ...overlayManifest } }), files: { "index.mjs": "export default { overlayElements: { box: () => null }, hooks: { onInstanceCreate() {} } };" } });
  await noCopy("tasky", { ...base({ manifest: { ...overlayManifest } }), files: { "index.mjs": "export default { overlayElements: { box: () => null }, tasks: { t: { everyMinutes: 5, run() {} } } };" } });
  await noCopy("kepty", { ...base({ manifest: { ...overlayManifest } }), files: { "index.mjs": "export default { overlayElements: { box: () => null } };" } });
  await noCopy("gone", { ...base({ manifest: { ...overlayManifest } }), files: { "index.mjs": "export default { overlayElements: { box: () => null } };" } });
  await noCopy("needy", { ...base({ manifest: { ...overlayManifest, requires: [{ service: "demo.absent" }] } }), files: { "index.mjs": "export default { overlayElements: { box: () => null } };" } });
  await noCopy("plain", base());
  await noCopy("consumer", base({ manifest: { requires: [{ service: "demo.a", optional: true }] } }));
  // kept data: an instance that was retired with its data
  await D.ensureDefaultInstance("kepty");
  await removeInstance((await prisma.moduleInstance.findFirst({ where: { moduleId: "kepty" } })).id, { keepData: true });
  // an instance the owner removed (logged)
  await D.ensureDefaultInstance("gone");
  await removeInstance((await prisma.moduleInstance.findFirst({ where: { moduleId: "gone" } })).id, { keepData: false });
  await prisma.auditLog.create({ data: { actor: "owner@example.org", action: "instance.delete", target: "gone" } });
  const r = await F.runFirstInstances();
  assert.deepEqual(r.created, []);
  const why = Object.fromEntries(r.skipped.map((s) => [s.module, s.why]));
  assert.equal(why.pagey, "public page");
  assert.equal(why.hooky, "creation hook");
  assert.equal(why.tasky, "scheduled task");
  assert.equal(why.kepty, "data kept");
  assert.equal(why.gone, "instance removed by the owner");
  assert.equal(why.needy, "missing requirement");
  assert.equal(why.plain, "nothing shown or consumed");
  assert.equal(await prisma.moduleInstance.count({ where: { moduleId: { in: ["pagey", "hooky", "tasky", "kepty", "gone", "needy", "plain"] } } }), 0);
});

test("migration: an instance the owner removes AFTER the pass does not come back at the next start", async () => {
  await noCopy("over", { ...base({ manifest: overlayManifest }), files: { "index.mjs": "export default { overlayElements: { box: () => null } };" } });
  assert.deepEqual((await F.runFirstInstances()).created, ["over"]);
  await removeInstance((await prisma.moduleInstance.findFirst({ where: { moduleId: "over" } })).id, { keepData: false });
  assert.equal((await F.runFirstInstances()).already, true);
  assert.equal(await count("over"), 0);
});

test("migration: a fresh site (no module) still records the pass, and a module installed afterwards gets its copy from the install itself", async () => {
  assert.deepEqual((await F.runFirstInstances()).created, []);
  await cat.add("late", base());
  assert.equal((await I.installFromCatalogue("late")).ok, true);
  assert.equal(await count("late"), 1);
  assert.equal((await F.runFirstInstances()).already, true);
});
