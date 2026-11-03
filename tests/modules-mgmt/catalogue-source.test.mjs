import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Le catalogue (dépôt de modules, version épinglée) est la SEULE source de tout module installé. Les « anciennes lignes » `bundled` sont celles d'un site créé avec une
// des premières versions du cœur : leur dossier est sur le disque, mais plus aucun code ne les convertit au catalogue (retiré, version minimale de mise à jour 0.2.0).
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
const Upd = await import("@/core/modules/updateStatus");
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
  await db.prisma.module.create({ data: { id, source: "bundled", version: man(id, over).version, enabled: true } });
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

test("ligne `bundled` restée d'une des premières versions : plus de conversion ni de mise à jour ; origine « catalogue » tant que le catalogue la liste ; elle reste installée et fonctionne", async () => {
  const { inst } = await installedOldCopy("theta");
  assert.equal(Cat.moduleOrigin(await row("theta"), await Cat.getCatalogue()), "catalogue", "la sauvegarde la dit « du catalogue »");
  // Même avec une version plus récente au catalogue : aucune mise à jour proposée, aucune conversion.
  const c = await I.checkForUpdateDetailed("theta");
  assert.deepEqual([c.check.available, c.failed], [false, false]);
  assert.equal((await Upd.getModulesReport(true)).outdated.length, 0, "« Tout mettre à jour » ne la voit pas");
  assert.equal((await I.updateModule("theta")).error, "modules.error.unknownSource");
  assert.equal((await X.reinstallModule("theta")).error, "modules.error.unknownSource");
  const hash = X.fingerprintDir(dir("theta")).hash;
  const after = await row("theta");
  assert.deepEqual([after.source, after.version, after.repoUrl, after.ref, after.subdir, after.commit, after.tree, after.enabled], ["bundled", "1.0.0", null, null, null, null, null, true], "la ligne n'a pas bougé");
  assert.equal(X.fingerprintDir(dir("theta")).hash, hash, "les fichiers non plus");
  assert.equal(await getSetting(`instance.${inst.id}.titre`), "Mon carnet");
  assert.equal((await R.getModule("theta")).def.marker, "v1", "et il continue de fonctionner");
  assert.deepEqual(leftovers("theta"), []);
  // Le catalogue ne le liste plus : plus aucune garantie du catalogue.
  await setIndex();
  assert.equal(Cat.moduleOrigin(await row("theta"), await Cat.getCatalogue()), "custom");
  const d = await X.diagnoseModule("theta", { compare: "network" });
  assert.deepEqual([d.kind, d.catalogue, d.comparison], ["bundled", undefined, null]);
  assert.equal(Cat.moduleOrigin({ id: "inconnu", source: "bundled", repoUrl: null }, await Cat.getCatalogue()), "custom");
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
  for (const f of ["catalogue.ts", "reinstall.ts", "starter.ts"]) {
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
