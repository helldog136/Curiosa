import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { fakeCtx } from "../helpers/fakeCtx.mjs";

// Service « each » : chaque instance répond pour elle-même (pas de maître/réplique) ; `callAll` les interroge toutes. Aucun réseau.
const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Dep = await import("@/core/modules/dependencies");
const Ver = await import("@/core/modules/serviceVersions");
const Rec = await import("@/core/modules/recognized");
const { parseManifest } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");
const { makeApi } = await import("@/core/modules/api");
const { toInstanceView } = await import("@/core/instances");

beforeEach(() => db.reset());
after(() => db.close());
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const SVC = "demo.live";
const CODE = `export default { services: { "${SVC}": {
  status: async (ctx) => ({ who: ctx.instance.key }),
  boom: async (ctx) => { if (ctx.instance.key === "b-chan") throw new Error("token=SECRET123"); return "fine"; },
  onlyA: async (ctx) => (ctx.instance.key === "a-chan" ? "a" : "x"),
} } };`;
const provider = (id, offer = { service: SVC, each: true }, code = CODE) => makeRepo({ "module.json": { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", offers: [offer] }, "index.mjs": code });
const consumer = (id = "cons", requires = [{ service: SVC }]) => makeRepo({ "module.json": { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", requires }, "index.mjs": "export default {};" });
const install = async (repo) => assert.equal((await installModule(repo.url, { dependencies: false })).ok, true);
const instance = async (id, key) => createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: key, names: { fr: `Nom ${key}` } });
const active = async (id) => (await R.getActiveInstances()).find((a) => a.mod.manifest.id === id);

async function setup() {
  await install(provider("chan"));
  await install(consumer());
  await db.prisma.moduleInstance.deleteMany({ where: { key: { in: ["chan", "cons"] } } });   // instances par défaut créées à l'activation
  // Créées dans l'ordre z, a, b : l'ordre de CRÉATION (pas l'ordre alphabétique des clés) fait foi.
  await instance("chan", "z-chan"); await new Promise((r) => setTimeout(r, 5));
  await instance("chan", "a-chan"); await new Promise((r) => setTimeout(r, 5));
  await instance("chan", "b-chan"); await instance("cons", "form");
}

test("manifeste : offers.each booléen facultatif (défaut absent), cohérent avec version", () => {
  const m = (extra) => ({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", ...extra });
  const ok = parseManifest(m({ offers: [{ service: SVC, version: 2, each: true }] }));
  assert.ok(ok.ok);
  assert.deepEqual([ok.manifest.offers[0].version, ok.manifest.offers[0].each], [2, true]);
  assert.deepEqual(Ver.normalizeOffers(ok.manifest.offers), [{ service: SVC, version: 2, each: true }]);
  const plain = parseManifest(m({ offers: [{ service: SVC }] }));
  assert.equal("each" in plain.manifest.offers[0], false);
  assert.deepEqual(Ver.normalizeOffers(plain.manifest.offers), [{ service: SVC, version: 1 }]);
  assert.deepEqual(Ver.normalizeOffers([{ service: SVC, each: false }]), [{ service: SVC, version: 1 }]);
  for (const bad of ["yes", 1, null]) assert.equal(parseManifest(m({ offers: [{ service: SVC, each: bad }] })).ok, false, String(bad));
  assert.equal(Ver.offerIsEach(ok.manifest.offers, SVC), true);
  assert.equal(Ver.offerIsEach(plain.manifest.offers, SVC), false);
});

test("index du catalogue : offers.each validé comme les autres champs", () => {
  const e = (extra) => ({ id: "aa", name: "A", description: "", repo: "https://github.com/x/aa", ...extra });
  const [a] = Rec.sanitizeEntries([e({ offers: [{ service: SVC, each: true }, { service: "demo.b", version: 2, each: true }, { service: "demo.c", each: "oui" }, { service: "demo.d", each: false }, "demo.e"], requires: [{ service: SVC, each: true }] })]);
  assert.deepEqual(a.offers, [{ service: SVC, each: true }, { service: "demo.b", version: 2, each: true }, { service: "demo.c" }, { service: "demo.d" }, { service: "demo.e" }]);
  assert.deepEqual(a.needs, [{ service: SVC }], "`each` n'a aucun sens pour une exigence");
});

test("page des services partagés : un service each n'a ni « à choisir » ni maître ; un service classique oui", async () => {
  await setup();
  assert.deepEqual(await Dep.duplicateServices(), [], "chaque instance répond pour elle-même : rien à arbitrer");
  // Un second service, classique, offert par deux instances : il reste à arbitrer.
  await install(provider("plain", { service: "demo.plain" }, "export default {};"));
  await instance("plain", "p1"); await instance("plain", "p2");
  const list = await Dep.duplicateServices();
  assert.deepEqual(list.map((d) => [d.service, d.resolved]), [["demo.plain", false]]);
  // Un fournisseur qui ne déclare pas each rend le service classique (prudence : données partagées).
  await install(provider("mixed", { service: SVC }));await instance("mixed", "m1");
  assert.deepEqual((await Dep.duplicateServices()).map((d) => d.service).sort(), ["demo.live", "demo.plain"]);
});

test("dépendances : une instance active du service each suffit ; plus aucune → il manque", async () => {
  await install(provider("chan"));
  await install(consumer()); 
  const cons = (await R.getModule("cons")).manifest;
  assert.deepEqual((await Dep.requirementGaps(cons)).map((g) => g.service), [SVC], "module actif mais sans instance");
  await instance("chan", "solo");
  assert.deepEqual(await Dep.requirementGaps(cons), []);
  await instance("chan", "duo");
  await db.prisma.moduleInstance.deleteMany({ where: { key: "solo" } });
  assert.deepEqual(await Dep.requirementGaps(cons), [], "une instance restante suffit");
  await db.prisma.moduleInstance.deleteMany({ where: { key: "duo" } });
  assert.deepEqual((await Dep.requirementGaps(cons)).map((g) => g.reason), ["none"]);
});

test("call : réponse de la PREMIÈRE instance active par ordre de création, jamais un maître, sans réplique", async () => {
  await setup();
  const cons = await active("cons");
  assert.equal((await Dep.callService(cons, SVC, "status", {})).value.who, "z-chan");
  await Dep.setRouting(SVC, { master: "b-chan", replicas: ["a-chan"] });   // un vieux choix d'admin est ignoré
  assert.equal((await Dep.callService(cons, SVC, "status", {})).value.who, "z-chan");
  await db.prisma.moduleInstance.deleteMany({ where: { key: "z-chan" } });
  assert.equal((await Dep.callService(cons, SVC, "status", {})).value.who, "a-chan");
});

test("callAll : une entrée par instance active, dans l'ordre de création, avec clé et nom ; les désactivées sont exclues", async () => {
  await setup();
  const cons = await active("cons");
  const all = await Dep.callServiceAll(cons, SVC, "status", {});
  assert.deepEqual(all.map((r) => [r.instance, r.name, r.ok, r.value?.who]), [["z-chan", "z-chan", true, "z-chan"], ["a-chan", "a-chan", true, "a-chan"], ["b-chan", "b-chan", true, "b-chan"]]);
  await db.prisma.moduleInstance.deleteMany({ where: { key: "a-chan" } });
  assert.deepEqual((await Dep.callServiceAll(await active("cons"), SVC, "status", {})).map((r) => r.instance), ["z-chan", "b-chan"]);
});

test("callAll : un fournisseur qui lève ou n'a pas la méthode n'empêche pas les autres, et son message ne fuit pas", async () => {
  await setup();
  const cons = await active("cons");
  const all = await quiet(() => Dep.callServiceAll(cons, SVC, "boom", {}));
  assert.deepEqual(all.map((r) => [r.instance, r.ok]), [["z-chan", true], ["a-chan", true], ["b-chan", false]]);
  assert.deepEqual(all[2], { instance: "b-chan", name: "b-chan", ok: false, error: "failed" });
  assert.equal(JSON.stringify(all).includes("SECRET123"), false);
  const none = await Dep.callServiceAll(cons, SVC, "inexistante", {});
  assert.deepEqual(none.map((r) => r.error), ["no_method", "no_method", "no_method"]);
});

test("callAll : service non-each → UNE entrée (le maître) ; non déclaré ou inconnu ou sans fournisseur → tableau vide", async () => {
  await install(provider("plain", { service: SVC }, CODE));
  await install(consumer());
  await instance("plain", "p2"); await instance("plain", "p1"); await instance("cons", "form");
  const cons = await active("cons");
  const one = await Dep.callServiceAll(cons, SVC, "status", {});
  assert.deepEqual(one.map((r) => [r.instance, r.ok, r.value?.who]), [["p1", true, "p1"]], "maître par défaut = premier par clé");
  await Dep.setRouting(SVC, { master: "p2", replicas: [] });
  assert.deepEqual((await Dep.callServiceAll(cons, SVC, "status", {})).map((r) => r.instance), ["p2"]);
  assert.deepEqual(await Dep.callServiceAll(cons, "demo.inconnu", "status", {}), []);
  await install(consumer("other", []));await instance("other", "o");
  assert.deepEqual(await Dep.callServiceAll(await active("other"), SVC, "status", {}), [], "non déclaré dans requires");
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "plain" } });
  assert.deepEqual(await Dep.callServiceAll(cons, SVC, "status", {}), []);
});

test("ctx.api.services.callAll : exposé par makeApi, même résultat que le cœur", async () => {
  await setup();
  const row = await db.prisma.moduleInstance.findUnique({ where: { key: "form" }, include: { translations: true } });
  const api = makeApi(toInstanceView(row), "fr", []);
  assert.equal(typeof api.services.callAll, "function");
  assert.deepEqual((await api.services.callAll(SVC, "status")).map((r) => r.instance), ["z-chan", "a-chan", "b-chan"]);
});

test("fakeCtx : callAll (instances réglables, erreur isolée, service inconnu → [])", async () => {
  const ctx = fakeCtx({ serviceInstances: { [SVC]: [{ instance: "a", name: "A", methods: { s: () => 1 } }, { instance: "b", methods: { s: () => { throw new Error("x"); } } }] }, services: { solo: { s: () => 2 } } });
  assert.deepEqual(await ctx.api.services.callAll(SVC, "s"), [{ instance: "a", name: "A", ok: true, value: 1 }, { instance: "b", name: undefined, ok: false, error: "failed" }]);
  assert.equal((await ctx.api.services.callAll("solo", "s")).length, 1);
  assert.deepEqual(await ctx.api.services.callAll("nope", "s"), []);
});
