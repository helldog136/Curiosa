import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const M = await import("@/core/modules/catalogue");
const { installBundled, installFromCatalogue, installModule, uninstallModule, updateModule, checkForUpdate, setModuleEnabled } = await import("@/core/modules/installer");
const { clearRecognizedCache } = await import("@/core/modules/recognized");
const R = await import("@/core/modules/registry");
const { MODULES_DIR } = await import("@/core/config");

beforeEach(async () => { await db.reset(); clearRecognizedCache(); delete process.env.MODULES_INDEX_URL; });
after(() => db.close());

const base = (over) => ({ apiVersion: 2, version: "1.0.0", name: "Demo", ...over });
const indexOf = (items) => async () => Response.json(items);

test("livrés avec le framework : modules communautaires et exemples, manifestes valides, libellés fournis", () => {
  const list = M.listBundled();
  const ids = list.map((e) => e.id);
  for (const id of ["demo-planner", "demo-sponsors", "demo-banner"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  for (const e of list) {
    assert.deepEqual([e.source, e.compatible], ["bundled", true]);
    assert.ok(e.name && e.description && e.version && fs.existsSync(path.join(e.dir, "module.json")), e.id);
  }
  assert.equal(list.find((e) => e.id === "demo-banner").kind, "example");
  assert.equal(list.find((e) => e.id === "demo-planner").kind, "community");
});

test("livrés : un module au manifeste invalide ou sans manifeste n'est pas proposé", () => {
  const root = fs.mkdtempSync(path.join(db.dir, "root-"));
  fs.mkdirSync(path.join(root, "modules", "bon"), { recursive: true });
  fs.writeFileSync(path.join(root, "modules", "bon", "module.json"), JSON.stringify(base({ id: "bon" })));
  fs.mkdirSync(path.join(root, "modules", "casse"), { recursive: true });
  fs.writeFileSync(path.join(root, "modules", "casse", "module.json"), "{pas du json");
  fs.mkdirSync(path.join(root, "modules", "vide"), { recursive: true });
  fs.writeFileSync(path.join(root, "modules", "fichier.txt"), "x");
  assert.deepEqual(M.listBundled(root).map((e) => e.id), ["bon"]);
  assert.deepEqual(M.listBundled(path.join(root, "absent")), []);
});

test("catalogue : livrés d'abord, puis dépôts reconnus de l'index ; un livré l'emporte sur un reconnu de même identifiant", async () => {
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const fetchImpl = indexOf([
    { id: "tiers-un", name: "Tiers", description: "d", repo: "https://github.com/x/tiers", version: "2.0.0" },
    { id: "demo-planner", name: "Faux planning", description: "d", repo: "https://github.com/x/planning" },
    { id: "ancien", name: "Ancien", description: "d", repo: "https://github.com/x/ancien", apiVersion: 1 },
  ]);
  const list = await M.getCatalogue({ fetchImpl });
  const by = Object.fromEntries(list.map((e) => [e.id, e]));
  assert.equal(by["demo-planner"].source, "bundled", "pas de doublon : le module livré gagne");
  assert.deepEqual([by["tiers-un"].source, by["tiers-un"].kind, by["tiers-un"].compatible, by["tiers-un"].repo], ["recognized", "recognized", true, "https://github.com/x/tiers"]);
  assert.equal(by.ancien.compatible, false, "autre version de l'API des modules : listé mais non installable");
  assert.ok(list.findIndex((e) => e.id === "demo-planner") < list.findIndex((e) => e.id === "tiers-un"));
});

test("index reconnu : entrées invalides écartées (identifiant, dépôt non https, hôte non autorisé, file://, doublons)", async () => {
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const fetchImpl = indexOf([
    { id: "Mauvais Id", repo: "https://github.com/x/a" }, { id: "http-seul", repo: "http://github.com/x/a" }, { id: "hote-inconnu", repo: "https://evil.example/x/a" },
    { id: "local", repo: "file:///tmp/x" }, { id: "credentials", repo: "https://u:p@github.com/x/a" }, { id: "ok", repo: "https://github.com/x/ok" }, { id: "ok", repo: "https://github.com/x/ok2" }, null, "texte",
  ]);
  const remote = (await M.getCatalogue({ fetchImpl })).filter((e) => e.source === "recognized");
  assert.deepEqual(remote.map((e) => e.id), ["ok"]);
  assert.equal(remote[0].repo, "https://github.com/x/ok", "premier de l'index conservé");
});

test("installation d'un module livré : copié du serveur, désactivé, sans git ni réseau", async () => {
  assert.deepEqual(await installBundled("demo-planner"), { ok: true, id: "demo-planner" });
  const row = await db.prisma.module.findUnique({ where: { id: "demo-planner" } });
  assert.deepEqual([row.source, row.enabled, row.repoUrl, row.commit], ["bundled", false, null, null]);
  assert.ok(fs.existsSync(path.join(MODULES_DIR, "demo-planner", "module.json")) && fs.existsSync(path.join(MODULES_DIR, "demo-planner", "index.mjs")));
  assert.ok(!fs.existsSync(path.join(MODULES_DIR, "demo-planner", ".git")));
  assert.deepEqual(await setModuleEnabled("demo-planner", true), { ok: true, id: "demo-planner" });
  assert.ok((await R.getEnabledModules()).some((m) => m.manifest.id === "demo-planner"), "il est chargé et actif");
});

test("installation d'un module livré : refus si déjà installé ou inconnu", async () => {
  await installBundled("demo-planner");
  assert.equal((await installBundled("demo-planner")).error, "modules.error.exists");
  assert.equal((await installBundled("inconnu")).error, "modules.error.notfound");
  assert.equal((await installBundled("../../etc")).error, "modules.error.notfound", "pas d'évasion de chemin");
});

test("module livré : mise à jour quand la version du framework change, désinstallation complète", async () => {
  await installBundled("demo-banner");
  assert.equal((await checkForUpdate("demo-banner")).available, false, "à jour au départ");
  await db.prisma.module.update({ where: { id: "demo-banner" }, data: { version: "0.0.1" } });
  assert.equal((await checkForUpdate("demo-banner")).available, true);
  assert.equal((await updateModule("demo-banner")).ok, true);
  assert.notEqual((await db.prisma.module.findUnique({ where: { id: "demo-banner" } })).version, "0.0.1");
  assert.equal((await checkForUpdate("demo-banner")).available, false);
  await uninstallModule("demo-banner");
  assert.equal(await db.prisma.module.findUnique({ where: { id: "demo-banner" } }), null);
  assert.ok(!fs.existsSync(path.join(MODULES_DIR, "demo-banner")));
});

test("origine d'un module : catalogue (livré ou dépôt reconnu à l'adresse annoncée), ou personnel non vérifié", async () => {
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const market = await M.getCatalogue({ fetchImpl: indexOf([{ id: "tiers", name: "T", description: "", repo: "https://github.com/x/tiers" }]) });
  const o = (row) => M.moduleOrigin(row, market);
  assert.equal(o({ id: "demo-planner", source: "bundled", repoUrl: null }), "catalogue");
  assert.equal(o({ id: "tiers", source: "git", repoUrl: "https://github.com/x/tiers.git" }), "catalogue", "même dépôt, .git ignoré");
  assert.equal(o({ id: "tiers", source: "git", repoUrl: "https://github.com/pirate/tiers" }), "custom", "même identifiant mais AUTRE dépôt : non vérifié");
  assert.equal(o({ id: "perso", source: "git", repoUrl: "https://github.com/moi/perso" }), "custom");
  assert.equal(o({ id: "demo-planner", source: "git", repoUrl: "https://github.com/pirate/planning" }), "custom", "un clone qui usurpe un module livré reste personnel");
});

test("dépôt personnel : installable (non vérifié) ; un dépôt reconnu ne peut pas servir un autre module que celui annoncé", async () => {
  const repo = makeRepo({ "module.json": base({ id: "perso" }) });
  assert.equal((await installModule(repo.url, { expectId: "attendu" })).error, "modules.error.idmismatch");
  assert.equal(await db.prisma.module.findUnique({ where: { id: "perso" } }), null, "rien d'installé");
  assert.deepEqual(await installModule(repo.url, { expectId: "perso" }), { ok: true, id: "perso" });
});

test("installation depuis le catalogue : inconnu, incompatible → refus ; livré → installé", async () => {
  process.env.MODULES_INDEX_URL = "https://index.example/modules.json";
  const realFetch = globalThis.fetch;
  globalThis.fetch = indexOf([{ id: "ancien", name: "A", description: "", repo: "https://github.com/x/ancien", apiVersion: 1 }]);
  try {
    assert.equal((await installFromCatalogue("nexiste-pas")).error, "modules.error.notfound");
    assert.equal((await installFromCatalogue("ancien")).error, "modules.error.incompatible");
    assert.deepEqual(await installFromCatalogue("demo-sponsors"), { ok: true, id: "demo-sponsors" });
  } finally { globalThis.fetch = realFetch; }
});

