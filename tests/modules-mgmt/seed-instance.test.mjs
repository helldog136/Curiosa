import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Semer une instance pendant une migration de données : un module « semeur » (plan) déplace son ancienne adresse vers une instance d'un module cible (agenda).
// Dépôts git locaux (makeRepo) pour le semeur et, selon le test, pour la cible ; faux catalogue (createCatalogue) quand la cible doit être installée par la cascade.
const db = await useTestDb();
const cat = createCatalogue();
const I = await import("@/core/modules/installer");
const D = await import("@/core/modules/dataMigrations");
const R = await import("@/core/modules/registry");
const Auto = await import("@/core/modules/autoInstalled");
const Rec = await import("@/core/modules/recognized");
const { buildContext } = await import("@/core/modules/context");
const { parseManifest } = await import("@/core/modules/manifest");
const { auditLabelKey } = await import("@/core/auditLabels");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");

const fresh = async () => { await db.reset(); await cat.clear(); Rec.clearRecognizedCache(); await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); };
beforeEach(fresh);
after(() => { cat.close(); return db.close(); });
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const SECRET = "tok-s3cret-VALUE";
const URL1 = "https://calendar.example/feed.ics";
const SVC = "calendar.source";

const agendaManifest = (over = {}) => ({
  apiVersion: 2, id: "agenda", name: "Agenda", version: "1.0.0", main: "index.mjs", offers: [{ service: SVC }],
  settings: [
    { key: "url", type: "url", label: "Adresse" }, { key: "token", type: "secret", label: "Jeton" },
    { key: "label", type: "text", label: "Libellé", translatable: true }, { key: "mode", type: "select", label: "Mode", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, { key: "count", type: "number", label: "Nombre" },
  ], ...over,
});
const planManifest = (version, dataVersion, over = {}) => ({
  apiVersion: 2, id: "plan", name: "Plan", version, main: "index.mjs",
  settings: [{ key: "icalUrl", type: "url", label: "Adresse iCal" }, { key: "icalToken", type: "secret", label: "Jeton" }, { key: "title", type: "text", label: "Titre" }],
  ...(dataVersion ? { dataVersion, requires: [{ service: SVC }], seeds: [{ module: "agenda", reason: { fr: "Reprendre votre adresse iCal", en: "Carry over your iCal address" } }] } : {}), ...over,
});
const STANDARD = `
  const url = ctx.setting("icalUrl"); if (!url) return;
  const r = await ctx.seedInstance("agenda", { nickname: "Agenda iCal", seedKey: "ical", settings: { url, token: ctx.setting("icalToken") } });
  if (ctx.setting("title") === "boom") throw new Error("boom");
  await ctx.clearSetting("icalUrl"); await ctx.clearSetting("icalToken");
  await ctx.api.store.add("log", { created: r.created, key: r.instanceKey });`;
const migration = (body) => `export default { migrations: { 2: async (ctx) => { ${body} } } };`;

/**
 * Installe plan avec une instance réglée « à l'ancienne ».
 *  - par défaut : plan 1.0.0 puis `update()` = la vraie mise à jour (migration PUIS cascade des dépendances, comme en production) ;
 *  - `direct: true` : plan 1.1.0 installé tel quel, données remises à la version 1, `update()` = la seule migration (aucune cascade après elle : on voit l'état exact laissé par un échec).
 */
async function setupPlan({ body = STANDARD, v2 = {}, enabled = true, direct = false, settings = { icalUrl: URL1, icalToken: SECRET, title: "Mon planning" } } = {}) {
  const manifestV2 = planManifest("1.1.0", 2, v2);
  const repo = makeRepo({ "module.json": direct ? manifestV2 : planManifest("1.0.0"), "index.mjs": direct ? migration(body) : "export default {};" });
  repo.g("tag", "v1.0.0");
  assert.equal((await I.installModule(`${repo.url}#v1.0.0`, { dependencies: false })).ok, true);
  if (enabled) await db.prisma.module.update({ where: { id: "plan" }, data: { enabled: true } });
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("plan")).manifest, names: { fr: "Plan" } });
  for (const [k, v] of Object.entries(settings)) await setSetting(`instance.${inst.id}.${k}`, v);
  if (direct) {
    await setSetting(`instance.${inst.id}.__dataVersion`, 1);
    return { inst, repo, update: async () => ({ ok: true, migrations: await D.migrateModuleInstances("plan") }) };
  }
  fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifestV2));
  fs.writeFileSync(path.join(repo.dir, "index.mjs"), migration(body));
  repo.g("commit", "-qam", "release 1.1.0"); repo.g("tag", "v1.1.0");
  return { inst, repo, update: () => I.updateModule("plan") };
}
async function installAgenda(over = {}, { enabled = true } = {}) {
  const repo = makeRepo({ "module.json": agendaManifest(over), "index.mjs": "export default {};" });
  assert.equal((await I.installModule(repo.url)).ok, true);
  if (enabled)  return repo;
}
const agendaInstances = () => db.prisma.moduleInstance.findMany({ where: { moduleId: "agenda" }, orderBy: { key: "asc" } });
const sv = (id, key) => getSetting(`instance.${id}.${key}`);
const audits = async () => db.prisma.auditLog.findMany({ where: { action: "module.seed" } });
const migrated = (r) => r.migrations.map((m) => [m.status, m.error]);

test("manifeste : seeds validé (cible différente du module, requires obligatoire, pas de doublon, au plus 3)", () => {
  const m = (over) => parseManifest({ apiVersion: 2, id: "plan", name: "P", version: "1.0.0", requires: [{ service: SVC }], seeds: [{ module: "agenda", reason: "r" }], ...over });
  assert.ok(m({}).ok);
  assert.ok(m({ seeds: [{ module: "agenda", reason: { fr: "a", en: "b" } }] }).ok);
  assert.equal(m({ seeds: [{ module: "plan", reason: "r" }] }).ok, false, "pas soi-même");
  assert.equal(m({ requires: undefined }).ok, false, "sans requires, aucune cible possible");
  assert.equal(m({ seeds: [{ module: "agenda", reason: "r" }, { module: "agenda", reason: "r" }] }).ok, false);
  assert.equal(m({ seeds: [{ module: "a1", reason: "r" }, { module: "a2", reason: "r" }, { module: "a3", reason: "r" }, { module: "a4", reason: "r" }] }).ok, false);
  assert.equal(m({ seeds: [{ module: "agenda" }] }).ok, false, "la raison est obligatoire");
  assert.equal(m({ seeds: [{ module: "Pas Valide", reason: "r" }] }).ok, false);
});

test("de bout en bout : migration → instance semée (secret compris) → ancien réglage effacé, audit sans secret", async () => {
  await installAgenda();
  const { inst, update } = await setupPlan();
  const result = await update();
  assert.equal(result.ok, true);
  assert.deepEqual(migrated(result), [["ok", undefined]]);

  const [seeded] = await agendaInstances();
  assert.equal((await agendaInstances()).length, 1);
  assert.equal(seeded.nickname, "Agenda iCal");
  assert.equal(seeded.enabled, true);
  assert.equal(seeded.key, "agenda-ical");
  assert.equal(await sv(seeded.id, "url"), URL1);
  assert.equal(await sv(seeded.id, "token"), SECRET, "le secret est enregistré comme par l'admin (même table de réglages)");
  assert.equal(await D.dataVersionOf(seeded.id), 1, "l'instance semée suit les règles d'une instance neuve de son module");
  const names = await db.prisma.instanceTranslation.findMany({ where: { instanceId: seeded.id } });
  assert.deepEqual(names.map((n) => [n.locale, n.name]).sort(), [["en", "Agenda iCal"], ["fr", "Agenda iCal"]]);

  // l'ancien réglage a disparu (adresse et jeton) ; le reste est intact
  assert.equal(await sv(inst.id, "icalUrl"), undefined);
  assert.equal(await sv(inst.id, "icalToken"), undefined);
  assert.equal(await sv(inst.id, "title"), "Mon planning");
  assert.equal(await D.dataVersionOf(inst.id), 2);
  assert.deepEqual((await db.prisma.moduleRecord.findMany({ where: { instanceId: inst.id } })).map((r) => JSON.parse(r.data)), [{ created: true, key: "agenda-ical" }]);

  // audit : qui a semé où, jamais les valeurs
  const rows = await audits();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "plan -> agenda : agenda-ical");
  const everything = JSON.stringify(await db.prisma.auditLog.findMany());
  assert.ok(!everything.includes(SECRET) && !everything.includes(URL1), "ni le secret ni l'adresse dans le journal");
  assert.ok(auditLabelKey("module.seed"), "action connue du journal (libellé traduit)");
});

test("idempotence : une graine déjà semée n'est jamais re-semée, même si l'instance a été supprimée depuis", async () => {
  await installAgenda();
  const { inst, update } = await setupPlan();
  assert.equal((await update()).ok, true);
  const first = (await agendaInstances())[0];

  // L'admin supprime l'instance semée, puis l'ancien réglage revient (restauration d'une vieille sauvegarde, par exemple) et la migration repasse.
  await db.prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${first.id}.` } } });
  await db.prisma.moduleInstance.delete({ where: { id: first.id } });
  await setSetting(`instance.${inst.id}.icalUrl`, URL1);
  await setSetting(`instance.${inst.id}.icalToken`, SECRET);
  await setSetting(`instance.${inst.id}.__dataVersion`, 1);
  const again = await D.migrateModuleInstances("plan");
  assert.deepEqual(again.map((m) => m.status), ["ok"]);
  assert.equal((await agendaInstances()).length, 0, "pas de nouvelle instance");
  assert.equal(await sv(inst.id, "icalUrl"), undefined, "mais l'ancien réglage est bien effacé (la graine est confirmée)");
  const logs = (await db.prisma.moduleRecord.findMany({ where: { instanceId: inst.id, collection: "log" } })).map((r) => JSON.parse(r.data));
  assert.deepEqual(logs.map((l) => l.created).sort(), [false, true]);
  assert.equal((await audits()).length, 1, "un seul audit : rien n'a été semé la seconde fois");

  // relancer encore sans rien changer : rien à migrer
  assert.deepEqual((await D.migrateModuleInstances("plan")).map((m) => m.status), ["none"]);
});

test("deux appels avec la même seedKey dans une migration : le second ne crée rien", async () => {
  await installAgenda();
  const { update } = await setupPlan({ body: `
    const a = await ctx.seedInstance("agenda", { nickname: "X", seedKey: "k1", settings: {} });
    const b = await ctx.seedInstance("agenda", { nickname: "Y", seedKey: "k1", settings: {} });
    const c = await ctx.seedInstance("agenda", { nickname: "Z", seedKey: "k2", settings: {} });
    await ctx.api.store.add("log", { a, b, c });` });
  assert.deepEqual(migrated(await update()), [["ok", undefined]]);
  assert.equal((await agendaInstances()).length, 2);
  const log = JSON.parse((await db.prisma.moduleRecord.findFirst({ where: { collection: "log" } })).data);
  assert.deepEqual([log.a.created, log.b.created, log.c.created], [true, false, true]);
  assert.equal(log.b.instanceKey, log.a.instanceKey);
});

test("échec après le semis : rien n'est effacé, l'instance semée est retirée, la migration est en échec visible, « Réessayer » fonctionne", async () => {
  await installAgenda();
  const { inst, update } = await setupPlan({ direct: true, settings: { icalUrl: URL1, icalToken: SECRET, title: "boom" } });
  const result = await quiet(update);
  assert.deepEqual(migrated(result), [["failed", "boom"]]);
  assert.equal((await agendaInstances()).length, 0, "l'instance semée est défaite");
  assert.equal(await sv(inst.id, "icalUrl"), URL1, "rien n'est effacé");
  assert.equal(await sv(inst.id, "icalToken"), SECRET);
  assert.equal(await sv(inst.id, "__seeds.ical"), undefined, "la marque est défaite : la graine pourra être semée au prochain essai");
  assert.equal(await D.dataVersionOf(inst.id), 1);
  assert.equal((await D.dataStatusOf(inst.id)).status, "failed");
  assert.equal((await audits()).length, 0, "pas d'audit pour un semis défait");
  assert.equal(await db.prisma.moduleRecord.count({ where: { instanceId: inst.id } }), 0);

  await setSetting(`instance.${inst.id}.title`, "ok");
  const retry = await D.retryInstanceMigration(inst.id);
  assert.equal(retry.status, "ok");
  assert.equal((await agendaInstances()).length, 1);
  assert.equal(await sv(inst.id, "icalUrl"), undefined);
  assert.equal(await D.dataStatusOf(inst.id), null);
  assert.equal((await audits()).length, 1);
});

test("semis refusé (réglage invalide ou inconnu) : migration en échec, rien créé ni effacé, jamais la valeur dans l'erreur", async () => {
  for (const [settings, why] of [
    [`{ url: "pas une adresse", token: "${SECRET}" }`, /invalid value for "url"/],
    [`{ token: "${SECRET}", inconnu: "x" }`, /"inconnu" is not a setting/],
    [`{ mode: "zzz" }`, /invalid value for "mode"/],
    [`{ count: "beaucoup" }`, /invalid value for "count"/],
    [`{ url: ["x"] }`, /must be text or a number/],
  ]) {
    await fresh();
    await installAgenda();
    const { inst, update } = await setupPlan({ direct: true, body: `await ctx.seedInstance("agenda", { nickname: "A", seedKey: "k", settings: ${settings} }); await ctx.clearSetting("icalUrl");` });
    const result = await quiet(update);
    assert.equal(result.migrations[0].status, "failed", settings);
    assert.match(result.migrations[0].error, why, settings);
    assert.ok(!result.migrations[0].error.includes(SECRET) && !result.migrations[0].error.includes("pas une adresse"), "ni secret ni valeur dans l'erreur");
    assert.equal((await agendaInstances()).length, 0);
    assert.equal(await sv(inst.id, "icalUrl"), URL1);
  }
});

test("module non déclaré dans seeds : refus ; module sans seeds : refus ; clés de graine et surnom invalides refusés", async () => {
  for (const [body, why] of [
    [`await ctx.seedInstance("autre", { nickname: "A", seedKey: "k", settings: {} });`, /does not declare seeding "autre"/],
    [`await ctx.seedInstance("agenda", { nickname: "A", seedKey: "Mauvaise Clé", settings: {} });`, /seedKey must look like/],
    [`await ctx.seedInstance("agenda", { nickname: "   ", seedKey: "k", settings: {} });`, /nickname/],
    [`await ctx.seedInstance("agenda", { seedKey: "k", settings: {} });`, /nickname is required/],
    [`await ctx.seedInstance("agenda", { nickname: "A", seedKey: "k", settings: {}, names: { de: "x" } });`, /no language of this site/],
    [`await ctx.seedInstance("agenda");`, /request object is required/],
  ]) {
    await fresh();
    await installAgenda();
    const { update } = await setupPlan({ direct: true, body });
    const result = await quiet(update);
    assert.equal(result.migrations[0].status, "failed", body);
    assert.match(result.migrations[0].error, why, body);
    assert.equal((await agendaInstances()).length, 0);
  }

  // Aucune déclaration seeds du tout (manifeste de l'ancienne forme) : la fonction existe pendant la migration mais refuse.
  await fresh();
  await installAgenda();
  const repo = makeRepo({ "module.json": planManifest("1.0.0"), "index.mjs": "export default {};" }); repo.g("tag", "v1.0.0");
  await I.installModule(`${repo.url}#v1.0.0`);
  await createInstance(db.prisma, { manifest: (await R.getModule("plan")).manifest, names: { fr: "Plan" } });
  fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify({ ...planManifest("1.1.0", 2), seeds: undefined }));
  fs.writeFileSync(path.join(repo.dir, "index.mjs"), migration(`await ctx.seedInstance("agenda", { nickname: "A", seedKey: "k", settings: {} });`));
  repo.g("commit", "-qam", "r"); repo.g("tag", "v1.1.0");
  const result = await quiet(() => I.updateModule("plan"));
  assert.match(result.migrations[0].error, /does not declare seeding/);
  assert.equal((await agendaInstances()).filter((i) => i.nickname).length, 0, "(la cascade qui suit peut donner à agenda son instance par défaut, sans surnom)");
});

test("cible qui n'offre aucun service requis : refus (on ne sème pas n'importe où), même si elle est déclarée dans seeds", async () => {
  await installAgenda({ id: "mailer", name: "Mailer", offers: [{ service: "autre.service" }] });
  const { inst, update } = await setupPlan({ direct: true, body: `await ctx.seedInstance("mailer", { nickname: "A", seedKey: "k", settings: {} }); await ctx.clearSetting("icalUrl");`, v2: { seeds: [{ module: "mailer", reason: "r" }] } });
  const result = await quiet(update);
  assert.equal(result.migrations[0].status, "failed");
  assert.match(result.migrations[0].error, /does not require any service/);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "mailer" } }), 0);
  assert.equal(await sv(inst.id, "icalUrl"), URL1);
});

test("une instance existante n'est jamais écrasée : la graine crée une AUTRE instance (surnom rendu unique) ; module « single » déjà instancié : refus", async () => {
  await installAgenda();
  const agenda = await R.getModule("agenda");
  const old = await createInstance(db.prisma, { manifest: agenda.manifest, nickname: "Agenda iCal", names: { fr: "Mon agenda" } });
  await setSetting(`instance.${old.id}.url`, "https://old.example/a.ics");
  await setSetting(`instance.${old.id}.token`, "ancien-jeton");
  const { update } = await setupPlan();
  assert.deepEqual(migrated(await update()), [["ok", undefined]]);
  const all = await agendaInstances();
  assert.equal(all.length, 2);
  const created = all.find((i) => i.id !== old.id);
  assert.equal(created.nickname, "Agenda iCal 2", "même surnom déjà pris : numéroté");
  assert.equal(await sv(old.id, "url"), "https://old.example/a.ics");
  assert.equal(await sv(old.id, "token"), "ancien-jeton");
  assert.equal((await db.prisma.moduleInstance.findUnique({ where: { id: old.id } })).nickname, "Agenda iCal");
  assert.equal(await sv(created.id, "url"), URL1);

  // Module cible en instance unique : la graine ne peut pas ajouter la seconde.
  await fresh();
  await installAgenda({ instances: "single" });
  const single = await createInstance(db.prisma, { manifest: (await R.getModule("agenda")).manifest, names: { fr: "Agenda" } });
  await setSetting(`instance.${single.id}.url`, "https://old.example/b.ics");
  const { inst, update: again } = await setupPlan({ direct: true });
  const result = await quiet(again);
  assert.match(result.migrations[0].error, /accepts a single instance/);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "agenda" } }), 1);
  assert.equal(await sv(single.id, "url"), "https://old.example/b.ics");
  assert.equal(await sv(inst.id, "icalUrl"), URL1);
});

test("module cible déjà installé : l'instance semée est créée, active ; réglages traduisibles et noms acceptés", async () => {
  await installAgenda({}, { enabled: false });
  const { update } = await setupPlan({ direct: true, body: `
    await ctx.seedInstance("agenda", { nickname: "Planning", names: { fr: "Planning Twitch", en: "Twitch schedule", de: "ignoré" }, seedKey: "k", settings: { url: ctx.setting("icalUrl"), label: { fr: "Bonjour", en: "Hello" }, mode: "b", count: 3 } });
    await ctx.clearSetting("icalUrl");` });
  assert.equal((await update()).ok, true);
  const [seeded] = await agendaInstances();
  assert.equal((await db.prisma.module.findUnique({ where: { id: "agenda" } })).enabled, true);
  assert.deepEqual((await db.prisma.instanceTranslation.findMany({ where: { instanceId: seeded.id } })).map((n) => [n.locale, n.name]).sort(), [["en", "Twitch schedule"], ["fr", "Planning Twitch"]]);
  assert.deepEqual([await sv(seeded.id, "mode"), await sv(seeded.id, "count")], ["b", 3]);
  assert.equal(await getSetting(`instance.${seeded.id}.label`, "en"), "Hello");
  assert.equal(await getSetting(`instance.${seeded.id}.label`, "fr"), "Bonjour");
});

test("clearSetting : refusé avant tout semis abouti, refusé pour un réglage qui n'est pas du module ; seedInstance / clearSetting n'existent pas hors migration", async () => {
  await installAgenda();
  const { inst, update } = await setupPlan({ direct: true, body: `await ctx.clearSetting("icalUrl");` });
  const result = await quiet(update);
  assert.match(result.migrations[0].error, /only allowed once seedInstance has succeeded/);
  assert.equal(await sv(inst.id, "icalUrl"), URL1);

  await fresh();
  await installAgenda();
  const second = await setupPlan({ direct: true, body: `await ctx.seedInstance("agenda", { nickname: "A", seedKey: "k", settings: {} }); await ctx.clearSetting("__dataVersion");` });
  const r2 = await quiet(second.update);
  assert.match(r2.migrations[0].error, /not a setting of "plan"/);
  assert.equal(await D.dataVersionOf(second.inst.id), 1);
  assert.equal((await agendaInstances()).length, 0);

  const { getInstanceById } = await import("@/core/instances");
  const ctx = await buildContext(await R.getModule("plan"), await getInstanceById(second.inst.id), "fr");
  assert.equal(ctx.seedInstance, undefined);
  assert.equal(ctx.clearSetting, undefined);
});

/* ───────────── Cascade : le module cible n'est pas encore installé ───────────── */

const publishAgenda = (over = {}) => cat.add("agenda", { manifest: agendaManifest(over), entry: { offers: [{ service: SVC, version: 1 }] } });

test("cascade : cible absente → installée depuis le catalogue SANS instance par défaut, activée, instance semée seule, marquée « installée automatiquement »", async () => {
  await publishAgenda();
  assert.equal(await R.getModule("agenda"), null);
  const { inst, update } = await setupPlan();
  const result = await update();
  assert.deepEqual(migrated(result), [["ok", undefined]]);
  const row = await db.prisma.module.findUnique({ where: { id: "agenda" } });
  assert.deepEqual([row?.enabled, row?.source], [true, "git"]);
  const instances = await agendaInstances();
  assert.equal(instances.length, 1, "uniquement l'instance semée : pas d'instance par défaut vide à côté");
  assert.equal(instances[0].enabled, true);
  assert.equal(await sv(instances[0].id, "url"), URL1);
  assert.equal(await sv(inst.id, "icalUrl"), undefined);
  assert.deepEqual((await Auto.readAuto()).agenda?.for, ["plan"]);
  assert.equal((await Auto.readAuto()).agenda?.module, true);
  assert.equal(result.missing, undefined, "la cascade qui suit la migration trouve le service déjà fourni");
  assert.equal((await audits()).length, 1);
});

test("cascade : échec de la migration après l'installation → la cible installée pour l'occasion est retirée, avec son instance ; rien n'est effacé", async () => {
  await publishAgenda();
  const { inst, update } = await setupPlan({ direct: true, settings: { icalUrl: URL1, icalToken: SECRET, title: "boom" } });
  const result = await quiet(update);
  assert.equal(result.migrations[0].status, "failed");
  assert.equal(await db.prisma.module.findUnique({ where: { id: "agenda" } }), null, "module cible retiré");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "agenda" } }), 0);
  assert.equal(fs.existsSync(path.join(db.dir, "modules", "agenda")), false, "ses fichiers aussi");
  assert.equal(await sv(inst.id, "icalUrl"), URL1);
  assert.equal((await Auto.readAuto()).agenda, undefined);
  assert.equal((await audits()).length, 0);
  // « Réessayer » une fois le problème levé : la cascade repart de zéro et aboutit
  await setSetting(`instance.${inst.id}.title`, "ok");
  assert.equal((await D.retryInstanceMigration(inst.id)).status, "ok");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "agenda" } }), 1);
});

test("cascade : cible ni installée ni dans le catalogue, ou catalogue injoignable → refus visible, rien créé ni effacé", async () => {
  const { inst, update } = await setupPlan({ direct: true });
  const result = await quiet(update);
  assert.equal(result.migrations[0].status, "failed");
  assert.match(result.migrations[0].error, /not installed and not available in the catalogue/);
  assert.equal(await sv(inst.id, "icalUrl"), URL1);

  await publishAgenda({ offers: [{ service: "autre.service" }] });   // l'index annonce un autre service que celui dont dépend le semeur
  await cat.add("agenda", { manifest: agendaManifest({ offers: [{ service: "autre.service" }] }), entry: { offers: [{ service: "autre.service", version: 1 }] } });
  const again = await quiet(() => D.retryInstanceMigration(inst.id));
  assert.equal(again.status, "failed");
  assert.match(again.error, /does not require any service "agenda" offers/);
  assert.equal(await db.prisma.module.findUnique({ where: { id: "agenda" } }), null);
});

test("cascade : la cible installée par le semis est active, avec son instance semée", async () => {
  await publishAgenda();
  const { update } = await setupPlan({ direct: true, enabled: false });
  assert.deepEqual(migrated(await update()), [["ok", undefined]]);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "agenda" } })).enabled, true);
  assert.equal((await agendaInstances()).length, 1);
});

test("cascade : le manifeste réel de la cible tranche (l'index annonçait un service qu'elle n'offre pas) → refus, cible retirée", async () => {
  await cat.add("agenda", { manifest: agendaManifest({ offers: [{ service: "autre.service" }] }), entry: { offers: [{ service: SVC, version: 1 }] } });
  const { inst, update } = await setupPlan({ direct: true });
  const result = await quiet(update);
  assert.equal(result.migrations[0].status, "failed");
  assert.equal(await db.prisma.module.findUnique({ where: { id: "agenda" } }), null, "installée puis retirée");
  assert.equal(await sv(inst.id, "icalUrl"), URL1);
});
