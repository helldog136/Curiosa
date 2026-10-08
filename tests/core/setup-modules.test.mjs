import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const M = await import("@/core/modules/catalogue");
const S = await import("@/core/modules/starter");
const fixtures = path.resolve("tests/fixtures/extras");

beforeEach(() => { process.env.CURIOSA_EXTRAS_DIR = fixtures; });
after(() => db.close());

const mod = (root, id, over = {}) => {
  fs.mkdirSync(path.join(root, "modules", id), { recursive: true });
  fs.writeFileSync(path.join(root, "modules", id, "module.json"), JSON.stringify({ apiVersion: 2, id, name: id, version: "1.0.0", ...over }));
};

test("modules suggérés : une liste du dépôt de modules ; ils sont marqués dans le Catalogue et seuls proposés à l'assistant", () => {
  const by = Object.fromEntries(M.listBundled().map((e) => [e.id, e.suggested]));
  assert.deepEqual([by.blog, by.links, by.pages, by.collection, by["demo-planner"]], [true, true, true, false, false]);
  assert.deepEqual(S.setupModules().map((m) => m.id).sort(), ["blog", "links", "pages"]);
});

test("un module ne peut pas se suggérer lui-même : se déclarer « de départ » ou « d'office » dans son manifeste ne change rien", () => {
  const root = fs.mkdtempSync(path.join(db.dir, "extras-"));
  mod(root, "malin", { starter: true, onboarding: { always: true, preselected: true, home: { section: "latest" } } });
  mod(root, "honnete");
  fs.mkdirSync(path.join(root, "catalogue"), { recursive: true });
  fs.writeFileSync(path.join(root, "catalogue", "suggested.json"), JSON.stringify(["honnete", "pas un id valide !", 42]));
  process.env.CURIOSA_EXTRAS_DIR = root;
  assert.deepEqual([...M.suggestedModuleIds(root)], ["honnete"], "identifiants invalides écartés");
  assert.deepEqual(M.listBundled(root).map((e) => [e.id, e.suggested]), [["honnete", true], ["malin", false]]);
  assert.deepEqual(S.setupModules().map((m) => m.id), ["honnete"]);
  assert.equal(M.suggestedModuleIds(path.join(root, "absent")).size, 0, "sans liste : rien n'est suggéré");
  assert.ok(!("starter" in M.readBundledManifest(path.join(root, "modules", "malin"))), "le champ n'existe plus dans le manifeste");
});

test("un module suggéré qui exige un autre module n'est pas proposé à l'assistant (il s'ajoute depuis le Catalogue)", () => {
  const root = fs.mkdtempSync(path.join(db.dir, "extras-"));
  mod(root, "seul"); mod(root, "dependant", { requires: [{ service: "x.y", label: "X" }] });
  fs.mkdirSync(path.join(root, "catalogue"), { recursive: true });
  fs.writeFileSync(path.join(root, "catalogue", "suggested.json"), JSON.stringify(["seul", "dependant"]));
  process.env.CURIOSA_EXTRAS_DIR = root;
  assert.deepEqual(S.setupModules().map((m) => m.id), ["seul"]);
});

test("assistant : étape facultative qui dit qu'on peut la passer sans risque ; seuls les modules proposés et cochés sont installés", () => {
  const wizard = fs.readFileSync("src/app/admin/(auth)/setup/SetupWizard.tsx", "utf8");
  assert.match(wizard, /data-step|section\("modules"\)/);
  assert.match(wizard, /setup\.modules\.skip"/);
  assert.match(wizard, /setup\.modules\.skipButton/);
  assert.ok(!/preselected/.test(wizard), "rien n'est coché d'avance");
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  assert.match(fr["setup.modules.skip"], /passer cette étape sans aucun risque/);
  const actions = fs.readFileSync("src/app/admin/(auth)/setup/actions.ts", "utf8");
  assert.match(actions, /setupModules\(\)\.filter\(\(m\) => presetIds\.includes\(m\.id\)\)/, "une valeur envoyée à la main n'ajoute aucun module");
  assert.ok(!/onboarding\?\.always|\.starter/.test(actions), "plus de module créé d'office ni de drapeau déclaré par le module");
});
