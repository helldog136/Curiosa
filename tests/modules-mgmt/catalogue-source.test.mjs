import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Le catalogue (dépôt de modules, version épinglée) est la source de tout module installé ; la copie hors ligne n'est qu'un repli.
// Aucun réseau : les dépôts https du catalogue sont redirigés vers des dépôts git locaux.
const EX = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-catsrc-"));
const GITCONF = path.join(EX, "gitconfig");
fs.writeFileSync(GITCONF, "");
process.env.CURIOSA_EXTRAS_DIR = EX;
process.env.GIT_CONFIG_GLOBAL = GITCONF;

const db = await useTestDb();
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
  fs.rmSync(path.join(EX, "modules"), { recursive: true, force: true });
  fs.rmSync(path.join(EX, "catalogue"), { recursive: true, force: true });
  fs.writeFileSync(GITCONF, "");
  C.setCoreVersionForTests(null);
  Rec.clearRecognizedCache();
});
after(() => { fs.rmSync(EX, { recursive: true, force: true }); return db.close(); });

const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
const code = (marker, migr = "") => `export default { marker: ${JSON.stringify(marker)}${migr} };\n`;
const MIGR = ", migrations: { 2: async (ctx) => { for (const r of await ctx.api.store.list('events')) await ctx.api.store.update(r.id, { ...r.data, migre: true }); } }";
const man = (id, over = {}) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...over });
const row = (id) => db.prisma.module.findUnique({ where: { id } });
const dir = (id) => R.moduleDir(id);
const leftovers = (id) => fs.readdirSync(path.dirname(dir(id))).filter((n) => /previous|incoming/.test(n));

/** Copie hors ligne de l'archive (extras/modules/<id>). */
function snapshot(id, over = {}, marker = "v1") {
  const d = path.join(EX, "modules", id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "module.json"), JSON.stringify(man(id, over)));
  fs.writeFileSync(path.join(d, "index.mjs"), code(marker));
}
/** Dépôt du catalogue : un vrai dépôt git, un dossier par module, une étiquette épinglée. Renvoie le dépôt et l'entrée d'index. */
function catalogueRepo(id, { over = { version: "1.1.0" }, marker = "v2", files = {}, entry = {}, manifest } = {}) {
  const repo = makeRepo({ [`modules/${id}/module.json`]: manifest ?? man(id, over), [`modules/${id}/index.mjs`]: code(marker, over.dataVersion ? MIGR : ""), ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`modules/${id}/${k}`, v])) });
  repo.g("tag", "v1.0.0");
  const https = `https://github.com/t/${id}`;
  fs.appendFileSync(GITCONF, `[url "${repo.url}"]\n\tinsteadOf = ${https}\n`);
  return { repo, entry: { id, name: id, description: "d", repo: https, subdir: `modules/${id}`, ref: "v1.0.0", version: man(id, over).version, apiVersion: 2, ...entry } };
}
function setIndex(...entries) {
  fs.mkdirSync(path.join(EX, "catalogue"), { recursive: true });
  fs.writeFileSync(path.join(EX, "catalogue", "index.json"), JSON.stringify({ version: 1, modules: entries }));
  Rec.clearRecognizedCache();
}
/** Le cas du propriétaire : module installé depuis la copie hors ligne en 1.0.0, avec instance, réglages, données ; le catalogue propose la suite. */
async function installedOldCopy(id, remote = {}, own = {}) {
  snapshot(id, own.manifest ?? {}, "v1");
  const cat = catalogueRepo(id, remote);
  // Installation d'abord avec un index SANS ce module : la ligne est `bundled`, comme sur le site du propriétaire.
  setIndex();
  assert.equal((await I.installFromCatalogue(id)).ok, true);
  assert.equal((await row(id)).source, "bundled");
  assert.equal((await I.setModuleEnabled(id, true)).ok, true);
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: "Carnet", names: { fr: "Carnet" } });
  await setSetting(`instance.${inst.id}.titre`, "Mon carnet");
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "events", data: JSON.stringify({ t: "x" }) } });
  setIndex(cat.entry);
  return { ...cat, inst };
}

test("priorité : l'entrée du catalogue n'est jamais masquée, même à égalité de version ; la copie hors ligne ne sert que pour ce que le catalogue ne liste pas", async () => {
  snapshot("alpha"); snapshot("beta"); snapshot("gamma", { version: "1.1.0" });
  setIndex(catalogueRepo("alpha").entry, catalogueRepo("gamma", { over: { version: "1.1.0" } }).entry);
  const by = Object.fromEntries((await Cat.getCatalogue()).map((e) => [e.id, e]));
  assert.deepEqual([by.alpha.source, by.alpha.version, by.alpha.ref, by.alpha.subdir, by.alpha.repo], ["recognized", "1.1.0", "v1.0.0", "modules/alpha", "https://github.com/t/alpha"]);
  assert.equal(by.gamma.source, "recognized", "à égalité aussi : une seule source de vérité");
  assert.equal(by.beta.source, "bundled", "repli : le catalogue ne le liste pas");
  assert.equal((await Cat.findCatalogueEntry("alpha")).source, "recognized");
});

test("module jamais installé : l'installation passe par le dépôt du catalogue (source git épinglée)", async () => {
  snapshot("delta");
  setIndex(catalogueRepo("delta").entry);
  assert.equal((await I.installFromCatalogue("delta")).ok, true);
  const r = await row("delta");
  assert.deepEqual([r.source, r.version, r.ref, r.subdir], ["git", "1.1.0", "v1.0.0", "modules/delta"]);
});

test("mise à jour : une copie 1.0.0 est proposée en 1.1.0 (niveau, version cible) ; à égalité ou en retard, rien", async () => {
  await installedOldCopy("epsilon");
  const c = await I.checkForUpdateDetailed("epsilon");
  assert.deepEqual([c.failed, c.check.available, c.check.target, c.check.level, c.check.needsCore], [false, true, "1.1.0", "minor", undefined]);
  setIndex({ ...(await Cat.findCatalogueEntry("epsilon")), version: "1.0.0", dir: undefined, source: undefined, kind: undefined });
  assert.equal((await I.checkForUpdateDetailed("epsilon")).check.available, false, "égalité : rien");
  await db.prisma.module.update({ where: { id: "epsilon" }, data: { version: "2.0.0" } });
  setIndex(catalogueRepo("epsilon").entry);
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

test("origine : un module non converti dont le catalogue propose plus récent reste « catalogue », jamais « custom »", async () => {
  await installedOldCopy("theta");
  assert.equal(Cat.moduleOrigin(await row("theta"), await Cat.getCatalogue()), "catalogue");
  setIndex();
  assert.equal(Cat.moduleOrigin(await row("theta"), await Cat.getCatalogue()), "catalogue", "la copie hors ligne le liste encore");
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

test("retour arrière complet : dépôt injoignable, autre identifiant, trop gros, cœur trop ancien, permissions élargies", async () => {
  const cases = {
    clone: (c) => fs.rmSync(c.repo.dir, { recursive: true, force: true }),
    idmismatch: null, size: null, core: null, perms: null,
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
  await run("clone-ko", {}, "modules.error.clone", cases.clone);
  await run("autre-id", { manifest: man("intrus", { version: "1.1.0" }) }, "modules.error.idmismatch");
  await run("trop-gros", { files: { "gros.bin": "x".repeat(10 * 1024 * 1024 + 1) } }, "modules.error.size");
  const core = await run("vieux-coeur", { over: { version: "1.1.0", minCore: "99.0.0" } }, "modules.error.core");
  assert.equal(core.needsCore, "99.0.0");
  const perms = await run("perm-plus", { over: { version: "1.1.0", permissions: ["mail"] } }, "modules.error.reinstallPerms");
  assert.equal(perms.detail, "mail");
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

test("repli hors ligne : catalogue injoignable, la réinstallation remet la copie locale sans rien convertir ; la mise à jour, elle, échoue proprement", async () => {
  const w = await installedOldCopy("nu");
  fs.rmSync(w.repo.dir, { recursive: true, force: true });
  fs.writeFileSync(path.join(dir("nu"), "index.mjs"), code("abime"));
  const r = await quiet(() => X.reinstallModule("nu"));
  assert.deepEqual([r.ok, r.changed], [true, true]);
  assert.equal((await row("nu")).source, "bundled");
  assert.equal((await quiet(() => I.updateModule("nu"))).error, "modules.error.clone");
});

test("assistant de configuration : le catalogue d'abord, la copie hors ligne seulement s'il est injoignable", async () => {
  snapshot("xi"); snapshot("omicron");
  const xi = catalogueRepo("xi"); const om = catalogueRepo("omicron");
  setIndex(xi.entry, om.entry);
  assert.equal(await S.provisionModule("xi"), "catalogue");
  const r = await row("xi");
  assert.deepEqual([r.source, r.version, r.enabled], ["git", "1.1.0", true]);
  fs.rmSync(om.repo.dir, { recursive: true, force: true });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await S.provisionModule("omicron"), "offline-copy"); } finally { console.warn = warn; }
  assert.deepEqual([(await row("omicron")).source, (await row("omicron")).version], ["bundled", "1.0.0"]);
});

test("neutralité : le cœur ne cite aucun identifiant de module dans les fichiers de cette règle", () => {
  for (const f of ["bundledUpdate.ts", "catalogue.ts", "reinstall.ts", "starter.ts"]) {
    const text = fs.readFileSync(path.join("src/core/modules", f), "utf8");
    assert.ok(!/\b(contacts|planning|twitch)\b/i.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), f);
  }
});

test("libellés : aucune clé manquante (fr/en) et aucune formulation « livré » dans l'interface", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")); const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of ["maintenance.result.catalogue", "maintenance.source.git", "maintenance.source.bundled"]) assert.ok(fr[k] && en[k], k);
  assert.match(fr["maintenance.result.catalogue"], /Une mise à jour est disponible \(\{version\}\) : lancez-la depuis Modules › Mises à jour/);
  assert.deepEqual(Object.keys(fr).filter((k) => !(k in en)), []);
  assert.deepEqual(Object.values(fr).filter((v) => typeof v === "string" && /livré|installé à la configuration/i.test(v)), []);
});
