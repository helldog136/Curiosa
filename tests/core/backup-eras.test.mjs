// Backups written by the REAL code of published releases, one per era (0.1.x, 0.2.x, 0.6.x, 0.31, 0.38), restored by this core (0.39.0). Demo data only.
// The files are made by tests/fixtures/backup-eras/generate.mjs (a throwaway copy of each tag runs its own backup export on demo data; password and 1000 iterations in seed.mjs).
// Each era: the file opens, the plan says what will happen, the restore goes through and reports, and what the release's data held is there afterwards.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
const Rs = await import("@/core/backup/restore");
const { getSetting } = await import("@/core/settings");
const { UPLOADS_DIR } = await import("@/core/config");

const PW = "un-mot-de-passe-solide";
const dir = path.resolve(import.meta.dirname, "../fixtures/backup-eras");
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
beforeEach(async () => { await db.reset(); await db.prisma.retiredInstance.deleteMany(); fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); });
after(() => { cat.close(); return db.close(); });

const open = (tag) => { const o = Rs.openBackup(fs.readFileSync(path.join(dir, `${tag}.chiffre.bin`)), PW, 1000); assert.ok(o.ok, `${tag}: ${JSON.stringify(o)}`); assert.equal(o.backup.manifest.frameworkVersion, tag.slice(1)); return o.backup; };

/** What every era must give back, whatever its age. */
async function assertSite() {
  assert.deepEqual((await db.prisma.user.findMany()).map((u) => [u.email, u.role]), [["owner@example.org", "owner"]]);
  assert.equal((await getSetting("site.name", "fr")), "Site de démonstration");
  assert.deepEqual([await db.prisma.entry.count(), await db.prisma.entryTranslation.count(), await db.prisma.redirect.count(), await db.prisma.moduleRecord.count({ where: { id: "r-1" } })], [1, 2, 1, 1]);
  assert.ok(fs.existsSync(path.join(UPLOADS_DIR, "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png")));
}
const ids = (items) => items.map((i) => i.id).sort();

test("0.1.19: the switched-off instance is set aside (never switched on), the old menu and the RAWG hand-over are prepared", async () => {
  const backup = open("v0.1.19");
  const preview = await Rs.previewRestore(backup);
  assert.equal(preview.conversion.gap, "older");
  assert.deepEqual(ids(preview.conversion.core), ["core.menu", "core.switched-off"]);
  assert.deepEqual(preview.conversion.rawg, { key: true, fixes: 1, todo: 0 });
  const report = await quiet(() => Rs.applyRestore(backup, { confirmCustom: [], actor: "o" }));
  assert.equal(report.ok, true, JSON.stringify(report.report));
  await assertSite();
  assert.deepEqual((await db.prisma.retiredInstance.findMany()).map((r) => [r.id, r.reason]), [["i-old", "legacy"]]);
  assert.ok(!(await db.prisma.moduleInstance.findUnique({ where: { id: "i-old" } })));
  assert.deepEqual((await getSetting("nav.menu")).items.map((n) => n.ref ?? n.href), ["i-blog", "i-links", "https://example.org/aide"]);
  // No catalogue here: the hand-over cannot reach "Game covers", and the report says so with the exact file.
  const rawg = report.report.failed.find((i) => i.id === "core.rawg");
  assert.deepEqual([rawg?.note, rawg?.path], ["rawgInstall", "data/settings.json (rawg.key, rawg.fixes)"]);
  assert.equal(await getSetting("rawg.key"), "code-demo-0001", "the old settings stay where they were");
});

test("0.1.28 and 0.2.14: menu rebuilt, RAWG prepared, nothing switched off", async () => {
  for (const tag of ["v0.1.28", "v0.2.14"]) {
    await db.reset(); await db.prisma.retiredInstance.deleteMany();
    const backup = open(tag);
    const report = await quiet(() => Rs.applyRestore(backup, { confirmCustom: [], actor: "o" }));
    assert.equal(report.ok, true, `${tag} ${JSON.stringify(report.report)}`);
    await assertSite();
    assert.equal(await db.prisma.retiredInstance.count(), 0, tag);
    assert.ok(report.report.converted.some((i) => i.id === "core.menu"), tag);
    assert.ok(report.report.failed.some((i) => i.id === "core.rawg"), tag);
  }
});

test("0.2.14 with the Game covers module in the catalogue: the RAWG code and the fix are handed over, once, and reported as converted", async () => {
  const PROVIDER = `export default { services: { "game.cover": {
    status: async () => ({ ready: true }),
    adopt: async (ctx, a) => { await ctx.api.store.add("adopted", { fixes: Object.keys(a.fixes ?? {}) }); if (a.key) await ctx.api.store.add("held", { key: a.key }); return { ok: true, keyHeld: !!a.key, fixes: Object.keys(a.fixes ?? {}).length, todo: (a.todo ?? []).length }; },
  } } };`;
  await cat.add("game-covers", { manifest: { offers: [{ service: "game.cover", version: 1 }], permissions: ["storage"] }, files: { "index.mjs": PROVIDER }, entry: { offers: [{ service: "game.cover", version: 1 }] } });
  const report = await quiet(() => Rs.applyRestore(open("v0.2.14"), { confirmCustom: [], actor: "o" }));
  assert.equal(report.ok, true, JSON.stringify(report.report));
  const done = report.report.converted.find((i) => i.id === "core.rawg");
  assert.deepEqual([done?.note, done?.params.fixes], ["rawg", 1], JSON.stringify(report.report));
  assert.ok(!report.report.failed.some((i) => i.id === "core.rawg"));
  const held = (await db.prisma.moduleRecord.findMany({ where: { collection: "held" } })).map((r) => JSON.parse(r.data));
  assert.deepEqual(held, [{ key: "code-demo-0001" }]);
  assert.equal((await getSetting("rawg.handover")).key, true, "the marker holds no value");
});

test("0.6.17, 0.31.1 and 0.38.0: restored as they are, no conversion invented", async () => {
  for (const tag of ["v0.6.17", "v0.31.1", "v0.38.0"]) {
    await db.reset(); await db.prisma.retiredInstance.deleteMany();
    const backup = open(tag);
    const preview = await Rs.previewRestore(backup);
    assert.equal(preview.conversion.gap, "older", tag);
    const report = await quiet(() => Rs.applyRestore(backup, { confirmCustom: [], actor: "o" }));
    assert.equal(report.ok, true, `${tag} ${JSON.stringify(report.report)}`);
    await assertSite();
    assert.equal(await db.prisma.retiredInstance.count(), 0, tag);
    assert.deepEqual(report.report.setAside.filter((i) => i.id.startsWith("core.")), [], tag);
    if (tag !== "v0.6.17") assert.deepEqual(ids(preview.conversion.core), [], `${tag}: a stored menu already exists`);
  }
});
