import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Le catalogue (dépôt de modules, version épinglée) est la SEULE source de tout module installé. Les « anciennes lignes » `bundled` sont celles d'un site créé avec une
// ancienne version du cœur (compatibilité, à retirer en 0.3.0) : leur dossier est déjà sur le disque, le catalogue est leur source, jamais un repli local.
// Aucun réseau : les dépôts https du catalogue sont redirigés vers des dépôts git locaux.
const db = await useTestDb();
const GITCONF = process.env.GIT_CONFIG_GLOBAL;
const cat0 = createCatalogue();
const BASE_GITCONF = fs.readFileSync(GITCONF, "utf8");
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Cat = await import("@/core/modules/catalogue");
const Rec = await import("@/core/modules/recognized");
const X = await import("@/core/modules/reinstall");
const Bulk = await import("@/core/modules/bulkUpdate");
const Upd = await import("@/core/modules/updateStatus");
const D = await import("@/core/modules/dataMigrations");
const C = await import("@/core/modules/compat");
const S = await import("@/core/modules/starter");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");

beforeEach(async () => {
  await db.reset();
  await cat0.clear();
  fs.writeFileSync(GITCONF, BASE_GITCONF);
  C.setCoreVersionForTests(null);
  Rec.clearRecognizedCache();
});
after(() => { cat0.close(); return db.close(); });

const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
const code = (marker, migr = "") => `export default { marker: ${JSON.stringify(marker)}${migr} };\n`;
const MIGR = ", migrations: { 2: async (ctx) => { for (const r of await ctx.api.store.list('events')) await ctx.api.store.update(r.id, { ...r.data, migre: true }); } }";
const man = (id, over = {}) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...over });
const row = (id) => db.prisma.module.findUnique({ where: { id } });
const dir = (id) => R.moduleDir(id);
const leftovers = (id) => fs.readdirSync(path.dirname(dir(id))).filter((n) => /previous|incoming/.test(n));

/** Un site d'avant : le dossier du module est déjà sur le disque (ancien code) avec sa ligne `bundled`. */
async function legacySite(id, over = {}, marker = "v1") {
  const d = dir(id);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "module.json"), JSON.stringify(man(id, over)));
  fs.writeFileSync(path.join(d, "index.mjs"), code(marker));
  await db.prisma.module.create({ data: { id, source: "bundled", version: man(id, over).version, enabled: false } });
}
/** Dépôt du catalogue : un vrai dépôt git, un dossier par module, une étiquette épinglée. Renvoie le dépôt et l'entrée d'index. */
function catalogueRepo(id, { over = { version: "1.1.0" }, marker = "v2", files = {}, entry = {}, manifest } = {}) {
  const repo = makeRepo({ [`modules/${id}/module.json`]: manifest ?? man(id, over), [`modules/${id}/index.mjs`]: code(marker, over.dataVersion ? MIGR : ""), ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`modules/${id}/${k}`, v])) });
  repo.g("tag", "v1.0.0");
  const https = `https://github.com/t/${id}`;
  fs.appendFileSync(GITCONF, `[url "${repo.url}"]\n\tinsteadOf = ${https}\n`);
  return { repo, entry: { id, name: id, description: "d", repo: https, subdir: `modules/${id}`, ref: "v1.0.0", version: man(id, over).version, apiVersion: 2, ...entry } };
}
const setIndex = (...entries) => cat0.setIndex(...entries);
/** Le cas du propriétaire : module installé par une ancienne version en 1.0.0, avec instance, réglages, données ; le catalogue propose la suite. */
async function installedOldCopy(id, remote = {}, own = {}) {
  await legacySite(id, own.manifest ?? {}, "v1");
  const cat = catalogueRepo(id, remote);
  assert.equal((await row(id)).source, "bundled");
  assert.equal((await I.setModuleEnabled(id, true)).ok, true);
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: "Carnet", names: { fr: "Carnet" } });
  await setSetting(`instance.${inst.id}.titre`, "Mon carnet");
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "events", data: JSON.stringify({ t: "x" }) } });
  await setIndex(cat.entry);
  return { ...cat, inst };
}

test("catalogue : l'index est la seule source (dépôt git épinglé) ; un module absent de l'index n'est pas proposé, même s'il est installé", async () => {
  await legacySite("beta");
  await setIndex(catalogueRepo("alpha").entry, catalogueRepo("gamma", { over: { version: "1.1.0" } }).entry);
  const by = Object.fromEntries((await Cat.getCatalogue()).map((e) => [e.id, e]));
  assert.deepEqual([by.alpha.kind, by.alpha.version, by.alpha.ref, by.alpha.subdir, by.alpha.repo], ["recognized", "1.1.0", "v1.0.0", "modules/alpha", "https://github.com/t/alpha"]);
  assert.equal(by.beta, undefined, "ni dans l'index, ni ailleurs : aucune copie locale ne le propose");
  assert.equal(await Cat.findCatalogueEntry("beta"), undefined);
  assert.equal(by.gamma.kind, "recognized");
});

test("module jamais installé : l'installation passe par le dépôt du catalogue (source git épinglée)", async () => {
  await setIndex(catalogueRepo("delta").entry);
  assert.equal((await I.installFromCatalogue("delta")).ok, true);
  const r = await row("delta");
  assert.deepEqual([r.source, r.version, r.ref, r.subdir], ["git", "1.1.0", "v1.0.0", "modules/delta"]);
});

test("mise à jour : une copie 1.0.0 est proposée en 1.1.0 (niveau, version cible) ; à égalité ou en retard, rien", async () => {
  await installedOldCopy("epsilon");
  const c = await I.checkForUpdateDetailed("epsilon");
  assert.deepEqual([c.failed, c.check.available, c.check.target, c.check.level, c.check.needsCore], [false, true, "1.1.0", "minor", undefined]);
  const known = await Cat.findCatalogueEntry("epsilon");
  await setIndex({ id: "epsilon", name: "epsilon", description: "d", repo: known.repo, subdir: known.subdir, ref: known.ref, apiVersion: 2, version: "1.0.0" });
  assert.equal((await I.checkForUpdateDetailed("epsilon")).check.available, false, "égalité : rien");
  await db.prisma.module.update({ where: { id: "epsilon" }, data: { version: "2.0.0" } });
  await setIndex(catalogueRepo("epsilon").entry);
  assert.equal((await I.checkForUpdateDetailed("epsilon")).check.available, false, "catalogue en retard : rien");
});

test("cœur trop ancien : la version du catalogue demande Curiosa X, elle n'est ni proposée comme installable ni appliquée", async () => {
  await installedOldCopy("zeta", { entry: { requires: { core: "99.0.0" } } });
  const c = await I.checkForUpdateDetailed("zeta");
  assert.deepEqual([c.check.available, c.check.needsCore], [true, "99.0.0"]);
  const r = await I.updateModule("zeta");
  assert.deepEqual([r.ok, r.error, r.needsCore], [false, "modules.error.core", "99.0.0"]);
  assert.equal((await row("zeta")).source, "bundled");
  const rep = await Bulk.collectReport([{ id: "zeta", version: "1.0.0" }], I.checkForUpdateDetailed);
  assert.equal(rep.outdated[0].needsCore, "99.0.0");
  const sum = await Bulk.updateSequentially(["zeta"], I.updateModule);
  assert.deepEqual(sum.incompatible, [{ id: "zeta", core: "99.0.0" }]);
});

test("conversion : le module devient un module du catalogue et GARDE instances, réglages, données, état, date d'installation", async () => {
  const { inst, entry } = await installedOldCopy("eta");
  const before = await row("eta");
  await setSetting("autre.reglage", "garde");
  const r = await I.updateModule("eta");
  assert.equal(r.ok, true);
  assert.match(r.auditTarget, /^eta 1\.0\.0 -> 1\.1\.0 \(bundled -> catalogue\)$/);
  assert.ok(!r.auditTarget.includes("github") && !r.auditTarget.includes("file:"));
  const after = await row("eta");
  assert.deepEqual([after.source, after.version, after.ref, after.subdir, after.repoUrl], ["git", "1.1.0", "v1.0.0", "modules/eta", entry.repo]);
  assert.ok(after.commit && after.tree);
  assert.equal(after.enabled, true);
  assert.equal(after.installedAt.getTime(), before.installedAt.getTime());
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "eta" } }), 1);
  assert.equal(await getSetting(`instance.${inst.id}.titre`), "Mon carnet");
  assert.equal(await getSetting("autre.reglage"), "garde");
  assert.equal(await db.prisma.moduleRecord.count({ where: { instanceId: inst.id } }), 1);
  assert.equal((await R.getModule("eta")).def.marker, "v2", "le nouveau code sert tout de suite (cache d'imports cassé)");
  assert.deepEqual(fs.readdirSync(dir("eta")).sort(), ["index.mjs", "module.json"]);
  assert.deepEqual(leftovers("eta"), []);
  // Origine et suite : un module du catalogue comme un autre.
  assert.equal(Cat.moduleOrigin(after, await Cat.getCatalogue()), "catalogue");
  assert.equal((await I.checkForUpdateDetailed("eta")).check.available, false);
  assert.equal((await I.updateModule("eta")).error, "modules.error.uptodate");
});

test("origine : un module non converti dont le catalogue propose plus récent reste « catalogue », jamais « custom » ; le catalogue ne le liste plus : source inconnue, il reste installé", async () => {
  await installedOldCopy("theta");
  assert.equal(Cat.moduleOrigin(await row("theta"), await Cat.getCatalogue()), "catalogue");
  await setIndex();
  assert.equal(Cat.moduleOrigin(await row("theta"), await Cat.getCatalogue()), "custom", "non listé : plus aucune garantie du catalogue");
  assert.equal((await row("theta")).source, "bundled", "installé tel quel");
  assert.equal((await R.getModule("theta")).def.marker, "v1", "et il continue de fonctionner");
  const c = await I.checkForUpdateDetailed("theta");
  assert.deepEqual([c.check.available, c.failed], [false, true], "la vérification est signalée comme impossible, pas comme « à jour »");
  assert.equal((await I.updateModule("theta")).error, "modules.error.unknownSource");
  const d = await X.diagnoseModule("theta", { compare: "network" });
  assert.deepEqual([d.kind, d.catalogue, d.comparison], ["bundled", undefined, null]);
  assert.equal(Cat.moduleOrigin({ id: "inconnu", source: "bundled", repoUrl: null }, await Cat.getCatalogue()), "custom");
});

test("migration de données rejouée à la conversion (dataVersion)", async () => {
  const { inst } = await installedOldCopy("iota", { over: { version: "1.1.0", dataVersion: 2 } });
  assert.equal(await D.dataVersionOf(inst.id), 1);
  const r = await I.updateModule("iota");
  assert.equal(r.ok, true);
  assert.deepEqual(r.migrations.map((m) => m.status), ["ok"]);
  assert.equal(await D.dataVersionOf(inst.id), 2);
  const rec = await db.prisma.moduleRecord.findFirst({ where: { instanceId: inst.id } });
  assert.equal(JSON.parse(rec.data).migre, true);
});

test("« Tout mettre à jour » : le module apparaît dans le rapport et la mise à jour le convertit", async () => {
  await installedOldCopy("kappa");
  const rep = await Upd.getModulesReport(true);
  assert.deepEqual(rep.outdated.map((o) => [o.id, o.current, o.target, o.level]), [["kappa", "1.0.0", "1.1.0", "minor"]]);
  const sum = await Upd.updateModules(["kappa"]);
  assert.deepEqual(sum.updated, ["kappa"]);
  assert.equal((await row("kappa")).source, "git");
  assert.equal((await Upd.getModulesReport(true)).outdated.length, 0);
});

test("retour arrière complet : dépôt injoignable, autre identifiant, trop gros, cœur trop ancien", async () => {
  const cases = {
    clone: (c) => fs.rmSync(c.repo.dir, { recursive: true, force: true }),
  };
  const run = async (id, remote, error, prep) => {
    const w = await installedOldCopy(id, remote);
    prep?.(w);
    const hash = X.fingerprintDir(dir(id)).hash;
    const r = await quiet(() => I.updateModule(id));
    assert.equal(r.ok, false, id);
    assert.equal(r.error, error, id);
    const after = await row(id);
    assert.deepEqual([after.source, after.version, after.repoUrl, after.ref, after.subdir, after.commit, after.tree, after.enabled], ["bundled", "1.0.0", null, null, null, null, null, true], `${id} : la ligne est intacte`);
    assert.equal(X.fingerprintDir(dir(id)).hash, hash, `${id} : les fichiers sont intacts`);
    assert.deepEqual(leftovers(id), []);
    assert.equal((await R.getModule(id)).def.marker, "v1");
    return r;
  };
  await run("clone-ko", {}, "modules.error.catalogue", cases.clone);
  await run("autre-id", { manifest: man("intrus", { version: "1.1.0" }) }, "modules.error.idmismatch");
  await run("trop-gros", { files: { "gros.bin": "x".repeat(10 * 1024 * 1024 + 1) } }, "modules.error.size");
  const core = await run("vieux-coeur", { over: { version: "1.1.0", minCore: "99.0.0" } }, "modules.error.core");
  assert.equal(core.needsCore, "99.0.0");
});

test("mise à jour vers le catalogue : une version qui déclare de nouvelles permissions est appliquée (comme toute mise à jour), la réinstallation simple, elle, les refuse", async () => {
  await installedOldCopy("perm-plus", { over: { version: "1.1.0", permissions: ["mail"] } });
  const r = await quiet(() => I.updateModule("perm-plus"));
  assert.equal(r.ok, true);
  assert.equal((await row("perm-plus")).source, "git");
});

test("retour arrière complet aussi après l'échange et l'écriture de la ligne (panne tardive) : fichiers ET ligne Module", async () => {
  await installedOldCopy("lambda");
  const hash = X.fingerprintDir(dir("lambda")).hash;
  const r = await quiet(() => X.reinstallModule("lambda", { catalogueOnly: true, afterSwap: () => { throw new Error("panne"); } }));
  assert.deepEqual([r.ok, r.rolledBack], [false, true]);
  assert.equal((await row("lambda")).source, "bundled");
  assert.equal(X.fingerprintDir(dir("lambda")).hash, hash);
  const real = db.prisma.moduleInstance.findMany;   // la migration lit les instances : panne DANS l'étape finale
  db.prisma.moduleInstance.findMany = () => { throw new Error("base"); };
  let r2;
  try { r2 = await quiet(() => X.reinstallModule("lambda", { catalogueOnly: true })); } finally { db.prisma.moduleInstance.findMany = real; }
  assert.deepEqual([r2.ok, r2.rolledBack], [false, true]);
  const back = await row("lambda");
  assert.deepEqual([back.source, back.version, back.repoUrl, back.commit], ["bundled", "1.0.0", null, null]);
  assert.equal(X.fingerprintDir(dir("lambda")).hash, hash);
  assert.deepEqual(leftovers("lambda"), []);
});

test("Maintenance : le diagnostic donne le dépôt du catalogue ; réinstaller convertit ; une fois converti, plus de proposition", async () => {
  await installedOldCopy("mu");
  const d = await X.diagnoseModule("mu", { compare: "network" });
  assert.equal(d.catalogue.version, "1.1.0");
  assert.equal(d.catalogue.subdir, "modules/mu");
  assert.equal(d.comparison.state, "different");
  const r = await X.reinstallModule("mu");
  assert.deepEqual([r.ok, r.changed, r.after.version], [true, true, "1.1.0"]);
  assert.equal((await row("mu")).source, "git");
  assert.equal((await X.diagnoseModule("mu")).catalogue, undefined);
  assert.equal((await X.reinstallModule("mu")).changed, false);
});

test("catalogue injoignable : AUCUN repli local — la mise à jour et la réinstallation échouent avec un message clair, le module installé reste tel quel", async () => {
  const w = await installedOldCopy("nu");
  fs.writeFileSync(path.join(dir("nu"), "index.mjs"), code("abime"));
  const hash = X.fingerprintDir(dir("nu")).hash;
  // 1. le dépôt du module est parti
  fs.rmSync(w.repo.dir, { recursive: true, force: true });
  for (const run of [() => X.reinstallModule("nu"), () => I.updateModule("nu")]) {
    const r = await quiet(run);
    assert.deepEqual([r.ok, r.error], [false, "modules.error.catalogue"]);
  }
  // 2. le catalogue entier est injoignable (aucune copie reçue non plus)
  await cat0.down({ forget: true });
  for (const run of [() => X.reinstallModule("nu"), () => I.updateModule("nu")]) {
    const r = await quiet(run);
    assert.deepEqual([r.ok, r.error], [false, "modules.error.catalogue"]);
  }
  const c = await I.checkForUpdateDetailed("nu");
  assert.deepEqual([c.check.available, c.failed], [false, true]);
  assert.equal((await row("nu")).source, "bundled");
  assert.equal(X.fingerprintDir(dir("nu")).hash, hash, "pas de copie locale remise à la place : le dossier n'a pas bougé");
  assert.deepEqual(leftovers("nu"), []);
});

test("assistant de configuration : depuis le catalogue seulement, jamais de copie locale", async () => {
  const xi = catalogueRepo("xi"); const om = catalogueRepo("omicron");
  await setIndex(xi.entry, om.entry);
  assert.equal(await S.provisionModule("xi"), true);
  const r = await row("xi");
  assert.deepEqual([r.source, r.version, r.enabled], ["git", "1.1.0", true]);
  fs.rmSync(om.repo.dir, { recursive: true, force: true });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await S.provisionModule("omicron"), false); } finally { console.warn = warn; }
  assert.equal(await row("omicron"), null);
  assert.ok(!fs.existsSync(dir("omicron")));
});

test("neutralité : le cœur ne cite aucun identifiant de module dans les fichiers de cette règle", () => {
  for (const f of ["bundledUpdate.ts", "catalogue.ts", "reinstall.ts", "starter.ts"]) {
    const text = fs.readFileSync(path.join("src/core/modules", f), "utf8");
    assert.ok(!/\b(contacts|planning|twitch)\b/i.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), f);
  }
});

test("libellés : aucune clé manquante (fr/en) et aucune formulation « livré / embarqué / copie hors ligne / instantané » dans l'interface", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")); const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of ["maintenance.source.git", "maintenance.source.unknown", "modules.error.catalogue", "modules.error.unknownSource", "catalogue.unreachable"]) assert.ok(fr[k] && en[k], k);
  assert.match(fr["modules.error.catalogue"], /Le catalogue n'est pas joignable, réessayez/);
  assert.deepEqual(Object.keys(fr).filter((k) => !(k in en)), []);
  assert.deepEqual(Object.values(fr).filter((v) => typeof v === "string" && /livré|embarqué|hors ligne|instantané|copie locale|installé à la configuration/i.test(v)), []);
});
