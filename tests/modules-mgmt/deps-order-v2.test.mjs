import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// v2, contrats 2, 3 et 4 : les `requires` satisfaits AVANT les migrations, besoins facultatifs, choix du fournisseur, origine du catalogue.
// Tous les modules viennent d'un faux catalogue (dépôt git local, un dossier par module, une étiquette par version). Aucun réseau. Noms génériques.
const db = await useTestDb();
const cat = createCatalogue();
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const D = await import("@/core/modules/dataMigrations");
const Dep = await import("@/core/modules/dependencies");
const Plan = await import("@/core/modules/dependencyPlan");
const View = await import("@/core/modules/dependencyView");
const Ver = await import("@/core/modules/serviceVersions");
const Rec = await import("@/core/modules/recognized");
const Bulk = await import("@/core/modules/bulkUpdate");
const Upd = await import("@/core/modules/updateStatus");
const Auto = await import("@/core/modules/autoInstalled");
const { makeApi } = await import("@/core/modules/api");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");

beforeEach(async () => {
  await db.reset(); await cat.clear(); delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
});
after(() => { cat.close(); return db.close(); });
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const SVC = "demo.store";
const SVC2 = "demo.mail";
/** Publie une version d'un module ; l'index annonce ses offres et besoins (comme le fait l'index réel). */
const pub = (id, manifest = {}, code = "export default {};", { listed = true, entry = {} } = {}) => cat.add(id, {
  manifest, listed, files: { "index.mjs": code },
  entry: { ...(manifest.offers ? { offers: manifest.offers } : {}), ...(manifest.requires ? { requires: manifest.requires } : {}), ...entry },
});
const provider = (version, methods = "") => `export default { services: { "${SVC}": { ping: async () => "v${version}", ${methods} } } };`;
const row = (id) => db.prisma.module.findUnique({ where: { id } });
const allModules = async () => (await db.prisma.module.findMany()).map((m) => m.id).sort();
const instance = async (id, nickname) => createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, names: { fr: nickname ?? id }, ...(nickname ? { nickname } : {}) });
const active = async (id) => (await R.getActiveInstances()).find((a) => a.mod.manifest.id === id);
const records = async (instanceId) => (await db.prisma.moduleRecord.findMany({ where: { instanceId }, orderBy: { createdAt: "asc" } })).map((r) => JSON.parse(r.data));

/** Consommateur 1.0.0 (sans données propres), puis 1.1.0 dont la migration 2 APPELLE `SVC.onlyV2` : elle échoue si le fournisseur n'est pas à jour avant elle. */
const consumerV2 = `export default { migrations: { 2: async (ctx) => {
  const r = await ctx.api.services.call("${SVC}", "onlyV2", {});
  if (!r.ok) throw new Error("service not ready: " + r.reason);
  await ctx.api.store.add("log", { saw: r.value });
} } };`;

/* ───────────── Contrat 3 : ordre requires → migrations ───────────── */

test("fournisseur trop ancien : il est mis à jour AVANT que le consommateur migre (la migration voit déjà la version 2)", async () => {
  await pub("prov", { offers: [{ service: SVC }] }, provider(1));
  await pub("cons", { requires: [{ service: SVC }], permissions: ["storage"] });
  assert.equal((await I.installFromCatalogue("cons")).ok, true);
  const inst = await instance("cons");
  await pub("prov", { version: "1.1.0", offers: [{ service: SVC, version: 2 }] }, provider(2, `onlyV2: async () => "fresh"`));
  await pub("cons", { version: "1.1.0", dataVersion: 2, requires: [{ service: SVC, min: 2 }], permissions: ["storage"] }, consumerV2);
  const r = await I.updateModule("cons");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.migrations.map((m) => m.status), ["ok"], "la migration a trouvé le service à jour");
  assert.deepEqual(r.provided, ["prov"], "la mise à jour du fournisseur est rapportée");
  assert.deepEqual([(await row("prov")).version, (await row("cons")).version], ["1.1.0", "1.1.0"]);
  assert.deepEqual(await records(inst.id), [{ saw: "fresh" }]);
  assert.equal(await D.dataVersionOf(inst.id), 2);
  assert.deepEqual((await Auto.readAuto()).prov.for, ["cons"], "marque de la première installation, inchangée");
});

test("fournisseur absent et introuvable : module laissé dans son ancienne version, données intactes, aucune migration", async () => {
  await pub("cons", { permissions: ["storage"] });
  assert.equal((await I.installFromCatalogue("cons")).ok, true);
  const inst = await instance("cons");
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "notes", data: JSON.stringify({ keep: true }) } });
  await pub("cons", { version: "1.1.0", dataVersion: 2, requires: [{ service: SVC, min: 2 }], permissions: ["storage"] }, consumerV2);
  const r = await quiet(() => I.updateModule("cons"));
  assert.deepEqual([r.ok, r.error, r.missing.map((m) => [m.service, m.reason])], [false, "modules.error.requires", [[SVC, "none"]]]);
  assert.equal((await row("cons")).version, "1.0.0");
  assert.equal(await D.dataVersionOf(inst.id), 1, "aucune migration lancée");
  assert.equal(await D.dataStatusOf(inst.id), null, "l'instance n'est pas mise à l'écart : elle tourne toujours");
  assert.deepEqual(await records(inst.id), [{ keep: true }]);
  assert.equal((await R.getModule("cons")).manifest.version, "1.0.0", "l'ancien code est rechargé");
});

test("une migration qui échoue APRÈS l'installation du fournisseur : fournisseur conservé, instance à l'écart, « Réessayer » réussit", async () => {
  await pub("cons", { permissions: ["storage"] });
  await I.installFromCatalogue("cons");
  const inst = await instance("cons");
  await pub("prov", { offers: [{ service: SVC, version: 2 }] }, provider(2, `onlyV2: async () => { throw new Error("pas encore"); }`));
  await pub("cons", { version: "1.1.0", dataVersion: 2, requires: [{ service: SVC, min: 2 }], permissions: ["storage"] }, consumerV2);
  const r = await quiet(() => I.updateModule("cons"));
  assert.equal(r.ok, true);
  assert.deepEqual(r.provided, ["prov"]);
  assert.deepEqual(r.migrations.map((m) => m.status), ["failed"]);
  assert.deepEqual(await allModules(), ["cons", "prov"], "le fournisseur reste : « Réessayer » en a besoin");
  assert.equal((await db.prisma.moduleInstance.count({ where: { moduleId: "prov" } })), 1);
  assert.deepEqual((await Auto.readAuto()).prov.for, ["cons"], "journal validé : marqué « installé automatiquement »");
  assert.equal((await D.dataStatusOf(inst.id)).status, "failed");
  // Le fournisseur est corrigé : « Réessayer » passe.
  await pub("prov", { version: "1.0.1", offers: [{ service: SVC, version: 2 }] }, provider(2, `onlyV2: async () => "ok"`));
  assert.equal((await I.updateModule("prov")).ok, true);
  const retried = await D.retryInstanceMigration(inst.id);
  assert.equal(retried.status, "ok", JSON.stringify(retried));
  assert.deepEqual(await records(inst.id), [{ saw: "ok" }]);
});

test("échec en cours de route (un maillon de la cascade casse) : tout est défait, le module garde son ancienne version", async () => {
  await pub("cons");
  await I.installFromCatalogue("cons");
  await pub("p1", { offers: [{ service: SVC }], requires: [{ service: SVC2 }] });
  await pub("p2", { offers: [{ service: SVC2 }] }, "export default {};", { entry: { subdir: "modules/absent" } });   // dossier qui n'existe pas : le maillon échoue
  await pub("cons", { version: "1.1.0", dataVersion: 2, requires: [{ service: SVC }] }, consumerV2);
  const r = await quiet(() => I.updateModule("cons"));
  assert.deepEqual([r.ok, r.error], [false, "modules.error.requires"]);
  assert.deepEqual([r.missing[0].reason, r.missing[0].module], ["failed", "p2"]);
  assert.deepEqual(await allModules(), ["cons"], "ni p1 ni p2 ne restent");
  assert.equal((await row("cons")).version, "1.0.0");
  assert.deepEqual(await Auto.readAuto(), {});
});

test("cycle pendant une mise à jour : refus propre, aucun des deux modules ne change de version, aucune boucle", async () => {
  await pub("ma", { offers: [{ service: SVC }] });
  await pub("mb", { offers: [{ service: SVC2 }] });
  await I.installFromCatalogue("ma"); await I.installFromCatalogue("mb");
  await instance("mb");   // « ma » n'a pas d'instance : il ne fournit rien tant qu'il n'en a pas
  await pub("ma", { version: "1.1.0", offers: [{ service: SVC, version: 2 }], requires: [{ service: SVC2, min: 2 }] });
  await pub("mb", { version: "1.1.0", offers: [{ service: SVC2, version: 2 }], requires: [{ service: SVC, min: 2 }] });
  const r = await quiet(() => I.updateModule("ma"));
  assert.deepEqual([r.ok, r.error], [false, "modules.error.requires"]);
  assert.deepEqual([(await row("ma")).version, (await row("mb")).version], ["1.0.0", "1.0.0"]);
});

test("versions sautées : les besoins d'une version intermédiaire sont mis en place avant SA migration", async () => {
  const { makeRepo } = await import("../helpers/repo.mjs");
  const fs = await import("node:fs");
  const path = await import("node:path");
  await pub("prov", { offers: [{ service: SVC, version: 2 }] }, provider(2, `onlyV2: async () => "inter"`));
  const man = (version, extra = {}) => JSON.stringify({ apiVersion: 2, id: "jump", name: "Jump", version, main: "index.mjs", permissions: ["storage"], ...extra });
  const repo = makeRepo({ "module.json": man("1.0.0"), "index.mjs": "export default {};" });
  repo.g("tag", "v1.0.0");
  assert.equal((await I.installModule(`${repo.url}#v1.0.0`, { dependencies: false })).ok, true);
  const inst = await instance("jump");
  // 1.1.0 : migration 2 qui appelle le service (besoin ajouté par CETTE version) ; 1.2.0 : plus rien à migrer.
  fs.writeFileSync(path.join(repo.dir, "module.json"), man("1.1.0", { dataVersion: 2, requires: [{ service: SVC, min: 2 }] }));
  fs.writeFileSync(path.join(repo.dir, "index.mjs"), consumerV2);
  repo.g("commit", "-qam", "1.1.0"); repo.g("tag", "v1.1.0");
  fs.writeFileSync(path.join(repo.dir, "module.json"), man("1.2.0", { dataVersion: 2, requires: [{ service: SVC, min: 2 }] }));
  repo.g("commit", "-qam", "1.2.0"); repo.g("tag", "v1.2.0");
  const r = await I.updateModule("jump");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.provided, ["prov"]);
  assert.equal((await row("jump")).version, "1.2.0");
  assert.deepEqual(await records(inst.id), [{ saw: "inter" }], "la migration de 1.1.0 a trouvé le fournisseur");
});

test("orderForUpdate : chaîne, cycle, modules indépendants, besoins facultatifs", () => {
  const m = (id, offers = [], needs = []) => ({ id, offers: offers.map((s) => ({ service: s, version: 1 })), needs: needs.map((s) => ({ service: s, min: 1 })) });
  assert.deepEqual(Bulk.orderForUpdate([m("c", [], ["s.b"]), m("b", ["s.b"], ["s.a"]), m("a", ["s.a"])]), ["a", "b", "c"], "chaîne : fournisseurs d'abord");
  assert.deepEqual(Bulk.orderForUpdate([m("z"), m("k"), m("b")]), ["b", "k", "z"], "indépendants : par identifiant");
  assert.deepEqual(Bulk.orderForUpdate([m("q", ["s.q"], ["s.p"]), m("x"), m("p", ["s.p"], ["s.q"])]), ["x", "q", "p"], "cycle : après les autres, ordre d'origine");
  assert.deepEqual(Bulk.orderForUpdate([m("cons", [], ["s.a"]), m("cons", [], ["s.a"]), m("prov", ["s.a"])]), ["prov", "cons"], "doublon écarté");
  const versioned = [{ id: "cons", offers: [], needs: [{ service: "s.a", min: 2 }] }, { id: "old", offers: [{ service: "s.a", version: 1 }], needs: [] }];
  assert.deepEqual(Bulk.orderForUpdate(versioned), ["cons", "old"], "un fournisseur trop ancien n'est pas un fournisseur");
  assert.deepEqual(Bulk.orderForUpdate([{ id: "a", offers: [], needs: [{ service: "s.b", min: 1, optional: true }] }, m("b", ["s.b"])]), ["b", "a"], "facultatif : ordonné aussi");
});

test("« Tout mettre à jour » : le fournisseur passe avant son consommateur, même demandé après lui", async () => {
  await pub("prov", { offers: [{ service: SVC }] }, provider(1));
  await pub("cons", { requires: [{ service: SVC }], permissions: ["storage"] });
  await I.installFromCatalogue("cons");
  const inst = await instance("cons");
  await pub("prov", { version: "1.1.0", offers: [{ service: SVC, version: 2 }] }, provider(2, `onlyV2: async () => "bulk"`));
  await pub("cons", { version: "1.1.0", dataVersion: 2, requires: [{ service: SVC, min: 2 }], permissions: ["storage"] }, consumerV2);
  const seen = [];
  const s = await Upd.updateModules(["cons", "prov"], async (id) => { seen.push(id); });
  assert.deepEqual(seen, ["prov", "cons"]);
  assert.deepEqual([s.updated, s.failed, s.stoppedOn], [["prov", "cons"], [], null]);
  assert.deepEqual(await records(inst.id), [{ saw: "bulk" }]);
});

/* ───────────── Contrat 2 : besoins facultatifs ───────────── */

test("facultatif : manifeste et index le gardent (true seulement) ; il ne manque jamais et n'entre ni dans le plan ni dans la cascade", async () => {
  assert.deepEqual(Ver.sanitizeServiceList([{ service: SVC, optional: true }, { service: SVC2, optional: "yes" }, { service: "x.y", optional: true, min: 2 }], "min"),
    [{ service: SVC, optional: true }, { service: SVC2 }, { service: "x.y", min: 2, optional: true }]);
  assert.deepEqual(Ver.sanitizeServiceList([{ service: SVC, optional: true }], "version"), [{ service: SVC }], "jamais sur une offre");
  assert.deepEqual(Ver.normalizeNeeds([{ service: SVC, optional: true }, { service: SVC2, optional: false }]), [{ service: SVC, min: 1, optional: true }, { service: SVC2, min: 1 }]);
  const [e] = Rec.sanitizeEntries([{ id: "aa", name: "A", description: "", repo: "https://github.com/x/aa", requires: [{ service: SVC, optional: true }] }]);
  assert.deepEqual(e.needs, [{ service: SVC, optional: true }]);

  await pub("prov", { offers: [{ service: SVC }] });
  await pub("cons", { requires: [{ service: SVC, optional: true }] });
  const plan = await Plan.planDependencies("cons", [{ service: SVC, min: 1, optional: true }]);
  assert.deepEqual([plan.steps, plan.problems], [[], []]);
  const view = await View.viewPlan("cons", [{ service: SVC, min: 1, optional: true }], await View.buildNames("fr", "fr"));
  assert.deepEqual([view.lines, view.optional.map((o) => [o.service, o.present])], [[], [[SVC, false]]], "« Fonctionne mieux avec… (facultatif) »");
  const r = await I.installFromCatalogue("cons");
  assert.deepEqual([r.ok, r.provided], [true, undefined], "aucune cascade");
  assert.deepEqual(await allModules(), ["cons"], "le fournisseur facultatif n'est JAMAIS installé d'office");
  assert.deepEqual(await Dep.requirementGaps((await R.getModule("cons")).manifest), [], "jamais « Il manque »");
});

test("facultatif : désinstaller son fournisseur est permis ; celui d'un besoin dur est refusé ; l'appel dégrade en « unavailable »", async () => {
  await pub("prov", { offers: [{ service: SVC }] }, provider(1));
  await pub("soft", { requires: [{ service: SVC, optional: true }] });
  await pub("hard", { requires: [{ service: SVC }] });
  await I.installFromCatalogue("prov"); await instance("prov");
  await I.installFromCatalogue("soft"); await instance("soft");
  assert.deepEqual(await Dep.callService(await active("soft"), SVC, "ping", {}), { ok: true, value: "v1" }, "l'appel est permis tant qu'un fournisseur existe");
  assert.deepEqual(await Dep.dependentsOf("prov"), []);
  assert.deepEqual(await Dep.lossesIfStopped("prov"), []);
  await I.installFromCatalogue("hard");
  assert.deepEqual(await Dep.dependentsOf("prov"), ["hard"]);
  assert.equal((await I.uninstallModule("prov", { keepData: false })).error, "modules.error.requiredBy");
  assert.equal((await I.uninstallModule("hard", { keepData: false })).ok, true);
  assert.equal((await I.uninstallModule("prov", { keepData: false })).ok, true, "seul un besoin facultatif reste : permis");
  assert.deepEqual(await Dep.callService(await active("soft"), SVC, "ping", {}), { ok: false, reason: "unavailable" });
});

/* ───────────── Contrat 2 : providers() et call(…, { provider }) ───────────── */

test("providers : ordre de création, maître signalé, [] si non déclaré ; call ciblé, fournisseur étranger ou disparu → unavailable", async () => {
  const writer = (tag) => `export default { services: { "${SVC}": { ping: async (ctx) => "${tag}:" + ctx.instance.key, write: async (ctx) => { await ctx.api.store.add("w", { by: ctx.instance.key }); return ctx.instance.key; } } } };`;
  await pub("pa", { offers: [{ service: SVC }], permissions: ["storage"] }, writer("a"));
  await pub("pb", { offers: [{ service: SVC }], permissions: ["storage"] }, writer("b"));
  await pub("other", { offers: [{ service: SVC2 }] }, `export default { services: { "${SVC2}": { ping: async () => "x" } } };`);
  await pub("cons", { requires: [{ service: SVC }] });
  for (const id of ["pb", "pa", "other", "cons"]) await I.installFromCatalogue(id, { dependencies: false });
  const b = await instance("pb", "second"); await new Promise((r) => setTimeout(r, 5));
  const a = await instance("pa", "first");
  const o = await instance("other");
  await instance("cons");
  const consumer = await active("cons");
  await Dep.setRouting(SVC, { master: a.key, replicas: [b.key] });
  const list = await Dep.providersOf(consumer, SVC, "fr");
  assert.deepEqual(list.map((p) => [p.id, p.module, p.master, p.each, p.version]), [[b.id, "pb", false, false, 1], [a.id, "pa", true, false, 1]], "ordre de création ; maître = celui que `call` vise");
  assert.equal(list[0].name, "second");
  assert.deepEqual(await Dep.providersOf(consumer, SVC2), [], "non déclaré : []");
  // Ciblé vers un non-maître : lui seul répond, aucune réplique n'est appelée.
  assert.deepEqual(await Dep.callService(consumer, SVC, "write", {}, "fr", { provider: b.id }), { ok: true, value: b.key });
  assert.deepEqual([(await records(a.id)).length, (await records(b.id)).length], [0, 1], "le maître n'a rien reçu");
  // Vers le maître : comportement habituel, répliques comprises.
  assert.deepEqual(await Dep.callService(consumer, SVC, "write", {}, "fr", { provider: a.id }), { ok: true, value: a.key });
  assert.deepEqual([(await records(a.id)).length, (await records(b.id)).length], [1, 2]);
  // Étranger (instance d'un autre service), inconnu, ou disparu : unavailable, rien n'est appelé.
  assert.deepEqual(await quiet(() => Dep.callService(consumer, SVC, "ping", {}, "fr", { provider: o.id })), { ok: false, reason: "unavailable" });
  assert.deepEqual(await quiet(() => Dep.callService(consumer, SVC, "ping", {}, "fr", { provider: "nope" })), { ok: false, reason: "unavailable" });
  await db.prisma.moduleInstance.delete({ where: { id: b.id } });
  assert.deepEqual(await quiet(() => Dep.callService(consumer, SVC, "ping", {}, "fr", { provider: b.id })), { ok: false, reason: "unavailable" });
  assert.deepEqual((await Dep.callService(consumer, SVC, "ping", {}, "fr")), { ok: true, value: `a:${a.key}` }, "sans provider : inchangé");
});

test("providers / call via ctx.api : service each sans provider → première instance ; avec provider → l'instance choisie", async () => {
  const each = `export default { services: { "${SVC}": { ping: async (ctx) => ctx.instance.key } } };`;
  await pub("chan", { instances: "multiple", offers: [{ service: SVC, each: true }] }, each);
  await pub("cons", { requires: [{ service: SVC }] });
  await I.installFromCatalogue("chan", { dependencies: false }); await I.installFromCatalogue("cons", { dependencies: false });
  const one = await instance("chan", "one"); await new Promise((r) => setTimeout(r, 5));
  const two = await instance("chan", "two");
  const c = await instance("cons");
  const view = (await import("@/core/instances")).getInstanceById;
  const api = makeApi(await view(c.id), "fr");
  const list = await api.services.providers(SVC);
  assert.deepEqual(list.map((p) => [p.id, p.each, p.master]), [[one.id, true, true], [two.id, true, false]]);
  assert.deepEqual(await api.services.call(SVC, "ping", {}), { ok: true, value: one.key }, "règle inchangée : la première par ordre de création");
  assert.deepEqual(await api.services.call(SVC, "ping", {}, { provider: two.id }), { ok: true, value: two.key });
  assert.deepEqual(await api.services.providers("pas.declare"), []);
});

/* ───────────── Contrat 4 : origine du catalogue ───────────── */

/** L'index supplémentaire (MODULES_INDEX_URL) : ses entrées pointent vers des modules publiés dans le dépôt de test mais absents de l'index officiel. */
async function extraIndex(...items) {
  process.env.MODULES_INDEX_URL = "https://index.example/extra.json";
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url) === process.env.MODULES_INDEX_URL ? Response.json(items) : real(url, init));
  Rec.clearRecognizedCache();
  return () => { globalThis.fetch = real; delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache(); };
}

test("origine : official / extra ; l'officiel classé d'abord ; une entrée extra n'est jamais installée par la cascade (raison « extra »)", async () => {
  const extraEntry = await pub("xprov", { offers: [{ service: SVC }] }, provider(1), { listed: false });
  await pub("cons", { requires: [{ service: SVC }] });
  const restore = await extraIndex({ ...extraEntry, offers: [SVC] });
  try {
    const { getCatalogue } = await import("@/core/modules/catalogue");
    const market = await getCatalogue();
    assert.deepEqual(market.map((e) => [e.id, e.origin]).sort(), [["cons", "official"], ["xprov", "extra"]]);
    const ranked = Plan.rankCandidates({ service: SVC, min: 1 }, [], [{ ...market.find((e) => e.id === "xprov") }, { id: "off", origin: "official", compatible: true, offers: [{ service: SVC, version: 1 }] }], new Set());
    assert.deepEqual(ranked.map((c) => c.id), ["off", "xprov"], "l'officiel avant l'extra, même placé après dans la liste");
    const plan = await Plan.planDependencies("cons", [{ service: SVC, min: 1 }]);
    assert.deepEqual(plan.problems.map((p) => [p.reason, p.module]), [["extra", "xprov"]]);
    const r = await I.installFromCatalogue("cons");
    assert.deepEqual([r.ok, r.missing.map((m) => [m.reason, m.module])], [false, [["extra", "xprov"]]]);
    assert.deepEqual(await allModules(), [], "rien d'installé");
    assert.equal((await I.installFromCatalogue("xprov")).error, "modules.error.extraConfirm", "installation directe : confirmation exigée");
    assert.equal((await I.installFromCatalogue("xprov", { confirmExtra: true })).ok, true, "le propriétaire a confirmé");
    assert.equal((await I.installFromCatalogue("cons")).ok, true, "installé à la main, il sert ensuite de fournisseur");
  } finally { restore(); }
});
