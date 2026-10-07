import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule, setModuleEnabled, uninstallModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Dep = await import("@/core/modules/dependencies");
const { parseManifest } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");

beforeEach(() => db.reset());
after(() => db.close());
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const SERVICE = "demo.store";
const provider = (id, code) => makeRepo({
  "module.json": { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", offers: [{ service: SERVICE }] },
  "index.mjs": code ?? `export default { services: { "${SERVICE}": {
    add: async (ctx, args) => ({ id: await ctx.api.store.add("items", args), by: ctx.instance.key }),
    boom: async () => { throw new Error("secret detail"); },
  } } };`,
});
const consumer = (id = "cons", requires = [{ service: SERVICE }]) => makeRepo({ "module.json": { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", requires }, "index.mjs": "export default {};" });
const install = async (repo, id) => { assert.equal((await installModule(repo.url)).ok, true); return id; };
const instance = async (id, key) => createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: key, names: { fr: key } });
const active = async (id) => (await R.getActiveInstances()).find((a) => a.mod.manifest.id === id);

test("manifeste : offers / requires valides, noms de services contrôlés", () => {
  const m = (extra) => ({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", ...extra });
  assert.ok(parseManifest(m({ offers: [{ service: "contact.store" }], requires: [{ service: "contact.store", label: { en: "Contacts" } }] })).ok);
  for (const bad of ["Contact", "a b", "a..b", ""]) assert.equal(parseManifest(m({ requires: [{ service: bad }] })).ok, false, bad);
});

test("activer un module sans son fournisseur : refusé, avec ce qui manque ; avec le fournisseur actif : accepté", async () => {
  await install(consumer(), "cons");
  const refused = await setModuleEnabled("cons", true);
  assert.deepEqual([refused.ok, refused.error, refused.detail], [false, "modules.error.requires", SERVICE]);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "cons" } })).enabled, false);

  await install(provider("prov"), "prov");
  assert.equal((await setModuleEnabled("cons", true)).ok, false, "fournisseur installé mais pas activé : toujours refusé");
  assert.equal((await setModuleEnabled("prov", true)).ok, true);
  assert.equal((await setModuleEnabled("cons", true)).ok, true);
});

test("un module sans dépendance s'active comme avant", async () => {
  await install(provider("prov"), "prov");
  assert.equal((await setModuleEnabled("prov", true)).ok, true);
});

test("appel de service : le fournisseur écrit dans SON stockage, la valeur revient, le contexte est celui du fournisseur", async () => {
  await install(provider("prov"), "prov"); await setModuleEnabled("prov", true);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true);
  const p = await instance("prov", "carnet"); await instance("cons", "form");
  const r = await Dep.callService(await active("cons"), SERVICE, "add", { name: "Alice" });
  assert.equal(r.ok, true);
  assert.equal(r.value.by, "carnet");
  const rows = await db.prisma.moduleRecord.findMany({ where: { collection: "items" } });
  assert.deepEqual(rows.map((x) => [x.instanceId, JSON.parse(x.data)]), [[p.id, { name: "Alice" }]]);
  assert.equal(await Dep.serviceAvailable(SERVICE), true);
});

test("appel de service : non déclaré, méthode inconnue, erreur du fournisseur (jamais d'exception ni de détail), fournisseur absent", async () => {
  await install(provider("prov"), "prov"); await setModuleEnabled("prov", true);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true);
  await install(consumer("other", []), "other"); await setModuleEnabled("other", true);
  await instance("prov", "carnet"); await instance("cons", "form"); await instance("other", "autre");
  const cons = await active("cons");
  assert.deepEqual(await Dep.callService(cons, SERVICE, "nope", {}), { ok: false, reason: "no_method" });
  assert.deepEqual(await quiet(() => Dep.callService(cons, SERVICE, "boom", {})), { ok: false, reason: "failed" });
  assert.deepEqual(await Dep.callService(await active("other"), SERVICE, "add", {}), { ok: false, reason: "undeclared" }, "sans `requires`, pas d'accès");
  assert.deepEqual(await Dep.callService(cons, "autre.service", "add", {}), { ok: false, reason: "undeclared" });
  // plus d'instance fournisseur active → indisponible, sans erreur
  await db.prisma.moduleInstance.updateMany({ where: { moduleId: "prov" }, data: { enabled: false } });
  assert.deepEqual(await Dep.callService(cons, SERVICE, "add", {}), { ok: false, reason: "unavailable" });
  assert.equal(await Dep.serviceAvailable(SERVICE), false);
});

test("désactiver ou désinstaller un fournisseur dont un module actif dépend : refusé ; libre dès que le dépendant est arrêté", async () => {
  await install(provider("prov"), "prov"); await setModuleEnabled("prov", true);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true);
  const off = await setModuleEnabled("prov", false);
  assert.deepEqual([off.ok, off.error, off.detail], [false, "modules.error.requiredBy", "cons"]);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "prov" } })).enabled, true);
  const un = await uninstallModule("prov");
  assert.deepEqual([un.ok, un.error, un.detail], [false, "modules.error.requiredBy", "cons"]);
  assert.ok(await db.prisma.module.findUnique({ where: { id: "prov" } }), "toujours installé");
  assert.equal((await setModuleEnabled("cons", false)).ok, true);
  assert.equal((await setModuleEnabled("prov", false)).ok, true);
  assert.equal((await uninstallModule("prov")).ok, true);
});

test("deux fournisseurs du même service : l'un peut s'arrêter tant que l'autre reste ; un fournisseur désactivé est ignoré", async () => {
  await install(provider("prov-a"), "prov-a"); await install(provider("prov-b"), "prov-b");
  await setModuleEnabled("prov-a", true); await setModuleEnabled("prov-b", true);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true);
  await instance("prov-a", "a-store"); await instance("prov-b", "b-store"); await instance("cons", "form");
  assert.equal((await setModuleEnabled("prov-a", false)).ok, true);
  const r = await Dep.callService(await active("cons"), SERVICE, "add", { n: 1 });
  assert.equal(r.value.by, "b-store");
  assert.equal((await setModuleEnabled("prov-b", false)).ok, false, "le dernier fournisseur ne peut pas partir");
});

test("choix du fournisseur : premier par clé d'instance, de façon stable", async () => {
  await install(provider("prov"), "prov"); await setModuleEnabled("prov", true);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true);
  await instance("prov", "zeta"); await instance("prov", "alpha"); await instance("cons", "form");
  assert.equal((await Dep.callService(await active("cons"), SERVICE, "add", {})).value.by, "alpha");
});

test("plusieurs fournisseurs : un seul reçoit (jamais tous), celui que l'admin a choisi ; choix invalide ou disparu → le premier", async () => {
  await install(provider("prov-a"), "prov-a"); await install(provider("prov-b"), "prov-b");
  await setModuleEnabled("prov-a", true); await setModuleEnabled("prov-b", true);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true);
  const pa = await instance("prov-a", "a-store"), pb = await instance("prov-b", "b-store"); const form = await instance("cons", "form");
  const cons = await active("cons");

  assert.equal((await Dep.callService(cons, SERVICE, "add", { n: 1 })).value.by, "a-store", "par défaut : le premier");
  await Dep.setProviderChoice(form.id, SERVICE, "b-store");
  assert.equal((await Dep.callService(cons, SERVICE, "add", { n: 2 })).value.by, "b-store");
  const counts = async () => ({ "a-store": await db.prisma.moduleRecord.count({ where: { collection: "items", instanceId: pa.id } }), "b-store": await db.prisma.moduleRecord.count({ where: { collection: "items", instanceId: pb.id } }) });
  assert.deepEqual(await counts(), { "a-store": 1, "b-store": 1 }, "chaque appel n'a atteint qu'un fournisseur");

  await Dep.setProviderChoice(form.id, SERVICE, "n-existe-pas");
  assert.equal((await Dep.callService(cons, SERVICE, "add", {})).value.by, "a-store", "choix invalide : repli sur le premier");
  await Dep.setProviderChoice(form.id, SERVICE, "b-store");
  assert.equal((await setModuleEnabled("prov-b", false)).ok, true, "un fournisseur choisi peut être retiré tant qu'un autre reste");
  assert.equal((await Dep.callService(await active("cons"), SERVICE, "add", {})).value.by, "a-store", "fournisseur choisi disparu : repli");
  await Dep.setProviderChoice(form.id, SERVICE, null);
  assert.equal(await Dep.getProviderChoice(form.id, SERVICE), null);
});
