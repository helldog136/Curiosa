import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const F = await import("@/core/backup/files");
const S = await import("@/core/services/store");
const { createTarGz, readTarGz } = await import("@/core/backup/tar");
const { encryptBackup } = await import("@/core/backup/crypto");
const { sha256 } = await import("@/core/backup/format");
const { installModule, updateModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const D = await import("@/core/modules/dataMigrations");
const { createInstance } = await import("@/core/instanceService");
const { updateModules } = await import("@/core/modules/updateStatus");

const PW = "un-mot-de-passe-solide";
const FAST = 1000;
const backups = () => path.join(process.env.DATA_DIR, "backups");
const names = () => (fs.existsSync(backups()) ? fs.readdirSync(backups()) : []);
beforeEach(async () => { await db.reset(); fs.rmSync(backups(), { recursive: true, force: true }); });
after(() => db.close());

const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
async function owner() { await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } }); }
const make = () => B.createBackup(PW, { iterations: FAST });
const restore = (b) => Rs.applyRestore(Rs.openBackup(b.buffer, PW, FAST).backup, { confirmCustom: [], actor: "o" });
async function instanceRow(id = "inst-1") {
  return db.prisma.moduleInstance.create({ data: { id, moduleId: "carnet", key: `carnet-${id}`, basePath: null, nickname: id } });
}

test("sauvegarde : la colonne key est exportée, le fichier de données garde la mise en forme JSON habituelle, la copie lisible est inchangée", async () => {
  await owner(); await instanceRow();
  const s = S.createStore("inst-1");
  await s.addMany("notes", [{ data: { t: "a" }, key: "k:1" }, { data: { t: "b" } }]);
  const b = await make();
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content.toString("utf8")]));
  const arr = JSON.parse(files["data/module-records.json"]);
  assert.deepEqual(arr.map((r) => String(r.key)).sort(), ["k:1", "null"]);
  assert.equal(files["data/module-records.json"], JSON.stringify(arr, null, 2) + "\n", "même texte que JSON.stringify(…, null, 2)");
  const readable = JSON.parse(files["readable/modules/carnet-inst-1/records-notes.json"]);
  assert.deepEqual(readable.map((r) => r.t).sort(), ["a", "b"]);
  assert.equal(b.manifest.counts.records, 2);
  assert.equal(b.manifest.formatVersion, 1, "FORMAT_VERSION reste à 1");
});

test("sauvegarde : sans enregistrement, fichiers vides valides ; lecture par pages au-delà d'une page (2 500 lignes, mêmes createdAt)", async () => {
  await owner(); await instanceRow();
  let files = Object.fromEntries(readTarGz((await make()).plain).map((f) => [f.path, f.content.toString("utf8")]));
  assert.equal(files["data/module-records.json"], "[]\n");
  const s = S.createStore("inst-1");
  for (let i = 0; i < 2; i++) await s.addMany("big", Array.from({ length: 1250 }, (_, n) => ({ data: { n }, key: `k${n}` })));
  const b = await make();
  files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content.toString("utf8")]));
  const arr = JSON.parse(files["data/module-records.json"]);
  assert.equal(arr.length, 2500); assert.equal(new Set(arr.map((r) => r.id)).size, 2500);
  assert.equal(b.manifest.counts.records, 2500);
});

test("restauration : key restaurée ; une sauvegarde ANCIENNE (sans key) donne key = null", async () => {
  await owner(); await instanceRow();
  const s = S.createStore("inst-1");
  const withKey = await s.add("notes", { t: "a" }, { key: "twitch:abc" });
  const plain = await s.add("notes", { t: "b" });
  const b = await make();
  await db.prisma.moduleRecord.deleteMany();
  assert.equal((await restore(b)).ok, true);
  assert.equal((await s.get(withKey)).key, "twitch:abc");
  assert.equal((await s.getByKey("notes", "twitch:abc")).id, withKey, "l'index sert après restauration");
  assert.equal((await s.get(plain)).key, null);

  // sauvegarde d'avant la 0.2.0 : aucune ligne n'a de colonne key
  const files = readTarGz(b.plain).map((f) => ({ ...f }));
  const rec = files.find((f) => f.path === "data/module-records.json");
  rec.content = Buffer.from(JSON.stringify(JSON.parse(rec.content.toString()).map((r) => { const c = { ...r }; delete c.key; return c; }), null, 2) + "\n");
  const manifest = JSON.parse(files.find((f) => f.path === "backup.json").content.toString());
  manifest.files.find((f) => f.path === rec.path).sha256 = sha256(rec.content);
  files.find((f) => f.path === "backup.json").content = Buffer.from(JSON.stringify(manifest));
  const old = { buffer: encryptBackup(createTarGz(files), PW, FAST) };
  assert.equal((await restore(old)).ok, true);
  assert.equal((await s.get(withKey)).key, null);
  assert.equal(await s.count("notes"), 2);
});

test("restauration : refus propre d'une sauvegarde faite par un schéma plus récent (newer-schema), base inchangée", async () => {
  await owner(); await instanceRow();
  const s = S.createStore("inst-1"); await s.add("notes", { t: "a" });
  const parsed = Rs.openBackup((await make()).buffer, PW, FAST);
  parsed.backup.manifest.schemaVersion = "29990101000000_futur";
  const report = await Rs.applyRestore(parsed.backup, { confirmCustom: [], actor: "o" });
  assert.deepEqual([report.ok, report.error], [false, "newer-schema"]);
  assert.equal(await s.count("notes"), 1);
  assert.equal(await s.generation(), 0, "rien n'a changé : pas de génération");
  // et un format de fichier plus récent est refusé à l'ouverture
  const files = readTarGz((await make()).plain).map((f) => ({ ...f }));
  const bj = files.find((f) => f.path === "backup.json"); const m = JSON.parse(bj.content.toString()); m.formatVersion = 2; bj.content = Buffer.from(JSON.stringify(m));
  assert.equal(Rs.openBackup(encryptBackup(createTarGz(files), PW, FAST), PW, FAST).error, "newer-format");
});

test("génération : la restauration l'augmente pour chaque instance, sans jamais reculer", async () => {
  await owner(); await instanceRow("inst-1"); await instanceRow("inst-2");
  await S.bumpGenerations(["inst-1"]);                      // inst-1 : 1 au moment de la sauvegarde
  const b = await make();
  await S.bumpGenerations(["inst-1"]); await S.bumpGenerations(["inst-1"]);   // 3 après
  assert.equal((await restore(b)).ok, true);
  assert.equal(await S.createStore("inst-1").generation(), 4, "max(3 avant, 1 sauvegardé) + 1");
  assert.equal(await S.createStore("inst-2").generation(), 1);
  await S.createStore("inst-1").add("x", {});
  assert.equal(await S.createStore("inst-1").generation(), 4, "add ne l'augmente pas");
});

test("génération : l'annulation d'une migration l'augmente, une migration réussie non", async () => {
  const manifest = (v, dataVersion) => ({ apiVersion: 2, id: "carnet", name: "Carnet", version: v, main: "index.mjs", ...(dataVersion ? { dataVersion } : {}) });
  const repo = makeRepo({ "module.json": manifest("1.0.0"), "index.mjs": "export default {};" });
  repo.g("tag", "v1.0.0");
  const release = (v, dv, src) => { fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifest(v, dv))); fs.writeFileSync(path.join(repo.dir, "index.mjs"), src); repo.g("commit", "-qam", v); repo.g("tag", `v${v}`); };
  assert.equal((await installModule(`${repo.url}#v1.0.0`)).ok, true);
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "C", names: { fr: "C" } });
  const s = S.createStore(inst.id);
  await s.add("notes", { t: "a" });
  release("1.1.0", 2, "export default { migrations: { 2: async (ctx) => { await ctx.api.store.add('journal', { ok: 1 }); } } };");
  assert.equal((await quiet(() => updateModule("carnet"))).ok, true);
  assert.equal(await s.generation(), 0, "migration réussie : génération inchangée");
  release("1.2.0", 3, "export default { migrations: { 3: async (ctx) => { await ctx.api.store.add('journal', { half: 1 }); throw new Error('bug'); } } };");
  await quiet(() => updateModule("carnet"));
  assert.equal((await D.dataStatusOf(inst.id)).status, "failed");
  assert.equal(await s.generation(), 1, "annulation : génération + 1");
  assert.equal(await s.count("journal"), 1, "l'écriture à moitié faite a bien été annulée");
});

test("génération : la reprise de données gardées l'augmente", async () => {
  const manifest = { apiVersion: 2, id: "carnet", name: "Carnet", version: "1.0.0", main: "index.mjs" };
  const repo = makeRepo({ "module.json": manifest, "index.mjs": "export default {};" }); repo.g("tag", "v1.0.0");
  assert.equal((await installModule(`${repo.url}#v1.0.0`)).ok, true);
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "C", names: { fr: "C" } });
  const s = S.createStore(inst.id);
  const id = await s.add("notes", { t: "a" }, { key: "k" });
  await S.bumpGenerations([inst.id]);
  const { retireInstance, restoreInstance } = await import("@/core/modules/retired");
  assert.ok(await retireInstance(inst.id, "uninstall"));
  assert.equal(await db.prisma.moduleRecord.count(), 0);
  const out = await restoreInstance(inst.id);
  assert.equal(out.ok, true);
  assert.equal(await s.generation(), 2, "1 gardée + 1");
  assert.equal((await s.get(id)).key, "k", "key revient avec les données gardées");
});

/* ───────── copie de lot ───────── */

const sqliteOk = (file) => fs.readFileSync(file).subarray(0, 15).toString() === "SQLite format 3";

test("copie de lot : VACUUM INTO, nom pre-bulk-update-<date>-<ts>.db, base lisible", async () => {
  await owner(); await instanceRow(); await S.createStore("inst-1").addMany("c", Array.from({ length: 50 }, (_, i) => ({ data: { i } })));
  const now = Date.UTC(2026, 9, 20, 10, 0, 0);
  const r = await F.bulkUpdateCopy(undefined, now);
  assert.equal(r.ok, true); assert.equal(r.method, "vacuum");
  assert.equal(path.basename(r.path), `pre-bulk-update-2026-10-20-${now}.db`);
  assert.ok(sqliteOk(r.path));
  assert.ok(fs.statSync(r.path).size > 0);
});

test("copie de lot : UNE seule copie gardée, l'ancienne n'est retirée qu'après la nouvelle", async () => {
  await owner();
  const t = Date.now();
  await F.bulkUpdateCopy(undefined, t - 5000);
  await F.bulkUpdateCopy(undefined, t - 3000);
  const last = await F.bulkUpdateCopy(undefined, t);
  assert.deepEqual(names().filter((f) => f.startsWith("pre-bulk-update-")), [path.basename(last.path)]);
});

test("copie de lot : pas de place → refus, rien copié, l'ancienne copie reste ; l'espace de l'ancienne copie compte comme récupérable", async () => {
  await owner();
  const size = fs.statSync(new URL(process.env.DATABASE_URL.replace(/\?.*$/, "")).pathname).size;
  const first = await F.bulkUpdateCopy(undefined, Date.now() - 1000);
  const refused = await F.bulkUpdateCopy(undefined, Date.now(), { freeBytes: 10 });
  assert.deepEqual(refused, { ok: false, error: "no-space" });
  assert.deepEqual(names().filter((f) => f.startsWith("pre-bulk-update-")), [path.basename(first.path)]);
  assert.equal((await F.bulkUpdateCopy(undefined, Date.now(), { freeBytes: Math.ceil(size * 1.2) - fs.statSync(first.path).size + 10 })).ok, true, "l'ancienne copie (≈ size) sera remplacée");
});

test("copie de lot : hors rotation — six copies pre-migration n'y touchent pas ; la rotation de pre-migration (5) continue", async () => {
  await owner();
  const bulk = await F.bulkUpdateCopy(undefined, Date.now());
  for (let i = 0; i < 6; i++) F.safetyCopy("pre-migration", undefined, Date.now() + i + 1);
  assert.ok(fs.existsSync(bulk.path));
  assert.equal(names().filter((f) => f.startsWith("pre-migration-")).length, 5);
});

test("copie de lot : récente (< 1 h) → les copies pre-migration sont sautées ; plus ancienne → elles reprennent", async () => {
  await owner();
  assert.equal(F.hasRecentBulkCopy(), false);
  const now = Date.now();
  await F.bulkUpdateCopy(undefined, now - 30 * 60_000);
  assert.equal(F.hasRecentBulkCopy(undefined, now), true);
  assert.equal(F.hasRecentBulkCopy(undefined, now + 31 * 60_000), false, "plus d'une heure après");

});

test("updateModules : UNE copie de lot avant le premier module (pas une par module)", async () => {
  await owner();
  const s = await updateModules(["inconnu-1", "inconnu-2", "inconnu-3"]);
  assert.equal(s.updated.length, 0);
  assert.equal(names().filter((f) => f.startsWith("pre-bulk-update-")).length, 1);
  await updateModules([]);
  assert.equal(names().filter((f) => f.startsWith("pre-bulk-update-")).length, 1, "liste vide : aucune copie de plus");
});

test("migration après copie de lot récente : pas de copie pre-migration ; sans copie de lot : elle est prise", async () => {
  await owner();
  const manifest = (v, dv) => ({ apiVersion: 2, id: "carnet", name: "Carnet", version: v, main: "index.mjs", ...(dv ? { dataVersion: dv } : {}) });
  const repo = makeRepo({ "module.json": manifest("1.0.0"), "index.mjs": "export default {};" }); repo.g("tag", "v1.0.0");
  const release = (v, dv) => { fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifest(v, dv))); fs.writeFileSync(path.join(repo.dir, "index.mjs"), "export default { migrations: { 2: async () => {}, 3: async () => {} } };"); repo.g("commit", "-qam", v); repo.g("tag", `v${v}`); };
  assert.equal((await installModule(`${repo.url}#v1.0.0`)).ok, true);
  await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "C", names: { fr: "C" } });
  await F.bulkUpdateCopy(undefined, Date.now());
  release("1.1.0", 2); await updateModule("carnet");
  assert.equal(names().filter((f) => f.startsWith("pre-migration-")).length, 0, "copie de lot récente : pas de pre-migration");
  fs.rmSync(backups(), { recursive: true, force: true });
  release("1.2.0", 3); await updateModule("carnet");
  assert.equal(names().filter((f) => f.startsWith("pre-migration-")).length, 1);
});
