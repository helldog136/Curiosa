// Retrait du code hérité déjà migré (version minimale de mise à jour 0.2.0) : tests de non-régression.
//   - un site à jour passe la mise à niveau sans que rien ne change ;
//   - le démarrage d'un site propre pose le marqueur ;
//   - une sauvegarde récente se restaure comme avant ;
//   - la version minimale de mise à jour fait passer un site plus ancien par la 0.2.0, et laisse un site récent directement.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb, settleBackground } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
const S = await import("@/core/modules/legacySweep");
const Rp = await import("@/core/modules/legacyReport");
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");
const { planUpdate } = await import("../../scripts/update-lib.mjs");

const prisma = db.prisma;
const silent = { log: () => {} };
const PW = "un-mot-de-passe-solide";
beforeEach(async () => { await db.reset(); await cat.clear(); R.resetModuleRegistry(); });
after(() => { cat.close(); return db.close(); });

/** Tout ce qu'un site à jour contient, dans un ordre stable (hors dates de modification que rien ne doit changer non plus). */
async function snapshot() {
  const dump = async (rows) => JSON.parse(JSON.stringify(await rows));
  return {
    modules: await dump(prisma.module.findMany({ orderBy: { id: "asc" } })),
    instances: await dump(prisma.moduleInstance.findMany({ orderBy: { id: "asc" } })),
    settings: await dump(prisma.setting.findMany({ orderBy: [{ key: "asc" }, { locale: "asc" }] })),
    records: await dump(prisma.moduleRecord.findMany({ orderBy: { id: "asc" } })),
    audit: await dump(prisma.auditLog.findMany({ orderBy: { id: "asc" } })),
    retired: await dump(prisma.retiredInstance.findMany({ orderBy: { id: "asc" } })),
  };
}

/** Un site à jour : un module du catalogue installé, une instance, un réglage, une donnée. */
async function currentSite() {
  await cat.add("carnet", { manifest: { version: "1.0.0" }, marker: "v1" });
  assert.equal((await I.installFromCatalogue("carnet")).ok, true);
  const inst = await createInstance(prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "Carnet", names: { fr: "Carnet" } });
  await setSetting(`instance.${inst.id}.titre`, "Mon carnet");
  await prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "items", data: JSON.stringify({ t: "x" }) } });
  return inst;
}

test("mise à niveau d'un site à jour : le démarrage ne change rien (ni module, ni instance, ni réglage, ni donnée, ni journal), et le marqueur garde sa date", async () => {
  await currentSite();
  const first = await S.runLegacySweep(silent);
  assert.equal(first.done, true);
  const marker = await Rp.readLegacyMarker();
  assert.ok(marker);
  const before = await snapshot();
  const again = await S.runLegacySweep(silent);
  assert.deepEqual([again.done, again.timedOut, again.counts], [true, false, { migrated: 0, setAside: 0, emptied: 0 }]);
  assert.deepEqual(await snapshot(), before, "rien n'a bougé");
  assert.deepEqual(await Rp.readLegacyMarker(), marker, "le marqueur garde la date de la fin de la conversion");
  const report = await Rp.legacyReport();
  assert.deepEqual([report.converted, report.totals.sourceRows, report.totals.behind, report.totals.failed], [true, 0, 0, 0]);
});

test("démarrage normal d'un site propre : le balayage finit tout de suite, pose le marqueur, journalise une ligne sans valeur", async () => {
  const lines = [];
  const r = await S.runLegacySweep({ log: (l) => lines.push(l) });
  assert.deepEqual([r.done, r.timedOut, r.busy], [true, false, undefined]);
  assert.deepEqual(r.counts, { migrated: 0, setAside: 0, emptied: 0 });
  const marker = await Rp.readLegacyMarker();
  assert.equal(marker.version, JSON.parse(fs.readFileSync("package.json", "utf8")).version);
  assert.equal(await Rp.legacyConversionPending(), false, "pas de bandeau");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /complete/);
  assert.equal((await prisma.module.count()) + (await prisma.moduleInstance.count()), 0);
});

test("restauration d'une sauvegarde récente : le module, son instance, ses réglages et ses données reviennent ; rien n'est rangé ni converti", async () => {
  const inst = await currentSite();
  await prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash-du-proprietaire", locale: "fr" } });
  const b = await B.createBackup(PW, { iterations: 1000 });
  await prisma.moduleRecord.deleteMany({});
  await setSetting(`instance.${inst.id}.titre`, "Autre titre");
  const opened = Rs.openBackup(b.buffer, PW, 1000);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  await settleBackground();
  assert.equal((await prisma.module.findUnique({ where: { id: "carnet" } })).source, "git");
  assert.equal(await prisma.moduleInstance.count({ where: { moduleId: "carnet" } }), 1);
  assert.equal(await getSetting(`instance.${inst.id}.titre`), "Mon carnet");
  assert.equal(await prisma.moduleRecord.count({ where: { instanceId: inst.id } }), 1);
  assert.equal((await prisma.retiredInstance.count()), 0, "rien n'est rangé");
  assert.equal((await S.runLegacySweep(silent)).done, true, "et le site démarre proprement après la restauration");
});

test("outil MCP maintenance_legacy : répond toujours, avec tous ses champs (les champs « éteints » restent, vides) ; il n'expose ni valeur ni adresse", async () => {
  await S.runLegacySweep(silent);
  const data = await Rp.legacyReportForAssistant();
  assert.equal(data.conversionFinished, true);
  for (const k of ["conversionFinished", "totals", "oldModuleRows", "oldModulesKeptAsTheyAre", "switchedOff", "instancesBehind", "instancesSetAside", "instancesNewerThanModule", "takeoverNotDone", "collectionsToEmpty", "keptSettingsWithValue", "unknownSettings", "upkeep"]) assert.ok(k in data, k);
  assert.deepEqual(data.switchedOff, { modules: [], instances: [] });
  for (const k of ["sourceRows", "keptRows", "switchedOffModules", "switchedOffInstances", "behind", "failed", "newer", "seedsMissing", "collections", "legacyValues", "orphans"]) assert.equal(typeof data.totals[k], "number", `totals.${k}`);
  assert.equal(data.upkeep.state, "up_to_date");
  // Une ligne restée d'une des premières versions : elle est dite « à faire », avec son nom et sa version, jamais autre chose.
  await prisma.module.create({ data: { id: "vieux", source: "bundled", version: "0.1.0", enabled: true } });
  const withRow = await Rp.legacyReportForAssistant();
  assert.deepEqual(withRow.oldModuleRows.map((r) => [r.id, r.source, r.version]), [["vieux", "bundled", "0.1.0"]]);
  assert.equal(withRow.upkeep.state, "to_do");
  assert.ok(withRow.upkeep.toDo.some((x) => x.what === "absent" && x.names.includes("vieux")));
  assert.doesNotMatch(JSON.stringify(withRow), /https?:|github/);
});

test("support floor: upgrade.json requires the 0.6.10 bridge; an older site is carried through every published bridge in order, a recent one updates directly", async () => {
  const minFrom = JSON.parse(fs.readFileSync("upgrade.json", "utf8")).minFrom;
  assert.equal(minFrom, "0.6.10");
  // upgrade.json of the published bridges, as GitHub serves them (checked against the real releases): 0.6.10 -> 0.2.0, 0.2.0 -> 0.1.4, 0.1.4 has none.
  const files = { "v9.9.9": { minFrom }, "v0.6.10": { minFrom: "0.2.0" }, "v0.2.0": { minFrom: "0.1.4" } };
  const fetchText = async (url) => {
    const m = /\/download\/(v[^/]+)\/upgrade\.json$/.exec(url);
    return m && files[m[1]] ? JSON.stringify(files[m[1]]) : null;
  };
  const plan = (current) => planUpdate({ current, target: "v9.9.9", repo: "o/curiosa", fetchText });
  assert.deepEqual(await plan("0.6.10"), ["v9.9.9"], "site on the bridge: direct");
  assert.deepEqual(await plan("0.7.2"), ["v9.9.9"], "newer site: direct");
  assert.deepEqual(await plan("0.6.3"), ["v0.6.10", "v9.9.9"], "older site: two steps");
  assert.deepEqual(await plan("0.2.0"), ["v0.6.10", "v9.9.9"], "0.2.0: two steps (the first start of 0.6.10 runs the old conversions)");
  assert.deepEqual(await plan("0.1.28"), ["v0.2.0", "v0.6.10", "v9.9.9"], "before 0.2.0: three steps");
  assert.deepEqual(await plan("0.1.1"), ["v0.1.4", "v0.2.0", "v0.6.10", "v9.9.9"], "oldest published release (v0.1.1): four steps, within the limit of six");
});
