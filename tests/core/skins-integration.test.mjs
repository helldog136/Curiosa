// Intégration des lots S1 (rendu), S4 (pièces de modules) et S5 (installation) : le skin que le site public applique est le skin INSTALLÉ, contrôlé et
// assaini par `validate.ts`, relu avec les pièces des modules installés ; chaque changement (installation, mise à jour, retrait, module) invalide les feuilles.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const S = await import("@/core/skins/service");
const { activeSkin } = await import("@/core/skins/render");
const { skinCacheGeneration } = await import("@/core/skins/invalidate");
const { invalidateModuleSkinLayer } = await import("@/core/skins/moduleParts");
const { setSetting } = await import("@/core/settings");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");
const url = (id, version = "1.0.0") => `${cat.url}#${id}-v${version}:skins/${id}`;
const CSS = '[data-skin-part="demo.card"]{border-width:2px}\n[data-skin-part="card"]{border-width:1px}';

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.setServiceHooksForTests({});
  S.clearSkinCaches();
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
});
after(() => { db.close(); cat.close(); });

test("rendu : sans skin choisi c'est basic ; un skin installé et activé est appliqué, avec les pièces des modules installés seulement", async () => {
  assert.equal((await activeSkin()).skin.id, "basic");
  await cat.publish("pilot-skin", { files: { "skin.css": CSS } });
  const r = await S.install(url("pilot-skin"), { confirmPersonal: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await activeSkin()).skin.id, "basic", "installé mais pas encore choisi : basic");
  await setSetting("skin.active", "pilot-skin");
  const withModule = await activeSkin({ demo: ["card"] });
  assert.equal(withModule.skin.id, "pilot-skin");
  assert.ok(withModule.skin.css.includes("demo.card") && withModule.skin.css.includes('[data-skin-part="card"]'));
  const without = await activeSkin({}); 
  assert.ok(!without.skin.css.includes("demo.card"), "module absent : la règle est retirée de la feuille rendue");
  console.log(JSON.stringify(without.skin.css));assert.ok(without.skin.css.includes(`[data-skin-part="card"]`), "le reste du skin reste appliqué");
  assert.notEqual(without.serial, "basic");
  // le fichier installé, lui, n'a pas changé
  const onDisk = fs.readFileSync(path.join(SKINS, "pilot-skin", "1.0.0", "skin.css"), "utf8");
  assert.ok(onDisk.includes("demo.card"));
  assert.equal((await activeSkin({ demo: ["card"] })).serial, withModule.serial, "mêmes fichiers, mêmes pièces : même clé");
});

test("rendu : un skin dont les fichiers ont changé depuis l'installation n'est pas appliqué (basic) ; il revient à la réinstallation", async () => {
  await cat.publish("pilot-skin", { files: { "skin.css": CSS } });
  assert.equal((await S.install(url("pilot-skin"), { confirmPersonal: true })).ok, true);
  await setSetting("skin.active", "pilot-skin");
  assert.equal((await activeSkin()).skin.id, "pilot-skin");
  fs.appendFileSync(path.join(SKINS, "pilot-skin", "1.0.0", "skin.css"), "\n[data-skin-part=\"button\"]{border-width:3px}");
  S.clearSkinCaches();
  assert.equal((await activeSkin()).skin.id, "basic", "contenu modifié : repli sur basic");
  const re = await S.reinstall("pilot-skin"); assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal((await activeSkin()).skin.id, "pilot-skin");
});

test("invalidation : installation, mise à jour, retrait d'un skin et d'un module changent le numéro de génération", async () => {
  let g = skinCacheGeneration();
  const moved = () => { const n = skinCacheGeneration(); const r = n !== g; g = n; return r; };
  await cat.publish("pilot-skin", { files: { "skin.css": CSS } });
  const first = await S.installFromCatalogue("pilot-skin"); assert.equal(first.ok, true, JSON.stringify(first));
  assert.ok(moved(), "installation");
  await setSetting("skin.active", "pilot-skin");
  await cat.publish("pilot-skin", { version: "1.1.0", files: { "skin.css": CSS } });
  await S.listCatalogue({ fresh: true });
  const up = await S.update("pilot-skin"); assert.equal(up.ok, true, JSON.stringify(up));
  assert.ok(moved(), "mise à jour");
  assert.equal((await activeSkin()).skin.version, "1.1.0");
  assert.equal((await S.remove("pilot-skin")).ok, true);
  assert.ok(moved(), "retrait");
  assert.equal((await activeSkin()).skin.id, "basic");
  invalidateModuleSkinLayer();
  assert.ok(moved(), "installation ou retrait d'un module");
});
