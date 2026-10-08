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

test("doublon de service : détecté, « à choisir » tant que l'admin n'a rien dit ; maître par défaut = le premier, sans réplique", async () => {
  await install(provider("prov-a"), "prov-a"); await install(provider("prov-b"), "prov-b");
  await setModuleEnabled("prov-a", true);
  await instance("prov-a", "a-store");
  assert.deepEqual(await Dep.duplicateServices(), [], "un seul fournisseur : rien à choisir");
  await setModuleEnabled("prov-b", true); await instance("prov-b", "b-store");
  const [dup] = await Dep.duplicateServices();
  assert.deepEqual([dup.service, dup.resolved, dup.providers.map((p) => p.instance.key)], [SERVICE, false, ["a-store", "b-store"]]);
  await install(consumer(), "cons"); await setModuleEnabled("cons", true); await instance("cons", "form");
  assert.equal((await Dep.callService(await active("cons"), SERVICE, "add", {})).value.by, "a-store");
  assert.equal(await db.prisma.moduleRecord.count({ where: { collection: "items" } }), 1, "pas de réplique tant qu'on n'a pas choisi");
});

test("maître + répliques : le maître répond, les répliques reçoivent aussi les écritures ; les lectures ne sont pas répliquées", async () => {
  const code = `export default { services: { "${SERVICE}": {
    add: async (ctx, args) => ({ id: await ctx.api.store.add("items", args), by: ctx.instance.key }),
    count: async (ctx) => ({ n: await ctx.api.store.count("items"), by: ctx.instance.key }),
  } } };`;
  const prov = (id) => { const r = provider(id, code); return r; };
  // `count` est déclarée lecture seule dans le manifeste du maître
  const withReadOnly = (id) => makeRepo({ "module.json": { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", offers: [{ service: SERVICE, readOnly: ["count"] }] }, "index.mjs": code });
  await install(withReadOnly("prov-a"), "prov-a"); await install(prov("prov-b"), "prov-b"); await install(prov("prov-c"), "prov-c");
  for (const id of ["prov-a", "prov-b", "prov-c"]) await setModuleEnabled(id, true);
  const pa = await instance("prov-a", "a-store"), pb = await instance("prov-b", "b-store"), pc = await instance("prov-c", "c-store");
  await install(consumer(), "cons"); await setModuleEnabled("cons", true); await instance("cons", "form");
  const cons = await active("cons");
  const n = (inst) => db.prisma.moduleRecord.count({ where: { collection: "items", instanceId: inst.id } });

  await Dep.setRouting(SERVICE, { master: "a-store", replicas: ["b-store"] });
  const r = await Dep.callService(cons, SERVICE, "add", { name: "Alice" });
  assert.equal(r.value.by, "a-store", "l'appelant voit la réponse du maître");
  assert.deepEqual([await n(pa), await n(pb), await n(pc)], [1, 1, 0], "maître et réplique reçoivent ; ni l'un ni l'autre n'est « tous »");
  const read = await Dep.callService(cons, SERVICE, "count", {});
  assert.deepEqual(read.value, { n: 1, by: "a-store" });
  assert.deepEqual([await n(pa), await n(pb)], [1, 1], "la lecture n'a rien écrit nulle part");
  assert.equal((await Dep.duplicateServices())[0].resolved, true);

  // la panne d'une réplique ne fait pas échouer l'appel
  await db.prisma.moduleRecord.deleteMany({});
  await Dep.setRouting(SERVICE, { master: "a-store", replicas: ["b-store", "c-store"] });
  assert.equal((await Dep.callService(cons, SERVICE, "add", { name: "Bob" })).ok, true);
  assert.deepEqual([await n(pa), await n(pb), await n(pc)], [1, 1, 1]);
});

test("réplique en panne : l'appel réussit quand même ; maître en panne : l'appel échoue, aucune réplique n'est écrite", async () => {
  const bad = `export default { services: { "${SERVICE}": { add: async () => { throw new Error("réplique cassée"); } } } };`;
  await install(provider("prov-a"), "prov-a"); await install(provider("prov-bad", bad), "prov-bad");
  await setModuleEnabled("prov-a", true); await setModuleEnabled("prov-bad", true);
  await instance("prov-a", "a-store"); await instance("prov-bad", "bad-store");
  await install(consumer(), "cons"); await setModuleEnabled("cons", true); await instance("cons", "form");
  const cons = await active("cons");
  await Dep.setRouting(SERVICE, { master: "a-store", replicas: ["bad-store"] });
  assert.equal((await quiet(() => Dep.callService(cons, SERVICE, "add", {}))).ok, true);
  await Dep.setRouting(SERVICE, { master: "bad-store", replicas: ["a-store"] });
  assert.deepEqual(await quiet(() => Dep.callService(cons, SERVICE, "add", {})), { ok: false, reason: "failed" });
  assert.equal(await db.prisma.moduleRecord.count({ where: { collection: "items" } }), 1, "le maître a échoué : la réplique n'a rien reçu de plus");
});

test("routage périmé (maître ou réplique retiré) : repli sur le premier fournisseur actif, sans erreur", async () => {
  await install(provider("prov-a"), "prov-a"); await install(provider("prov-b"), "prov-b");
  await setModuleEnabled("prov-a", true); await setModuleEnabled("prov-b", true);
  await instance("prov-a", "a-store"); await instance("prov-b", "b-store");
  await install(consumer(), "cons"); await setModuleEnabled("cons", true); await instance("cons", "form");
  await Dep.setRouting(SERVICE, { master: "b-store", replicas: ["a-store"] });
  assert.equal((await setModuleEnabled("prov-b", false)).ok, true, "le maître peut partir tant qu'un autre fournisseur reste");
  assert.equal((await Dep.callService(await active("cons"), SERVICE, "add", {})).value.by, "a-store");
  await Dep.setRouting(SERVICE, null);
  assert.equal(await Dep.getRouting(SERVICE), null);
});
