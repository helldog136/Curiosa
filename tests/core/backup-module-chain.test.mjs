// The chain of a module in a restored old backup (core 0.39.0): data below the `dataFloor` of the version the catalogue offers goes through the older releases that still
// convert it (the "bridge"), each with its own code, then the catalogue version. Best effort: a step that cannot be done is reported, the rest of the restore goes on.
// The repository is a real local git repository with repository-wide tags (v1.0.0, v1.1.0, ...), as the modules repository has.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
const { installFromCatalogue, purgeModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const D = await import("@/core/modules/dataMigrations");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { createInstance } = await import("@/core/instanceService");
const { UPLOADS_DIR } = await import("@/core/config");

const PW = "un-mot-de-passe-solide";
const FAST = 1000;
beforeEach(async () => { for (const t of ["v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0"]) { try { cat.repo.g("tag", "-d", t); } catch { /* not there */ } } await purgeModule("carnet").catch(() => {}); await db.reset(); await db.prisma.retiredInstance.deleteMany(); fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); });
after(() => { cat.close(); return db.close(); });

// v1: { name } -> v2: { author } -> v3: { author, tags: [] }
const MIGRATIONS = {
  2: "async (ctx) => { for (const r of await ctx.api.store.list('notes')) { const { name, ...rest } = r.data; await ctx.api.store.update(r.id, { ...rest, author: name }); } }",
  3: "async (ctx) => { for (const r of await ctx.api.store.list('notes')) await ctx.api.store.update(r.id, { ...r.data, tags: [] }); }",
};
const code = (steps) => `export default { migrations: { ${steps.map((n) => `${n}: ${MIGRATIONS[n] ?? "async () => {}"}`).join(", ")} } };`;
/** Publishes one release of the module and tags the whole repository `v<version>` (the repository-wide tags the chain walks). */
async function release(version, { dataVersion, dataFloor, steps = [], pin = false }) {
  await cat.add("carnet", { manifest: { version, ...(dataVersion > 1 ? { dataVersion } : {}), ...(dataFloor > 1 ? { dataFloor } : {}) }, files: { "index.mjs": code(steps) }, entry: pin ? {} : {} });
  cat.repo.g("tag", `v${version}`);
}
const notes = async (instId) => (await db.prisma.moduleRecord.findMany({ where: { instanceId: instId, collection: "notes" } })).map((r) => JSON.parse(r.data));

async function backupOfV1() {
  await release("1.0.0", { dataVersion: 1 });
  assert.equal((await installFromCatalogue("carnet", { firstInstance: false })).ok, true);
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "Carnet", names: { fr: "Carnet" } });
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "notes", data: JSON.stringify({ name: "Alice", text: "un" }) } });
  const b = await B.createBackup(PW, { iterations: FAST });
  const opened = Rs.openBackup(b.buffer, PW, FAST);
  assert.ok(opened.ok);
  await purgeModule("carnet");
  await db.reset();
  return { backup: opened.backup, instId: inst.id };
}

test("data below the floor: the plan names the bridge releases; the restore installs the first, converts with each release's own code, then lands on the catalogue version", async () => {
  const { backup, instId } = await backupOfV1();
  await release("1.1.0", { dataVersion: 2, steps: [2] });
  await release("1.2.0", { dataVersion: 3, dataFloor: 2, steps: [2, 3] });
  await release("2.0.0", { dataVersion: 3, dataFloor: 3, steps: [3] });   // the conversions 1 -> 3 were deleted here: the floor is 3

  const preview = await Rs.previewRestore(backup);
  const step = preview.conversion.modules.find((m) => m.id === "carnet");
  assert.deepEqual([step.route, step.tags, step.dataVersion, step.floor], ["bridge", ["v1.1.0", "v1.2.0"], 1, 3]);
  assert.match(step.path, /readable\/modules\//);

  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report.report));
  assert.deepEqual(await notes(instId), [{ text: "un", author: "Alice", tags: [] }]);
  assert.equal(await D.dataVersionOf(instId), 3);
  assert.equal(await D.dataStatusOf(instId), null, "not set aside");
  const row = await db.prisma.module.findUnique({ where: { id: "carnet" } });
  assert.deepEqual([row.version, row.ref], ["2.0.0", "carnet-v2.0.0"], "the module ends on the catalogue version");
  assert.deepEqual(report.report.failed, []);
  assert.ok(report.report.converted.some((i) => i.note === "moduleChain" && i.params.steps === 2));
});

test("no release converts the data: the module is installed at the catalogue version, the data is set aside, the report names the folder to read by hand", async () => {
  const { backup, instId } = await backupOfV1();
  await release("2.0.0", { dataVersion: 3, dataFloor: 3, steps: [3] });   // the only newer release: nothing in between converts version 1
  const preview = await Rs.previewRestore(backup);
  assert.equal(preview.conversion.modules.find((m) => m.id === "carnet")?.route, "blocked");
  const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
  const report = await quiet(() => Rs.applyRestore(backup, { confirmCustom: [], actor: "o" }));
  assert.equal(report.ok, true, "best effort: the restore itself goes through");
  assert.deepEqual(await notes(instId), [{ name: "Alice", text: "un" }], "the data is untouched");
  const items = report.report.setAside.filter((i) => i.params?.module === "carnet");
  assert.ok(items.some((i) => i.note === "moduleNoRelease"), JSON.stringify(report.report));
  assert.ok(items.some((i) => i.note === "moduleFloor" && /readable\/modules\//.test(i.path)), JSON.stringify(items));
  assert.equal((await D.dataStatusOf(instId))?.status, "failed");
});

test("a step that fails stops the chain there and is reported, with the data left as the last good step left it", async () => {
  const { backup, instId } = await backupOfV1();
  await release("1.1.0", { dataVersion: 2, steps: [2] });
  await release("1.2.0", { dataVersion: 3, dataFloor: 2, steps: [2, 3] });
  // The catalogue version converts nothing and its code throws while loading its migration 3: the last step fails.
  await cat.add("carnet", { manifest: { version: "2.0.0", dataVersion: 4, dataFloor: 3 }, files: { "index.mjs": `export default { migrations: { 4: async () => { throw new Error("boom"); } } };` } });
  cat.repo.g("tag", "v2.0.0");
  const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
  const report = await quiet(() => Rs.applyRestore(backup, { confirmCustom: [], actor: "o" }));
  assert.equal(report.ok, true);
  const bad = report.report.failed.find((i) => i.params?.module === "carnet");
  assert.ok(bad && /boom|moduleStep|moduleMigration/.test(`${bad.note}${bad.params.error}`), JSON.stringify(report.report.failed));
  assert.ok(bad.path.startsWith("readable/modules/"));
  assert.deepEqual(await notes(instId), [{ text: "un", author: "Alice", tags: [] }], "the data stays converted up to the last good release");
});
