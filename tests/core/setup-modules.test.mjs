import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Le cœur ne contient aucun module : l'assistant propose ceux que le catalogue SUGGÈRE (liste du dépôt de modules, lue sur le réseau) et les installe depuis le catalogue.
const db = await useTestDb();
const cat = createCatalogue();
const M = await import("@/core/modules/catalogue");
const S = await import("@/core/modules/starter");
const R = await import("@/core/modules/registry");

beforeEach(async () => { await db.reset(); await cat.clear(); });
after(() => { cat.close(); return db.close(); });

const ids = async () => (await S.setupModules()).modules.map((m) => m.id).sort();

test("modules suggérés : une liste du dépôt du catalogue ; ils sont marqués dans le Catalogue et seuls proposés à l'assistant", async () => {
  await cat.fixtures(["blog", "links", "pages", "collection", "demo-planner"], { suggested: JSON.parse(fs.readFileSync("tests/fixtures/extras/catalogue/suggested.json", "utf8")) });
  const by = Object.fromEntries((await M.getCatalogue()).map((e) => [e.id, e.suggested]));
  assert.deepEqual([by.blog, by.links, by.pages, by.collection, by["demo-planner"]], [true, true, true, false, false]);
  assert.deepEqual(await ids(), ["blog", "links", "pages"]);
  assert.equal((await S.setupModules()).unreachable, false);
});

test("un module ne peut pas se suggérer lui-même : se déclarer « de départ » ou « d'office » dans son manifeste ne change rien", async () => {
  await cat.add("malin", { manifest: { starter: true, onboarding: { always: true, preselected: true, home: { section: "latest" } } } });
  await cat.add("honnete");
  await cat.suggest(["honnete", "pas un id valide !", 42]);
  assert.deepEqual((await M.getCatalogue()).map((e) => [e.id, e.suggested]).sort(), [["honnete", true], ["malin", false]]);
  assert.deepEqual(await ids(), ["honnete"]);
});

test("un module suggéré qui exige un autre module n'est pas proposé à l'assistant (il s'ajoute depuis le Catalogue) ; un incompatible non plus", async () => {
  await cat.add("seul"); await cat.add("dependant", { entry: { requires: [{ service: "x.y", label: "X" }] } }); await cat.add("ancien", { entry: { apiVersion: 1 } });
  await cat.suggest(["seul", "dependant", "ancien"]);
  assert.deepEqual(await ids(), ["seul"]);
});

test("l'assistant lit le manifeste de chaque module suggéré SANS l'installer : c'est lui, pas le cœur, qui dit s'il collecte des liens", async () => {
  await cat.add("liens", { manifest: { onboarding: { collectsLinks: true } } }); await cat.add("blog2");
  await cat.suggest(["liens", "blog2"]);
  const by = Object.fromEntries((await S.setupModules()).modules.map((m) => [m.id, m.collectsLinks]));
  assert.deepEqual(by, { liens: true, blog2: false });
  assert.equal(await db.prisma.module.count(), 0, "rien n'est installé pour autant");
});

test("installation des modules cochés : depuis le catalogue (git, étiquette épinglée), activés ; un choix hors liste n'ajoute rien", async () => {
  await cat.add("blog"); await cat.add("pages"); await cat.add("cache");
  await cat.suggest(["blog", "pages"]);
  const r = await S.installChosenModules(["blog", "pages", "cache"]);
  assert.deepEqual(r.installed.map((m) => m.id).sort(), ["blog", "pages"]);
  assert.deepEqual(r.failed, ["cache"], "« cache » n'est pas suggéré : jamais installé, mais signalé");
  const row = await db.prisma.module.findUnique({ where: { id: "blog" } });
  assert.deepEqual([row.source, row.enabled, row.repoUrl, row.ref, row.subdir], ["git", true, cat.https, "blog-v1.0.0", "modules/blog"]);
  assert.equal(await db.prisma.module.findUnique({ where: { id: "cache" } }), null);
  assert.ok((await R.getInstalledModules()).some((m) => m.manifest.id === "pages"));
});

test("assistant sans réseau : aucun module proposé (message dédié), rien n'est installé, aucune copie locale — l'installation du site peut se terminer", async () => {
  await cat.add("blog"); await cat.suggest(["blog"]);
  await cat.down({ forget: true });
  const offer = await S.setupModules();
  assert.deepEqual([offer.modules.length, offer.unreachable], [0, true]);
  const r = await S.installChosenModules(["blog"]);
  assert.deepEqual([r.installed.length, r.failed], [0, ["blog"]]);
  assert.equal(await db.prisma.module.count(), 0);
  assert.equal(await S.provisionModule("blog"), false);
  assert.ok(!fs.existsSync(`${process.env.DATA_DIR}/modules/blog`), "aucun dossier copié");
  await cat.up();
  assert.deepEqual(await ids(), ["blog"], "dès que le catalogue revient, il est proposé");
});

test("assistant : étape facultative qui dit qu'on peut la passer sans risque ; seuls les modules proposés et cochés sont installés ; sans catalogue, un message simple et le tableau de bord le redit", () => {
  const wizard = fs.readFileSync("src/app/admin/(auth)/setup/SetupWizard.tsx", "utf8");
  assert.match(wizard, /data-step|section\("modules"\)/);
  assert.match(wizard, /setup\.modules\.skip"/);
  assert.match(wizard, /setup\.modules\.skipButton/);
  assert.match(wizard, /setup\.modules\.unreachable/);
  assert.ok(!/preselected/.test(wizard), "rien n'est coché d'avance");
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  assert.match(fr["setup.modules.skip"], /passer cette étape sans aucun risque/);
  assert.equal(fr["dashboard.modulesFailed"], "Aucun module n'a pu être installé (catalogue injoignable) : installez-les plus tard depuis Modules › Catalogue.");
  const actions = fs.readFileSync("src/app/admin/(auth)/setup/actions.ts", "utf8");
  assert.match(actions, /installChosenModules\(presetIds\)/, "une valeur envoyée à la main n'ajoute aucun module : seuls les suggérés sont installés");
  assert.match(actions, /modules=failed/, "le site se crée même si le catalogue est injoignable, et le tableau de bord le dit");
  assert.ok(!/onboarding\?\.always|\.starter/.test(actions), "plus de module créé d'office ni de drapeau déclaré par le module");
  assert.ok(!/copyBundled|provisionBundled|offline/.test(actions), "aucune copie locale");
});
