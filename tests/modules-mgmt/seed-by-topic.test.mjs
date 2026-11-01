import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Semer une instance quand le module cible n'est relié au semeur que par un SUJET (le semeur `consumes` ce que la cible `provides`), sans `requires` :
// le semeur fonctionne sans la cible (lien souple), mais sa migration peut quand même reprendre l'adresse qu'il gardait dans une instance de la cible.
// Cas réel : le Planning (affiche les streams de n'importe quel agenda) qui garde l'adresse de son calendrier, reprise par « Agenda en ligne ».
const db = await useTestDb();
const cat = createCatalogue();
const I = await import("@/core/modules/installer");
const D = await import("@/core/modules/dataMigrations");
const R = await import("@/core/modules/registry");
const Auto = await import("@/core/modules/autoInstalled");
const Rec = await import("@/core/modules/recognized");
const { parseManifest } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");

const fresh = async () => { await db.reset(); await cat.clear(); Rec.clearRecognizedCache(); await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); };
beforeEach(fresh);
after(() => { cat.close(); return db.close(); });

const TOPIC = "planning.slot";
const URL1 = "https://calendar.example/private-TOKEN/basic.ics";

const agendaManifest = (over = {}) => ({
  apiVersion: 2, id: "agenda", name: "Agenda", version: "1.0.0", main: "index.mjs", provides: [{ topic: TOPIC }],
  settings: [{ key: "url", type: "secret", label: "Adresse" }, { key: "timezone", type: "text", label: "Fuseau", optional: true }], ...over,
});
const planManifest = (version, withSeeds, over = {}) => ({
  apiVersion: 2, id: "plan", name: "Plan", version, main: "index.mjs",
  settings: [{ key: "icsUrl", type: "secret", label: "Adresse", optional: true }, { key: "title", type: "text", label: "Titre" }],
  consumes: [{ topic: TOPIC, label: "Streams", schema: [{ key: "title", type: "string", required: true }, { key: "start", type: "datetime", required: true }] }],
  ...(withSeeds ? { dataVersion: 2, seeds: [{ module: "agenda", reason: { fr: "Reprendre l'adresse", en: "Carry the address over" } }] } : {}), ...over,
});
const MIGRATION = `export default { migrations: { 2: async (ctx) => {
  const url = ctx.setting("icsUrl"); if (!url) return;
  await ctx.seedInstance("agenda", { nickname: "Agenda en ligne", seedKey: "ics", settings: { url, timezone: "UTC" } });
  await ctx.clearSetting("icsUrl");
} } };`;

async function setupPlan({ over = {}, migration = MIGRATION } = {}) {
  const repo = makeRepo({ "module.json": planManifest("1.0.0", false), "index.mjs": "export default {};" });
  repo.g("tag", "v1.0.0");
  assert.equal((await I.installModule(`${repo.url}#v1.0.0`, { dependencies: false })).ok, true);
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("plan")).manifest, names: { fr: "Plan" } });
  await setSetting(`instance.${inst.id}.icsUrl`, URL1);
  await setSetting(`instance.${inst.id}.title`, "Mon planning");
  fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(planManifest("2.0.0", true, over)));
  fs.writeFileSync(path.join(repo.dir, "index.mjs"), migration);
  repo.g("commit", "-qam", "release 2.0.0"); repo.g("tag", "v2.0.0");
  return { inst, update: () => I.updateModule("plan") };
}
const agendaInstances = () => db.prisma.moduleInstance.findMany({ where: { moduleId: "agenda" } });
const sv = (id, key) => getSetting(`instance.${id}.${key}`);

test("manifeste : seeds accepté avec `consumes` seul ; refusé sans `requires` ni `consumes`", () => {
  const m = (over) => parseManifest({ apiVersion: 2, id: "plan", name: "P", version: "1.0.0", seeds: [{ module: "agenda", reason: "r" }], ...over });
  assert.equal(m({ consumes: [{ topic: TOPIC, label: "x" }] }).ok, true, "lien souple : un sujet consommé suffit");
  assert.equal(m({ requires: [{ service: "calendar.source" }] }).ok, true, "la dépendance reste possible");
  assert.equal(m({}).ok, false, "sans lien, aucune cible possible");
});

test("cible déjà installée et fournisseuse du sujet consommé : instance semée, ancien réglage effacé, rien n'est dit « installé automatiquement »", async () => {
  const repo = makeRepo({ "module.json": agendaManifest(), "index.mjs": "export default {};" });
  assert.equal((await I.installModule(repo.url)).ok, true);
  const { inst, update } = await setupPlan();
  const result = await update();
  assert.equal(result.ok, true);
  assert.deepEqual(result.migrations.map((x) => [x.status, x.error]), [["ok", undefined]]);
  const [seeded] = await agendaInstances();
  assert.equal(await sv(seeded.id, "url"), URL1);
  assert.equal(await sv(seeded.id, "timezone"), "UTC");
  assert.equal(await sv(inst.id, "icsUrl"), undefined, "l'ancien réglage est effacé");
  assert.equal(await sv(inst.id, "title"), "Mon planning");
  assert.deepEqual(await Auto.readAuto(), {}, "le module cible n'est pas une dépendance : aucune marque, aucun nettoyage proposé");
});

test("cible absente : installée depuis le catalogue SANS instance par défaut, instance semée seule, jamais proposée au nettoyage", async () => {
  await cat.add("agenda", { manifest: agendaManifest(), entry: { provides: [TOPIC] } });
  const { inst, update } = await setupPlan();
  const result = await update();
  assert.equal(result.ok, true);
  assert.deepEqual(result.migrations.map((x) => [x.status, x.error]), [["ok", undefined]]);
  assert.ok(await R.getModule("agenda"), "le module cible a été installé");
  const list = await agendaInstances();
  assert.equal(list.length, 1, "une seule instance : celle qui porte l'adresse reprise");
  assert.equal(await sv(list[0].id, "url"), URL1);
  assert.equal(await sv(inst.id, "icsUrl"), undefined);
  assert.deepEqual(await Auto.readAuto(), {}, "pas de marque « installé automatiquement » pour un lien souple");
  assert.deepEqual(await Auto.cleanupSuggestions(), [], "et donc aucun nettoyage proposé");
});

test("rejouer la migration ne crée aucun doublon (graine déjà semée)", async () => {
  await cat.add("agenda", { manifest: agendaManifest(), entry: { provides: [TOPIC] } });
  const { inst, update } = await setupPlan();
  assert.equal((await update()).ok, true);
  await setSetting(`instance.${inst.id}.icsUrl`, URL1);              // l'ancien réglage « revient » (sauvegarde restaurée, par exemple)
  await setSetting(`instance.${inst.id}.__dataVersion`, 1);
  await D.migrateModuleInstances("plan");
  assert.equal((await agendaInstances()).length, 1, "toujours une seule instance");
  assert.equal(await sv(inst.id, "icsUrl"), undefined);
});

test("cible qui ne fournit pas le sujet consommé (ni service requis) : refus, la migration échoue et RIEN n'est effacé ni créé", async () => {
  await cat.add("agenda", { manifest: agendaManifest({ provides: [{ topic: "autre.sujet" }] }), entry: { provides: ["autre.sujet"] } });
  const { inst, update } = await setupPlan();
  const log = console.error; console.error = () => {};
  let result; try { result = await update(); } finally { console.error = log; }
  assert.equal(result.migrations[0].status, "failed");
  assert.match(result.migrations[0].error, /does not require any service .* and consumes no topic it provides/);
  assert.equal(await sv(inst.id, "icsUrl"), URL1, "l'adresse est toujours là");
  assert.equal(await R.getModule("agenda"), null, "rien n'a été installé pour rien");
});

test("l'index qui se trompe : le manifeste réel de la cible tranche, tout est défait", async () => {
  await cat.add("agenda", { manifest: agendaManifest({ provides: [{ topic: "autre.sujet" }] }), entry: { provides: [TOPIC] } });
  const { inst, update } = await setupPlan();
  const log = console.error; console.error = () => {};
  let result; try { result = await update(); } finally { console.error = log; }
  assert.equal(result.migrations[0].status, "failed");
  assert.equal(await sv(inst.id, "icsUrl"), URL1);
  assert.equal(await R.getModule("agenda"), null, "le module installé pour l'occasion est retiré");
});
