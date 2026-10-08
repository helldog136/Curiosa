import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule, setModuleEnabled, checkForUpdate, updateModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");
const { moduleDir } = await import("@/core/modules/registry");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (over = {}) => ({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", main: "index.mjs", settings: [{ key: "greeting", type: "text", label: "G", default: "salut" }], ...over });
const CODE = (v) => `export default { sections: { hello: () => [{ type: "markdown", text: "version ${v}" }] } };\n`;

/** Dépôt de module avec une étiquette par version. */
function moduleRepo(version = "1.0.0") {
  const repo = makeRepo({ "module.json": manifest({ version }), "index.mjs": CODE(version) });
  repo.g("tag", `v${version}`);
  repo.release = (v, over = {}, code = CODE(v)) => {
    fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifest({ version: v, ...over })));
    fs.writeFileSync(path.join(repo.dir, "index.mjs"), code);
    repo.g("commit", "-qam", `release ${v}`); repo.g("tag", `v${v}`);
  };
  return repo;
}
const mod = () => db.prisma.module.findUnique({ where: { id: "demo" } });
async function installPinned(repo, ref = "v1.0.0") {
  repo.release ??= null;
  assert.equal((await installModule(`${repo.url}#${ref}`)).ok, true);
  await setModuleEnabled("demo", true);
}
async function withData() {
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("demo")).manifest, nickname: "Mon demo", names: { fr: "Mon demo" } });
  await setSetting(`instance.${inst.id}.greeting`, "coucou");
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "messages", data: JSON.stringify({ texte: "précieux" }) } });
  return inst;
}

test("épinglé sur une étiquette : la nouvelle étiquette stable est détectée, avec sa nature", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  assert.deepEqual(await checkForUpdate("demo"), { available: false, remote: "v1.0.0" });
  repo.release("1.0.1");
  assert.deepEqual(await checkForUpdate("demo"), { available: true, target: "v1.0.1", remote: "v1.0.1", level: "patch" });
  repo.release("1.1.0");
  assert.deepEqual((await checkForUpdate("demo")).level, "minor");
  assert.equal((await checkForUpdate("demo")).target, "v1.1.0", "la plus haute version, pas la suivante");
  repo.release("2.0.0");
  assert.deepEqual([(await checkForUpdate("demo")).target, (await checkForUpdate("demo")).level], ["v2.0.0", "major"]);
});

test("les pré-versions et étiquettes étrangères sont ignorées", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  repo.release("2.0.0-beta.1"); repo.g("tag", "nightly"); repo.g("tag", "v1.5");
  assert.equal((await checkForUpdate("demo")).available, false);
});

test("MISE À JOUR SANS PERTE DE DONNÉES : le code change, instances, réglages, stockage et nom restent", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  const inst = await withData();
  const before = (await mod()).commit;
  repo.release("1.1.0", {}, CODE("1.1.0"));
  const done = await updateModule("demo");
  assert.deepEqual([done.ok, done.id], [true, "demo"]);
  const row = await mod();
  assert.deepEqual([row.ref, row.version, row.commit !== before, row.enabled], ["v1.1.0", "1.1.0", true, true], "étiquette suivie, version et commit à jour, toujours activé");
  assert.match(fs.readFileSync(path.join(moduleDir("demo"), "index.mjs"), "utf8"), /version 1\.1\.0/);
  assert.equal((await R.getModule("demo")).def.sections.hello().at(0).text, "version 1.1.0", "le nouveau code est celui chargé");
  // les données, intactes
  const kept = await db.prisma.moduleInstance.findUnique({ where: { id: inst.id } });
  assert.deepEqual([kept.key, kept.nickname], [inst.key, "Mon demo"]);
  assert.equal(await getSetting(`instance.${inst.id}.greeting`), "coucou");
  assert.deepEqual(JSON.parse((await db.prisma.moduleRecord.findFirst({ where: { instanceId: inst.id } })).data), { texte: "précieux" });
  assert.equal((await checkForUpdate("demo")).available, false, "à jour : plus rien à proposer");
});

test("plusieurs étiquettes publiées d'un coup : on passe directement à la plus haute", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  repo.release("1.1.0"); repo.release("1.2.0");
  await updateModule("demo");
  assert.deepEqual([(await mod()).ref, (await mod()).version], ["v1.2.0", "1.2.0"]);
});

test("déjà à jour : message clair, rien n'est modifié", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  const before = await mod();
  assert.deepEqual(await updateModule("demo"), { ok: false, error: "modules.error.uptodate" });
  assert.equal((await mod()).commit, before.commit);
});

test("nouvelle version INVALIDE : l'ancienne est rétablie (fichiers et base), le module continue de fonctionner", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  await withData();
  const before = await mod();
  for (const [label, over, expected] of [
    ["manifeste cassé", null, "modules.error.nomanifest"],
    ["autre identifiant", { id: "autre" }, "modules.error.nomanifest"],
    ["API incompatible", { apiVersion: 9 }, "modules.error.nomanifest"],
    ["fichier principal absent", { main: "absent.mjs" }, "modules.error.nomain"],
  ]) {
    if (over) repo.release("1.1.0", over); else { fs.writeFileSync(path.join(repo.dir, "module.json"), "{pas du json"); repo.g("commit", "-qam", "cassé"); repo.g("tag", "v1.1.0"); }
    const log = console.error; console.error = () => {};
    try { assert.deepEqual(await updateModule("demo"), { ok: false, error: expected }, label); } finally { console.error = log; }
    const after = await mod();
    assert.deepEqual([after.ref, after.version, after.commit], [before.ref, before.version, before.commit], `${label} : base inchangée`);
    assert.match(fs.readFileSync(path.join(moduleDir("demo"), "index.mjs"), "utf8"), /version 1\.0\.0/, `${label} : fichiers d'avant`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(moduleDir("demo"), "module.json"), "utf8")).version, "1.0.0");
    assert.ok(await R.getModule("demo"), `${label} : le module se recharge`);
    repo.g("tag", "-d", "v1.1.0"); repo.g("reset", "-q", "--hard", "v1.0.0");
  }
});

test("une nouvelle version trop volumineuse est refusée et annulée", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  repo.release("1.1.0");
  fs.writeFileSync(path.join(repo.dir, "gros.bin"), Buffer.alloc(11 * 1024 * 1024));
  repo.g("add", "-A"); repo.g("commit", "-q", "--amend", "--no-edit"); repo.g("tag", "-f", "v1.1.0");
  const log = console.error; console.error = () => {};
  try { assert.deepEqual(await updateModule("demo"), { ok: false, error: "modules.error.size" }); } finally { console.error = log; }
  assert.equal((await mod()).version, "1.0.0");
  assert.ok(!fs.existsSync(path.join(moduleDir("demo"), "gros.bin")));
});

test("épinglé sur un commit : jamais de mise à jour, c'est le but", async () => {
  const repo = moduleRepo(); await installPinned(repo, repo.commit);
  repo.release("1.1.0");
  assert.deepEqual(await checkForUpdate("demo"), { available: false });
  assert.deepEqual(await updateModule("demo"), { ok: false, error: "modules.error.pinned" });
});

test("sur une branche (ou sans épinglage) : suit toujours les nouveaux commits, comme avant", async () => {
  const repo = moduleRepo();
  assert.equal((await installModule(`${repo.url}#main`)).ok, true);
  assert.equal((await checkForUpdate("demo")).available, false);
  repo.release("1.0.1");
  const check = await checkForUpdate("demo");
  assert.equal(check.available, true);
  assert.equal(check.level, undefined, "pas de nature pour un simple commit");
  assert.equal((await updateModule("demo")).ok, true);
  assert.deepEqual([(await mod()).ref, (await mod()).version], ["main", "1.0.1"], "la branche suivie ne change pas");
  const noRef = moduleRepo();
  await db.prisma.module.delete({ where: { id: "demo" } }); fs.rmSync(moduleDir("demo"), { recursive: true, force: true });
  assert.equal((await installModule(noRef.url)).ok, true);
  assert.equal((await mod()).ref, null);
  noRef.release("1.0.1");
  assert.equal((await checkForUpdate("demo")).available, true);
});

test("dépôt injoignable : pas d'erreur, simplement rien à proposer", async () => {
  const repo = moduleRepo(); await installPinned(repo);
  fs.rmSync(repo.dir, { recursive: true, force: true });
  assert.deepEqual(await checkForUpdate("demo"), { available: false });
});

test("module livré avec le framework : la mise à jour indique la version cible", async () => {
  const { installBundled } = await import("@/core/modules/installer");
  await installBundled("demo-banner");
  await db.prisma.module.update({ where: { id: "demo-banner" }, data: { version: "0.0.1" } });
  const c = await checkForUpdate("demo-banner");
  assert.equal(c.available, true);
  assert.ok(["minor", "major", "patch"].includes(c.level));
  assert.ok(c.target);
});

test("installation épinglée sur un commit : le module est exactement ce commit, même si le dépôt a avancé depuis", async () => {
  const repo = moduleRepo();
  const pinned = repo.commit;
  repo.release("1.1.0");
  assert.equal((await installModule(`${repo.url}#${pinned}`)).ok, true);
  const row = await mod();
  assert.deepEqual([row.commit, row.version, row.ref], [pinned, "1.0.0", pinned]);
  assert.match(fs.readFileSync(path.join(moduleDir("demo"), "index.mjs"), "utf8"), /version 1\.0\.0/);
});
