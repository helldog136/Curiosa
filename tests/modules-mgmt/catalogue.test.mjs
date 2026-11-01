import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
const M = await import("@/core/modules/catalogue");
const { installFromCatalogue, installModule, uninstallModule, updateModule, checkForUpdate } = await import("@/core/modules/installer");
const { clearRecognizedCache } = await import("@/core/modules/recognized");
const R = await import("@/core/modules/registry");
const { MODULES_DIR } = await import("@/core/config");

beforeEach(async () => { await db.reset(); await cat.clear(); clearRecognizedCache(); delete process.env.MODULES_INDEX_URL; });
after(() => { cat.close(); return db.close(); });

const base = (over) => ({ apiVersion: 2, version: "1.0.0", name: "Demo", ...over });
const indexOf = (items) => async () => Response.json(items);

test("catalogue : l'index du dépôt de modules est la source ; chaque entrée est un dépôt git épinglé, le cœur n'en a aucune autre", async () => {
  await cat.fixtures(["demo-planner", "demo-sponsors", "demo-banner"]);
  const list = await M.getCatalogue();
  const ids = list.map((e) => e.id);
  for (const id of ["demo-planner", "demo-sponsors", "demo-banner"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  for (const e of list) {
    assert.deepEqual([e.kind, e.compatible, e.repo, e.subdir, "source" in e || "dir" in e], ["recognized", true, cat.https, `modules/${e.id}`, false], e.id);
    assert.ok(e.name && e.description && e.version && e.ref, e.id);
  }
});

test("catalogue : un module dont le manifeste n'est pas dans l'index n'est pas proposé ; index absent → liste vide (jamais une copie locale)", async () => {
  await cat.add("liste", { listed: true });
  await cat.add("non-liste", { listed: false });
  assert.deepEqual((await M.getCatalogue()).map((e) => e.id), ["liste"]);
  await cat.down({ forget: true });
  assert.deepEqual(await M.getCatalogue(), []);
});

test("catalogue : les dépôts reconnus de l'index sont la source ; un index supplémentaire n'ajoute que ce que le premier ne liste pas", async () => {
  await cat.fixtures(["demo-planner"]);
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const fetchImpl = indexOf([
    { id: "tiers-un", name: "Tiers", description: "d", repo: "https://github.com/x/tiers", version: "2.0.0" },
    { id: "demo-planner", name: "Faux planning", description: "d", repo: "https://github.com/x/planning" },
    { id: "ancien", name: "Ancien", description: "d", repo: "https://github.com/x/ancien", apiVersion: 1 },
  ]);
  const list = await M.getCatalogue({ fetchImpl });
  const by = Object.fromEntries(list.map((e) => [e.id, e]));
  assert.equal(by["demo-planner"].repo, cat.https, "pas de doublon : l'entrée du dépôt de modules gagne");
  assert.deepEqual([by["tiers-un"].kind, by["tiers-un"].compatible, by["tiers-un"].repo], ["recognized", true, "https://github.com/x/tiers"]);
  assert.equal(by.ancien.compatible, false, "autre version de l'API des modules : listé mais non installable");
  assert.equal(list.filter((e) => e.id === "demo-planner").length, 1);
});

test("index reconnu : entrées invalides écartées (identifiant, dépôt non https, hôte non autorisé, file://, doublons)", async () => {
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const fetchImpl = indexOf([
    { id: "Mauvais Id", repo: "https://github.com/x/a" }, { id: "http-seul", repo: "http://github.com/x/a" }, { id: "hote-inconnu", repo: "https://evil.example/x/a" },
    { id: "local", repo: "file:///tmp/x" }, { id: "credentials", repo: "https://u:p@github.com/x/a" }, { id: "ok", repo: "https://github.com/x/ok" }, { id: "ok", repo: "https://github.com/x/ok2" }, null, "texte",
  ]);
  const remote = await M.getCatalogue({ fetchImpl });
  assert.deepEqual(remote.map((e) => e.id), ["ok"]);
  assert.equal(remote[0].repo, "https://github.com/x/ok", "premier de l'index conservé");
});

test("installation d'un module du catalogue : cloné à l'étiquette épinglée, actif, source git", async () => {
  await cat.fixtures(["demo-planner"]);
  assert.deepEqual(await installFromCatalogue("demo-planner"), { ok: true, id: "demo-planner" });
  const row = await db.prisma.module.findUnique({ where: { id: "demo-planner" } });
  assert.deepEqual([row.source, row.enabled, row.repoUrl, row.subdir], ["git", true, cat.https, "modules/demo-planner"]);
  assert.ok(row.commit);
  assert.ok(fs.existsSync(path.join(MODULES_DIR, "demo-planner", "module.json")) && fs.existsSync(path.join(MODULES_DIR, "demo-planner", "index.mjs")));
  assert.ok((await R.getInstalledModules()).some((m) => m.manifest.id === "demo-planner"), "il est chargé et actif");
});

test("installation d'un module du catalogue : refus si déjà installé ou inconnu ; catalogue injoignable → erreur, rien d'installé", async () => {
  await cat.fixtures(["demo-planner"]);
  await installFromCatalogue("demo-planner");
  assert.equal((await installFromCatalogue("demo-planner")).error, "modules.error.exists");
  assert.equal((await installFromCatalogue("inconnu")).error, "modules.error.notfound");
  assert.equal((await installFromCatalogue("../../etc")).error, "modules.error.notfound", "pas d'évasion de chemin");
  await cat.down({ forget: true });
  assert.equal((await installFromCatalogue("demo-sponsors")).ok, false);
  assert.equal(await db.prisma.module.findUnique({ where: { id: "demo-sponsors" } }), null);
});

test("module du catalogue : mise à jour quand le catalogue publie une version, désinstallation complète", async () => {
  await cat.add("demo-banner", { manifest: { version: "1.0.0" } });
  await installFromCatalogue("demo-banner");
  assert.equal((await checkForUpdate("demo-banner")).available, false, "à jour au départ");
  await cat.add("demo-banner", { manifest: { version: "1.1.0" }, marker: "v2" });
  const check = await checkForUpdate("demo-banner");
  assert.deepEqual([check.available, check.target], [true, "1.1.0"]);
  assert.equal((await updateModule("demo-banner")).ok, true);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "demo-banner" } })).version, "1.1.0");
  assert.equal((await checkForUpdate("demo-banner")).available, false);
  await uninstallModule("demo-banner", { keepData: false });
  assert.equal(await db.prisma.module.findUnique({ where: { id: "demo-banner" } }), null);
  assert.ok(!fs.existsSync(path.join(MODULES_DIR, "demo-banner")));
});

test("origine d'un module : catalogue (dépôt reconnu à l'adresse annoncée), ou personnel non vérifié", async () => {
  await cat.fixtures(["demo-planner"]);
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const market = await M.getCatalogue({ fetchImpl: indexOf([{ id: "tiers", name: "T", description: "", repo: "https://github.com/x/tiers" }]) });
  const o = (row) => M.moduleOrigin(row, market);
  assert.equal(o({ id: "demo-planner", source: "git", repoUrl: cat.https, subdir: "modules/demo-planner" }), "catalogue");
  assert.equal(o({ id: "demo-planner", source: "bundled", repoUrl: null }), "catalogue", "compatibilité sites anciens : une ligne `bundled` d'un module que le catalogue liste");
  assert.equal(o({ id: "tiers", source: "git", repoUrl: "https://github.com/x/tiers.git" }), "catalogue", "même dépôt, .git ignoré");
  assert.equal(o({ id: "tiers", source: "git", repoUrl: "https://github.com/pirate/tiers" }), "custom", "même identifiant mais AUTRE dépôt : non vérifié");
  assert.equal(o({ id: "perso", source: "git", repoUrl: "https://github.com/moi/perso" }), "custom");
  assert.equal(o({ id: "demo-planner", source: "git", repoUrl: "https://github.com/pirate/planning" }), "custom", "un clone qui usurpe un module du catalogue reste personnel");
});

test("dépôt personnel : installable (non vérifié) ; un dépôt reconnu ne peut pas servir un autre module que celui annoncé", async () => {
  const repo = makeRepo({ "module.json": base({ id: "perso" }) });
  assert.equal((await installModule(repo.url, { expectId: "attendu" })).error, "modules.error.idmismatch");
  assert.equal(await db.prisma.module.findUnique({ where: { id: "perso" } }), null, "rien d'installé");
  assert.deepEqual(await installModule(repo.url, { expectId: "perso" }), { ok: true, id: "perso" });
});

test("installation depuis le catalogue : inconnu, incompatible → refus ; listé → installé", async () => {
  await cat.fixtures(["demo-sponsors"]);
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const realFetch = globalThis.fetch;
  globalThis.fetch = indexOf([{ id: "ancien", name: "A", description: "", repo: "https://github.com/x/ancien", apiVersion: 1 }]);
  try {
    assert.equal((await installFromCatalogue("nexiste-pas")).error, "modules.error.notfound");
    assert.equal((await installFromCatalogue("ancien")).error, "modules.error.incompatible");
    assert.deepEqual(await installFromCatalogue("demo-sponsors"), { ok: true, id: "demo-sponsors" });
  } finally { globalThis.fetch = realFetch; }
});
