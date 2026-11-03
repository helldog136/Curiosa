import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb as openTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Contrôle `period` : valeurs déjà enregistrées inchangées, période ouverte (début seul, fin seule) seulement sur demande du réglage (`openEnded`), vérifiée par le serveur
// comme par le navigateur ; et `ctx.timezone` : le fuseau du site donné aux modules (réglage `site.timezone`, repli sur celui du serveur), de façon additive.
const db = await openTestDb();
const { prisma } = db;
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { buildContext } = await import("@/core/modules/context");
const { getInstanceById } = await import("@/core/instances");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { systemTimezone, isTimezone } = await import("@/core/siteTime");
const { fakeCtx } = await import("../../testsupport/fakeCtx.mjs");

after(() => db.close());
beforeEach(() => db.reset());

const lbl = (fr, en) => ({ fr, en });
const manifest = () => ({
  apiVersion: 2, id: "demo-period", name: "Demo", version: "1.0.0", main: "index.mjs", permissions: ["sections"], sections: [{ id: "s", label: "S" }],
  settings: [
    { key: "closed", type: "period", label: lbl("Période", "Period") },
    { key: "open", type: "period", openEnded: true, label: lbl("Ouverte", "Open") },
    { key: "season", type: "period", default: "11-01/11-30", label: lbl("Saison", "Season") },
  ],
});
const CODE = `export default { sections: { s: async (ctx) => [{ type: "text", text: JSON.stringify({ closed: ctx.setting("closed"), open: ctx.setting("open"), season: ctx.setting("season"), tz: ctx.timezone }) }] } };`;
async function setup() {
  assert.equal((await installModule(makeRepo({ "module.json": manifest(), "index.mjs": CODE }).url, { dependencies: false })).ok, true);
  const mod = await R.getModule("demo-period");
  const inst = await createInstance(prisma, { manifest: mod.manifest, nickname: "Demo", names: { fr: "Demo" } });
  const admin = await prisma.user.create({ data: { email: "adam@example.org", name: "Adam", role: "admin", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: admin.id, sv: 0 } };
  return { mod, inst };
}
const form = (inst, entries) => { const fd = new FormData(); fd.set("id", inst.id); for (const [k, v] of entries) fd.append(k, v); return fd; };
const stored = async (inst, key) => (await getSettingByLocale(`instance.${inst.id}.${key}`))[""];
const ctxOf = async (mod, inst) => buildContext(mod, await getInstanceById(inst.id), "fr");

test("manifeste : `openEnded` est lu tel quel ; absent, il n'existe pas (désactivé par défaut)", async () => {
  const { mod } = await setup();
  const by = Object.fromEntries(mod.manifest.settings.map((s) => [s.key, s]));
  assert.equal(by.open.openEnded, true);
  assert.equal(by.closed.openEnded, undefined);
  assert.equal(by.season.openEnded, undefined);
});

test("administration : une période ouverte est enregistrée seulement par un réglage `openEnded`, refusée sous le champ sinon", async () => {
  const { inst } = await setup();
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  // Réglage qui n'a pas demandé la forme ouverte : refus, comme avant, avec un exemple ; rien n'est écrit.
  for (const bad of ["2026-12-01/", "/2026-12-24"]) {
    const r = await saveInstanceSettings(null, form(inst, [["s__closed", bad]]));
    assert.ok(!r.ok && r.errors?.s__closed, `${bad} : ${JSON.stringify(r)}`);
    assert.match(r.errors.s__closed, /(par exemple du 1er novembre au 30 novembre|for example from 1 November to 30 November)/);
    assert.equal(await stored(inst, "closed"), undefined);
  }
  // Réglage qui l'a demandée : début seul, fin seule.
  let r = await saveInstanceSettings(null, form(inst, [["s__open", "2026-12-01/"]]));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(await stored(inst, "open"), "2026-12-01/");
  r = await saveInstanceSettings(null, form(inst, [["s__open", "/2026-12-24"]]));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(await stored(inst, "open"), "/2026-12-24");
  // Fin avant début, jour qui n'existe pas, forme ouverte sans année : refus avec un exemple qui parle d'une date ou de deux.
  for (const bad of ["2026-12-15/2026-12-01", "/2027-02-29", "12-01/", "//"]) {
    r = await saveInstanceSettings(null, form(inst, [["s__open", bad]]));
    assert.ok(!r.ok && r.errors?.s__open, bad);
    assert.match(r.errors.s__open, /(choisissez une date ou deux.*par exemple jusqu'au 24 décembre 2026|choose one date or two.*for example until 24 December 2026)/);
  }
  assert.equal(await stored(inst, "open"), "/2026-12-24", "un refus n'écrit rien");
  // Vider le champ efface le réglage (comme avant).
  r = await saveInstanceSettings(null, form(inst, [["s__open", ""]]));
  assert.ok(r.ok);
  assert.equal(await stored(inst, "open"), undefined);
});

test("valeurs déjà enregistrées : lues par le module telles quelles (chaque année comprise), défaut du module inchangé", async () => {
  const { mod, inst } = await setup();
  assert.equal((await ctxOf(mod, inst)).setting("season"), "11-01/11-30", "défaut du manifeste : « chaque année », comme avant");
  assert.equal((await ctxOf(mod, inst)).setting("closed"), undefined);
  await setSetting(`instance.${inst.id}.closed`, "12-01/12-24");
  await setSetting(`instance.${inst.id}.season`, "2026-12-01/2026-12-15");
  const ctx = await ctxOf(mod, inst);
  assert.equal(ctx.setting("closed"), "12-01/12-24", "une valeur « chaque année » enregistrée ne change jamais de sens");
  assert.equal(ctx.setting("season"), "2026-12-01/2026-12-15");
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const r = await saveInstanceSettings(null, form(inst, [["s__closed", "12-01/12-24"], ["s__season", "11-01/11-30"]]));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(await stored(inst, "closed"), "12-01/12-24", "enregistrée à nouveau sans être touchée : identique");
});

/* ───────────── ctx.timezone ───────────── */

test("ctx.timezone : le fuseau du site, un nom valide, présent pour chaque instance", async () => {
  const { mod, inst } = await setup();
  const ctx0 = await ctxOf(mod, inst);
  assert.equal(typeof ctx0.timezone, "string");
  assert.equal(ctx0.timezone, systemTimezone(), "rien de réglé : le fuseau du serveur, comme ailleurs dans le cœur");
  assert.ok(isTimezone(ctx0.timezone));
  await setSetting("site.timezone", "Pacific/Auckland");
  assert.equal((await ctxOf(mod, inst)).timezone, "Pacific/Auckland");
  await setSetting("site.timezone", "UTC");
  assert.equal((await ctxOf(mod, inst)).timezone, "UTC");
  // Les autres langues et le visiteur n'y changent rien.
  assert.equal((await buildContext(mod, await getInstanceById(inst.id), "en")).timezone, "UTC");
});

test("ctx.timezone : un fuseau inconnu ou abîmé donne le repli du cœur, jamais un nom que Intl refuse", async () => {
  const { mod, inst } = await setup();
  for (const bad of ["Mars/Phobos", "", "  ", "UTC+99", "../../etc", 42, null, { tz: "UTC" }]) {
    await setSetting("site.timezone", bad);
    const tz = (await ctxOf(mod, inst)).timezone;
    assert.equal(tz, systemTimezone(), `réglage ${JSON.stringify(bad)}`);
    assert.ok(isTimezone(tz));
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: tz }));
  }
});

test("ctx.timezone : visible depuis le code du module (ajout sans effet sur un module qui l'ignore)", async () => {
  const { mod, inst } = await setup();
  await setSetting("site.timezone", "Europe/Brussels");
  const ctx = await ctxOf(mod, inst);
  const blocks = await mod.def.sections.s(ctx, {});
  assert.equal(JSON.parse(blocks[0].text).tz, "Europe/Brussels");
});

test("fakeCtx (kit de test) : ctx.timezone présent et valide, repli comme le cœur, `null` simule un cœur plus ancien", () => {
  assert.equal(fakeCtx().timezone, "UTC", "défaut stable pour des tests qui ne dépendent pas de la machine");
  assert.equal(fakeCtx({ timezone: "Europe/Brussels" }).timezone, "Europe/Brussels");
  assert.equal(fakeCtx({ timezone: "Pacific/Auckland" }).timezone, "Pacific/Auckland");
  for (const bad of ["Mars/Phobos", "", "UTC+99", 12]) assert.equal(fakeCtx({ timezone: bad }).timezone, systemTimezone(), `fuseau ${JSON.stringify(bad)}`);
  const old = fakeCtx({ timezone: null });
  assert.equal("timezone" in old, false, "un cœur plus ancien n'a pas la clé");
  assert.equal(typeof old.timezone === "string", false);
  // Un module qui teste la présence garde son repli d'avant.
  const zoneOf = (ctx) => (typeof ctx.timezone === "string" && isTimezone(ctx.timezone) ? ctx.timezone : "repli-du-module");
  assert.equal(zoneOf(old), "repli-du-module");
  assert.equal(zoneOf(fakeCtx({ timezone: "Europe/Paris" })), "Europe/Paris");
});
