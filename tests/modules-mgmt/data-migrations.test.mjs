import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule, setModuleEnabled, updateModule } = await import("@/core/modules/installer");
const D = await import("@/core/modules/dataMigrations");
const R = await import("@/core/modules/registry");
const { parseManifest } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");
const Rs = await import("@/core/backup/restore");
const { createBackup } = await import("@/core/backup/export");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (v, dataVersion) => ({ apiVersion: 2, id: "carnet", name: "Carnet", version: v, main: "index.mjs", ...(dataVersion ? { dataVersion } : {}) });
// v1 : { name } — v2 : { author } (renommage) — v3 : { author, tags: [] } (champ ajouté)
const MIGRATIONS = {
  2: "async (ctx) => { for (const r of await ctx.api.store.list('notes')) { const { name, ...rest } = r.data; await ctx.api.store.update(r.id, { ...rest, author: name }); } }",
  3: "async (ctx) => { for (const r of await ctx.api.store.list('notes')) await ctx.api.store.update(r.id, { ...r.data, tags: [] }); await ctx.api.store.add('journal', { migrated: 3 }); }",
};
const code = (steps, extra = "") => `export default { migrations: { ${steps.map((n) => `${n}: ${MIGRATIONS[n]}`).join(", ")}${extra} } };`;

function repoV1() {
  const repo = makeRepo({ "module.json": manifest("1.0.0"), "index.mjs": "export default {};" });
  repo.g("tag", "v1.0.0");
  repo.release = (v, dataVersion, source) => {
    fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifest(v, dataVersion)));
    fs.writeFileSync(path.join(repo.dir, "index.mjs"), source);
    repo.g("commit", "-qam", `release ${v}`); repo.g("tag", `v${v}`);
  };
  return repo;
}
async function installV1(repo) {
  assert.equal((await installModule(`${repo.url}#v1.0.0`)).ok, true);
  await setModuleEnabled("carnet", true);
}
async function instance(nickname, notes = [{ name: "Alice", text: "un" }, { name: "Bob", text: "deux" }]) {
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname, names: { fr: nickname } });
  for (const n of notes) await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "notes", data: JSON.stringify(n) } });
  return inst;
}
const notes = async (inst) => (await db.prisma.moduleRecord.findMany({ where: { instanceId: inst.id, collection: "notes" }, orderBy: { createdAt: "asc" } })).map((r) => JSON.parse(r.data));
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

test("manifeste : dataVersion entier ≥ 1, facultatif", () => {
  const m = (dataVersion) => ({ apiVersion: 2, id: "x1", name: "X", version: "1.0.0", ...(dataVersion === undefined ? {} : { dataVersion }) });
  for (const ok of [undefined, 1, 2, 10000]) assert.ok(parseManifest(m(ok)).ok, String(ok));
  for (const bad of [0, -1, 1.5, "2", 10001]) assert.equal(parseManifest(m(bad)).ok, false, String(bad));
});

test("mise à jour du module → les données de chaque instance sont converties, version des données mémorisée", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Premier"), b = await instance("Second", [{ name: "Carole", text: "trois" }]);
  repo.release("1.1.0", 2, code([2]));
  const result = await updateModule("carnet");
  assert.equal(result.ok, true);
  assert.deepEqual(result.migrations.map((m) => [m.status, m.from, m.to]).sort(), [["ok", 1, 2], ["ok", 1, 2]]);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice" }, { text: "deux", author: "Bob" }]);
  assert.deepEqual(await notes(b), [{ text: "trois", author: "Carole" }]);
  assert.equal(await D.dataVersionOf(a.id), 2);
  assert.equal(await D.dataStatusOf(a.id), null);
});

test("plusieurs versions d'un coup : migrations exécutées dans l'ordre ; une version sans migration ne fait qu'avancer le numéro", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  repo.release("1.5.0", 4, code([3, 2])); // la version 4 n'a pas de migration : le numéro avance simplement
  assert.equal((await updateModule("carnet")).ok, true);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice", tags: [] }, { text: "deux", author: "Bob", tags: [] }], "2 puis 3 : le renommage avant l'ajout de champ");
  assert.equal(await D.dataVersionOf(a.id), 4);
  assert.equal((await db.prisma.moduleRecord.findMany({ where: { instanceId: a.id, collection: "journal" } })).length, 1, "la migration 3 a bien tourné une fois");
});

test("une instance déjà à jour n'est pas migrée deux fois", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  repo.release("1.1.0", 2, code([2]));
  await updateModule("carnet");
  const again = await D.migrateModuleInstances("carnet");
  assert.deepEqual(again.map((m) => m.status), ["none"]);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice" }, { text: "deux", author: "Bob" }], "pas de second renommage");
});

test("une instance créée APRÈS la mise à jour naît à la version courante : rien à lui migrer", async () => {
  const repo = repoV1(); await installV1(repo);
  repo.release("1.1.0", 2, code([2]));
  await updateModule("carnet");
  const fresh = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "Neuve", names: { fr: "Neuve" } });
  assert.equal(await D.dataVersionOf(fresh.id), 2);
  await db.prisma.moduleRecord.create({ data: { instanceId: fresh.id, collection: "notes", data: JSON.stringify({ author: "Dora" }) } });
  assert.deepEqual((await D.migrateModuleInstances("carnet")).map((m) => m.status), ["none"]);
  assert.deepEqual(await notes(fresh), [{ author: "Dora" }], "la migration de renommage n'a pas touché des données déjà au nouveau format");
});

test("ÉCHEC : l'instance est remise exactement dans son état d'avant, mise à l'écart, les autres instances sont migrées", async () => {
  const repo = repoV1(); await installV1(repo);
  const bad = await instance("Abimee", [{ name: "Alice", text: "un" }, { name: "Piege", text: "x" }]);
  const good = await instance("Saine", [{ name: "Bob", text: "deux" }]);
  await setSetting(`instance.${bad.id}.reglage`, "valeur d'avant");
  // la migration plante sur la 2e note de CETTE instance, après avoir converti la 1re
  const failing = `export default { migrations: { 2: async (ctx) => { for (const r of await ctx.api.store.list('notes')) { const { name, ...rest } = r.data; if (name === 'Piege') throw new Error('donnée inattendue'); await ctx.api.store.update(r.id, { ...rest, author: name }); } await ctx.api.store.add('journal', { x: 1 }); } } };`;
  repo.release("1.1.0", 2, failing);
  const result = await quiet(() => updateModule("carnet"));
  assert.equal(result.ok, true, "le module est mis à jour même si une instance n'a pas pu l'être");
  const outcomes = Object.fromEntries(result.migrations.map((m) => [m.key, m]));
  assert.deepEqual([outcomes[bad.key].status, outcomes[bad.key].error], ["failed", "donnée inattendue"]);
  assert.equal(outcomes[good.key].status, "ok");
  // l'instance abîmée : intacte, mise à l'écart
  assert.deepEqual((await notes(bad)).map((n) => n.name), ["Alice", "Piege"], "AUCUNE donnée à moitié convertie");
  assert.equal(await getSetting(`instance.${bad.id}.reglage`), "valeur d'avant");
  assert.equal(await D.dataVersionOf(bad.id), 1);
  assert.deepEqual(await D.dataStatusOf(bad.id), { status: "failed", error: "donnée inattendue" });
  assert.deepEqual((await R.getActiveInstances()).map((a) => a.instance.key).sort(), [good.key], "elle ne tourne pas sur des données à moitié converties");
  // l'instance saine est migrée
  assert.deepEqual(await notes(good), [{ text: "deux", author: "Bob" }]);
});

test("copie de la base gardée avant toute migration", async () => {
  const repo = repoV1(); await installV1(repo);
  await instance("Carnet");
  repo.release("1.1.0", 2, code([2]));
  await updateModule("carnet");
  const copies = fs.readdirSync(path.join(process.env.DATA_DIR, "backups")).filter((f) => f.startsWith("pre-migration-"));
  assert.ok(copies.length >= 1);
});

test("RÉESSAYER après correction du module : la migration repart de l'état d'avant et aboutit", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  repo.release("1.1.0", 2, "export default { migrations: { 2: async () => { throw new Error('bug du module'); } } };");
  await quiet(() => updateModule("carnet"));
  assert.equal((await D.dataStatusOf(a.id)).status, "failed");
  assert.deepEqual(await quiet(() => D.retryInstanceMigration(a.id)).then((o) => o.status), "failed", "tant que le bug est là, on réessaie en vain sans rien abîmer");
  repo.release("1.1.1", 2, code([2]));
  const fixed = await updateModule("carnet");
  assert.equal(fixed.migrations[0].status, "ok");
  assert.equal(await D.dataStatusOf(a.id), null);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice" }, { text: "deux", author: "Bob" }]);
  assert.deepEqual((await R.getActiveInstances()).map((x) => x.instance.id), [a.id], "de nouveau en service");
});

test("données PLUS RÉCENTES que le code du module (restauration dans un module plus ancien) : mises à l'écart, jamais modifiées", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  await setSetting(`instance.${a.id}.__dataVersion`, 5);
  const out = await quiet(() => D.migrateModuleInstances("carnet"));
  assert.equal(out[0].status, "newer");
  assert.equal((await D.dataStatusOf(a.id)).status, "newer");
  assert.deepEqual(await notes(a), [{ name: "Alice", text: "un" }, { name: "Bob", text: "deux" }], "intactes");
  assert.deepEqual(await R.getActiveInstances(), []);
});

test("RESTAURATION d'une sauvegarde ancienne dans un module plus récent : les données sont mises à niveau automatiquement", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  const backup = await createBackup("un-mot-de-passe-solide", { iterations: 1000 });   // données au format v1
  repo.release("1.1.0", 2, code([2]));
  await updateModule("carnet");                                                        // le module passe en v2, la base en v2
  assert.equal(await D.dataVersionOf(a.id), 2);
  const opened = Rs.openBackup(backup.buffer, "un-mot-de-passe-solide", 1000);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o@example.org" });
  assert.equal(report.ok, true);
  assert.deepEqual(report.migrations.map((m) => [m.key, m.status, m.from, m.to]), [[a.key, "ok", 1, 2]]);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice" }, { text: "deux", author: "Bob" }], "données v1 de la sauvegarde converties en v2");
});

test("les données d'un module sans dataVersion ne sont jamais touchées (comportement d'avant)", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  repo.release("1.0.1", undefined, "export default {};");
  const r = await updateModule("carnet");
  assert.deepEqual(r.migrations.map((m) => m.status), ["none"]);
  assert.deepEqual(await notes(a), [{ name: "Alice", text: "un" }, { name: "Bob", text: "deux" }]);
});

test("suppression d'une instance : sa version de données et son statut disparaissent avec elle", async () => {
  const repo = repoV1(); await installV1(repo);
  repo.release("1.1.0", 2, code([2])); await updateModule("carnet");
  const fresh = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "Jetable", names: { fr: "J" } });
  const { deleteInstance } = await import("@/core/instanceService");
  await deleteInstance(fresh.id);
  assert.equal(await db.prisma.setting.count({ where: { key: { startsWith: `instance.${fresh.id}.` } } }), 0);
});

test("VERSIONS SAUTÉES : 1.0 → 1.3 rejoue la migration de 1.1 avec le code de 1.1, même si 1.3 ne la contient plus", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  repo.release("1.1.0", 2, code([2]));          // renommage name → author
  repo.release("1.2.0", 2, "export default {};"); // aucune évolution de données
  repo.release("1.3.0", 3, code([3]));           // le code récent ne connaît plus l'étape 2
  const result = await updateModule("carnet");
  assert.equal(result.ok, true);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice", tags: [] }, { text: "deux", author: "Bob", tags: [] }], "étape 2 (code de 1.1) puis 3 (code de 1.3)");
  assert.equal(await D.dataVersionOf(a.id), 3);
  assert.equal(await D.dataStatusOf(a.id), null);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "carnet" } })).ref, "v1.3.0");
  assert.equal((await R.getModule("carnet")).manifest.version, "1.3.0");
  assert.ok(fs.readdirSync(path.join(process.env.DATA_DIR, "backups")).some((f) => f.startsWith("pre-migration-")), "copie de la base avant migration");
});

test("VERSIONS SAUTÉES : si la migration d'une version intermédiaire échoue, on s'arrête sur elle, données intactes, instance à l'écart", async () => {
  const repo = repoV1(); await installV1(repo);
  const a = await instance("Carnet");
  repo.release("1.1.0", 2, "export default { migrations: { 2: async () => { throw new Error('bug en 1.1'); } } };");
  repo.release("1.2.0", 3, code([3]));
  const result = await quiet(() => updateModule("carnet"));
  assert.equal(result.ok, true);
  assert.equal(result.migrations[0].status, "failed");
  assert.equal((await db.prisma.module.findUnique({ where: { id: "carnet" } })).ref, "v1.1.0", "arrêté à la version fautive");
  assert.equal((await D.dataStatusOf(a.id)).status, "failed");
  assert.deepEqual(await notes(a), [{ name: "Alice", text: "un" }, { name: "Bob", text: "deux" }], "intactes");
  // l'auteur corrige dans une version suivante : la mise à jour reprend et rejoue la suite
  repo.release("1.1.1", 2, code([2]));
  const again = await updateModule("carnet");
  assert.equal(again.ok, true);
  assert.deepEqual(await notes(a), [{ text: "un", author: "Alice", tags: [] }, { text: "deux", author: "Bob", tags: [] }]);
  assert.equal(await D.dataVersionOf(a.id), 3);
});
