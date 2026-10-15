import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Le cœur n'embarque aucun module : TOUS les modules de ces tests viennent d'un catalogue (dépôts git locaux joints par une adresse https réécrite vers eux, index factice). Aucun réseau.
const db = await useTestDb();
const GITCONF = process.env.GIT_CONFIG_GLOBAL;
const cat = createCatalogue();
const BASE_GITCONF = fs.readFileSync(process.env.GIT_CONFIG_GLOBAL, "utf8");
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Dep = await import("@/core/modules/dependencies");
const Auto = await import("@/core/modules/autoInstalled");
const Plan = await import("@/core/modules/dependencyPlan");
const View = await import("@/core/modules/dependencyView");
const Msg = await import("@/core/modules/dependencyMessages");
const Ver = await import("@/core/modules/serviceVersions");
const Rec = await import("@/core/modules/recognized");
const Bulk = await import("@/core/modules/bulkUpdate");
const Upd = await import("@/core/modules/updateStatus");
const Rs = await import("@/core/backup/restore");
const RD = await import("@/core/backup/restoreDeps");
const { parseManifest } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");

/** Les entrées de l'index servi par le faux catalogue : id → entrée (dans l'ordre où elles ont été publiées). */
const listed = new Map();
const repos = new Map();
const publishIndex = () => { cat.writeIndex(...listed.values()); Rec.clearRecognizedCache(); };

beforeEach(async () => {
  await db.reset();
  await cat.clear();
  listed.clear(); repos.clear();
  fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, BASE_GITCONF);
  Rec.clearRecognizedCache();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
});
after(() => { cat.close(); return db.close(); });
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const SVC = "demo.store";
const SVC2 = "demo.mail";
const code = (service = SVC) => `export default { services: { "${service}": { add: async (ctx, args) => ({ by: ctx.instance.key }) } } };`;
const manifestOf = (id, extra = {}) => ({ apiVersion: 2, id, name: id.toUpperCase(), version: "1.0.0", main: "index.mjs", ...extra });

/** Module du catalogue annoncé par l'index (offers/requires compris) ; le republier avec une autre version commite dans le même dépôt. */
function bundled(id, extra = {}, main = code()) {
  let repo = repos.get(id);
  if (!repo) {
    repo = makeRepo({ "module.json": manifestOf(id, extra), "index.mjs": main });
    repos.set(id, repo);
    fs.appendFileSync(GITCONF, `[url "${repo.url}"]\n\tinsteadOf = https://github.com/t/${id}\n`);
  } else {
    fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifestOf(id, extra)));
    fs.writeFileSync(path.join(repo.dir, "index.mjs"), main);
    repo.g("add", "-A"); repo.g("commit", "-q", "--allow-empty", "--no-verify", "-m", `${id} ${extra.version ?? "1.0.0"}`);
  }
  const entry = { id, name: id.toUpperCase(), description: "d", repo: `https://github.com/t/${id}`, version: extra.version ?? "1.0.0", apiVersion: 2 };
  if (extra.offers) entry.offers = extra.offers.map((o) => (o.version ? o : o.service));
  if (extra.requires) entry.requires = extra.requires.map((r) => (r.min ? r : r.service));
  listed.set(id, entry);
  publishIndex();
}
/** Module d'un dépôt reconnu : un vrai dépôt git local, joint par son adresse https (réécrite vers le dépôt local). Renvoie l'entrée d'index. */
function remote(id, extra = {}, { announce = true, files = {} } = {}) {
  const repo = makeRepo({ "module.json": manifestOf(id, extra), "index.mjs": code(), ...files });
  const https = `https://github.com/t/${id}`;
  fs.appendFileSync(GITCONF, `[url "${repo.url}"]\n\tinsteadOf = ${https}\n`);
  const entry = { id, name: id.toUpperCase(), description: "d", repo: https };
  if (announce) {
    if (extra.offers) entry.offers = extra.offers.map((o) => (o.version ? o : o.service));
    if (extra.requires) entry.requires = extra.requires.map((r) => (r.min ? r : r.service));
  }
  return { repo, entry };
}
function setIndex(...entries) { for (const e of entries) listed.set(e.id, e); publishIndex(); }
const row = (id) => db.prisma.module.findUnique({ where: { id } });
const insts = (id) => db.prisma.moduleInstance.findMany({ where: { moduleId: id }, orderBy: { key: "asc" } });
const active = async (id) => (await R.getActiveInstances()).find((a) => a.mod.manifest.id === id);
const allModules = async () => (await db.prisma.module.findMany()).map((m) => m.id).sort();

/* ───────────── B10 : versions de services ───────────── */

test("versions : offers.version et requires.min (entier ≥ 1, facultatifs), anciens manifestes inchangés", () => {
  const m = (extra) => ({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", ...extra });
  const ok = parseManifest(m({ offers: [{ service: SVC, version: 2 }], requires: [{ service: SVC2, min: 3 }] }));
  assert.ok(ok.ok);
  assert.deepEqual([ok.manifest.offers[0].version, ok.manifest.requires[0].min], [2, 3]);
  for (const bad of [0, -1, 1.5, "2", null]) {
    assert.equal(parseManifest(m({ offers: [{ service: SVC, version: bad }] })).ok, false, `version ${bad}`);
    assert.equal(parseManifest(m({ requires: [{ service: SVC, min: bad }] })).ok, false, `min ${bad}`);
  }
  const old = parseManifest(m({ offers: [{ service: SVC }], requires: [{ service: SVC2, label: { en: "Mail" } }] }));
  assert.ok(old.ok);
  assert.equal("version" in old.manifest.offers[0], false, "rien n'est ajouté à un ancien manifeste");
  assert.deepEqual(Ver.normalizeOffers(old.manifest.offers), [{ service: SVC, version: 1 }], "défaut : version 1");
  assert.deepEqual(Ver.normalizeNeeds(old.manifest.requires), [{ service: SVC2, min: 1 }]);
  assert.equal(Ver.satisfiesVersion(1, 1), true);
  assert.equal(Ver.satisfiesVersion(1, 2), false);
  assert.equal(Ver.satisfiesVersion(null, 1), false);
});

test("index du catalogue : offers / requires en liste de services (texte ou objet), valeurs validées, clés inconnues ignorées, requires { core } intact", () => {
  const e = (extra) => ({ id: "aa", name: "A", description: "", repo: "https://github.com/x/aa", ...extra });
  const [a] = Rec.sanitizeEntries([e({ offers: [SVC, { service: SVC2, version: 2 }, { service: "Pas Valide" }, 42, { service: SVC }], requires: [SVC2, { service: SVC, min: 3 }, { service: SVC, min: 0 }] })]);
  assert.deepEqual(a.offers, [{ service: SVC }, { service: SVC2, version: 2 }]);
  assert.deepEqual(a.needs, [{ service: SVC2 }, { service: SVC, min: 3 }]);
  assert.equal(a.requires, undefined, "la liste n'est pas une exigence de cœur");
  const [b] = Rec.sanitizeEntries([e({ requires: { core: "0.1.10" }, inconnu: 1 })]);
  assert.deepEqual([b.requires, b.needs, b.offers], [{ core: "0.1.10" }, undefined, undefined]);
  const [c] = Rec.sanitizeEntries([e({ offers: "contact.store", requires: [["x"]] })]);
  assert.deepEqual([c.offers, c.needs], [undefined, []]);
  assert.equal(Rec.sanitizeEntries([e({ offers: Array.from({ length: 30 }, (_, i) => `s${i}.x`) })])[0].offers.length, 10);
});

test("versions : un fournisseur trop ancien ne satisfait pas ; message dédié ; la mise à jour du fournisseur lève le blocage", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC, min: 2 }] });
  const refused = await I.installFromCatalogue("cons");
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.missing.map((m) => [m.service, m.min, m.have, m.reason]), [[SVC, 2, 1, "old"]]);
  assert.deepEqual(await allModules(), [], "rien d'installé");
  const names = { module: (id) => id.toUpperCase(), service: () => "Contacts" };
  const t = (k, v) => `${k}|${JSON.stringify(v ?? {})}`;
  assert.equal(Msg.describeMissing(refused.missing[0], t, names), 'deps.missing.old|{"name":"Contacts","min":2,"have":1}');

  // Le fournisseur évolue (version 2 de l'interface) : le blocage est levé.
  bundled("prov", { version: "1.1.0", offers: [{ service: SVC, version: 2 }] });
  const ok = await I.installFromCatalogue("cons");
  assert.deepEqual([ok.ok, ok.provided], [true, ["prov"]]);
  assert.deepEqual(await Dep.requirementGaps((await R.getModule("cons")).manifest), []);
});

test("versions : un module installé en version 1 est mis à jour en version 2 → le consommateur peut s'activer ; appel de service filtré par version", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  assert.equal((await I.installFromCatalogue("cons")).ok, true);
  await createInstance(db.prisma, { manifest: (await R.getModule("cons")).manifest, names: { fr: "c" } });
  assert.equal((await Dep.callService(await active("cons"), SVC, "add", {})).ok, true, "min par défaut 1");
  // le consommateur monte son exigence (mise à jour) sans que le fournisseur suive : appel indisponible, manque signalé
  bundled("cons", { version: "1.1.0", requires: [{ service: SVC, min: 2 }] });
  await I.updateModule("cons");
  const gaps = await Dep.requirementGaps((await R.getModule("cons")).manifest);
  assert.deepEqual(gaps.map((g) => [g.reason, g.min, g.have]), [["old", 2, 1]]);
  assert.deepEqual(await Dep.callService(await active("cons"), SVC, "add", {}), { ok: false, reason: "unavailable" });
  bundled("prov", { version: "1.1.0", offers: [{ service: SVC, version: 2 }] });
  await I.updateModule("prov");
  assert.deepEqual(await Dep.requirementGaps((await R.getModule("cons")).manifest), []);
  assert.equal((await Dep.callService(await active("cons"), SVC, "add", {})).ok, true);
});

/* ───────────── B6 : cascade avec instance par défaut, marques « automatique » ───────────── */

test("installer un consommateur installe le fournisseur du catalogue, l'active et lui donne son instance (multiple)", async () => {
  bundled("prov", { instances: "multiple", offers: [{ service: SVC, label: { fr: "Carnet" } }] });
  bundled("cons", { requires: [{ service: SVC }] });
  const r = await I.installFromCatalogue("cons");
  assert.deepEqual([r.ok, r.provided], [true, ["prov"]]);
  assert.deepEqual([(await row("prov")).enabled, (await row("cons")).enabled], [true, true], "installé = actif");
  const mine = await insts("prov");
  assert.equal(mine.length, 1);
  assert.equal(await Auto.hasUserData("prov"), false);
  assert.deepEqual(await Auto.readAuto(), { prov: { for: ["cons"], module: true, instances: [mine[0].id], at: (await Auto.readAuto()).prov.at } });
  // Le service fonctionne tout de suite
  await createInstance(db.prisma, { manifest: (await R.getModule("cons")).manifest, names: { fr: "form" } });
  const call = await Dep.callService(await active("cons"), SVC, "add", {});
  assert.deepEqual([call.ok, call.value.by], [true, mine[0].key]);
});

test("fournisseur 'single' : une seule instance, jamais deux", async () => {
  bundled("prov", { instances: "single", offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  bundled("cons2", { requires: [{ service: SVC }] });
  assert.equal((await I.installFromCatalogue("cons")).ok, true);
  assert.equal((await I.installFromCatalogue("cons2")).ok, true, "le second consommateur trouve déjà le fournisseur actif");
  assert.equal((await insts("prov")).length, 1);
  assert.deepEqual((await Auto.readAuto()).prov.for, ["cons"], "marqué pour le premier seulement : le second n'a rien apporté");
});

test("mise en place : fournisseur installé sans instance → instance créée ; instance supprimée depuis → recréée", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  // 1) installé, désactivé, aucune instance
  assert.equal((await I.installFromCatalogue("prov", { dependencies: false })).ok, true);
  assert.equal((await I.installFromCatalogue("cons", { dependencies: false })).ok, true);
  let r = await I.repairRequirements("cons");
  assert.deepEqual([r.ok, r.provided], [true, ["prov"]]);
  assert.deepEqual([(await row("prov")).enabled, (await insts("prov")).length], [true, 1]);
  const auto = (await Auto.readAuto()).prov;
  assert.deepEqual([auto.module, auto.for], [false, ["cons"]], "installé par l'admin : seule l'instance est automatique");
  assert.equal(auto.instances.length, 1);
  // 2) module activé SANS instance (le cas des sites existants)

  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "prov" } });
  assert.equal((await Dep.requirementGaps((await R.getModule("cons")).manifest)).length, 1, "un module actif sans instance ne fournit rien");
  r = await I.repairRequirements("cons");
  assert.equal(r.ok, true);
  assert.equal((await insts("prov")).length, 1);
  // 3) (l'ancien cas « instance éteinte rallumée » n'existe plus : une instance est là ou elle n'y est pas)
});

test("un module installé À LA MAIN n'est jamais marqué automatique ; un module déjà actif avec instance ne change pas", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  await I.installFromCatalogue("prov", { dependencies: false });
  await createInstance(db.prisma, { manifest: (await R.getModule("prov")).manifest, names: { fr: "carnet" } });
  assert.equal((await I.installFromCatalogue("cons")).provided, undefined);
  assert.deepEqual(await Auto.readAuto(), {});
  assert.equal((await insts("prov")).length, 1);
});

/* ───────────── B1/B2 : résolution depuis le catalogue reconnu ───────────── */

test("catalogue reconnu : l'index annonce offers/requires → le fournisseur est cloné, activé, avec son instance (avant le consommateur)", async () => {
  const prov = remote("rprov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  setIndex(prov.entry);
  const entry = (await (await import("@/core/modules/catalogue")).findCatalogueEntry("rprov"));
  assert.deepEqual(entry.offers, [{ service: SVC, version: 1 }]);
  // Aperçu AVANT d'installer
  const names = await View.buildNames("fr", "fr");
  const view = await View.viewPlan("cons", [{ service: SVC, min: 1 }], names);
  assert.deepEqual(view.lines.map((l) => [l.id, l.action]), [["rprov", "install"]]);
  assert.equal(view.adds, true);
  const r = await I.installFromCatalogue("cons");
  assert.deepEqual([r.ok, r.provided], [true, ["rprov"]]);
  assert.deepEqual([(await row("rprov")).source, (await row("rprov")).enabled, (await insts("rprov")).length], ["git", true, 1]);
  assert.deepEqual((await Auto.readAuto()).rprov.module, true);
});

test("catalogue reconnu : le consommateur lui-même vient d'un dépôt reconnu, ses besoins sont lus dans son manifeste réel (l'index n'en disait rien)", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  const cons = remote("rcons", { requires: [{ service: SVC }] }, { announce: false });
  setIndex(cons.entry);
  const r = await I.installFromCatalogue("rcons");
  assert.deepEqual([r.ok, r.provided], [true, ["prov"]]);
  assert.deepEqual(await allModules(), ["prov", "rcons"]);
});

test("dépôt personnel : son installation résout aussi ses besoins (fournisseur du catalogue), jamais l'inverse", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  const perso = makeRepo({ "module.json": manifestOf("perso", { requires: [{ service: SVC }] }), "index.mjs": "export default {};" });
  const r = await I.installModule(perso.url);
  assert.deepEqual([r.ok, r.provided], [true, ["prov"]]);
  assert.deepEqual([(await row("prov")).enabled, (await row("perso")).enabled], [true, true]);
});

test("choix du fournisseur : un module déjà installé d'abord, puis le premier du catalogue (dans l'ordre de l'index)", () => {
  const entry = (id, offers) => ({ id, kind: "recognized", compatible: true, offers: offers ?? [{ service: SVC, version: 1 }] });
  const catalogue = [entry("b-un"), entry("a-deux"), entry("z-trois"), entry("m-quatre"), { ...entry("ancien"), compatible: false }, { ...entry("trop-neuf"), needsNewerCore: "9.9.9" }, entry("autre", [{ service: SVC2, version: 1 }])];
  const need = { service: SVC, min: 1 };
  const order = (installed, exclude = []) => Plan.rankCandidates(need, installed, catalogue, new Set(exclude)).map((c) => c.id);
  assert.deepEqual(order([]), ["b-un", "a-deux", "z-trois", "m-quatre"], "ordre de l'index (stable), incompatibles écartés");
  const inst = (id) => ({ id, offers: [{ service: SVC, version: 1 }] });
  assert.deepEqual(order([inst("zz"), inst("bb"), inst("aa")]), ["aa", "bb", "zz", "b-un", "a-deux", "z-trois", "m-quatre"], "installés : par identifiant");
  assert.deepEqual(order([], ["b-un"]).slice(0, 1), ["a-deux"], "le module qui demande n'est jamais son propre fournisseur");
  assert.deepEqual(Plan.rankCandidates({ service: SVC, min: 2 }, [], catalogue, new Set()), [], "version insuffisante : pas candidat");
});

test("deux fournisseurs déjà actifs : rien n'est choisi ni installé (le mécanisme maître/répliques décide)", async () => {
  bundled("prov-a", { offers: [{ service: SVC }] }); bundled("prov-b", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  for (const id of ["prov-a", "prov-b"]) { await I.installFromCatalogue(id, { dependencies: false });await createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: id, names: { fr: id } }); }
  const r = await I.installFromCatalogue("cons");
  assert.deepEqual([r.ok, r.provided], [true, undefined]);
  assert.equal((await Dep.duplicateServices()).length, 1, "le doublon reste à arbitrer par l'admin");
});

/* ───────────── Échecs : cycle, profondeur, maillon qui casse ───────────── */

test("cycle : deux modules qui se demandent l'un l'autre → refus clair, rien d'installé", async () => {
  bundled("ca", { offers: [{ service: SVC }], requires: [{ service: SVC2 }] });
  bundled("cb", { offers: [{ service: SVC2 }], requires: [{ service: SVC }] });
  const r = await I.installFromCatalogue("ca");
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => [m.reason, m.chain]), [["cycle", ["ca", "cb", "ca"]]]);
  assert.deepEqual(await allModules(), []);
  assert.deepEqual(await Auto.readAuto(), {});
});

test("profondeur : trois fournisseurs enchaînés passent, quatre sont refusés (rien de laissé)", async () => {
  const chain = (n) => {
    for (let i = 0; i <= n; i++) bundled(`m${i}`, { offers: [{ service: `chain.s${i}` }], ...(i < n ? { requires: [{ service: `chain.s${i + 1}` }] } : {}) });
  };
  chain(3);   // m0 → m1 → m2 → m3 : trois fournisseurs
  const ok = await I.installFromCatalogue("m0");
  assert.equal(ok.ok, true);
  assert.deepEqual(await allModules(), ["m0", "m1", "m2", "m3"]);
  assert.deepEqual([(await row("m3")).enabled, (await insts("m3")).length], [true, 1], "chaque maillon actif a son instance");
  await db.reset(); listed.clear(); publishIndex();
  chain(4);
  const refused = await I.installFromCatalogue("m0");
  assert.equal(refused.ok, false);
  assert.equal(refused.missing[0].reason, "depth");
  assert.deepEqual(await allModules(), []);
});

test("échec au milieu de la chaîne : rien n'est laissé à moitié, le message dit quel maillon et pourquoi", async () => {
  bundled("p1", { offers: [{ service: SVC }], requires: [{ service: SVC2 }] });
  // p2 est annoncé par l'index mais son dépôt ne sert pas ce module : l'installation du maillon échoue
  const bad = remote("p2", { offers: [{ service: SVC2 }] }, { files: { "module.json": manifestOf("autre-id", { offers: [{ service: SVC2 }] }) } });
  setIndex(bad.entry);
  bundled("cons", { requires: [{ service: SVC }] });
  const r = await quiet(() => I.installFromCatalogue("cons"));
  assert.equal(r.ok, false);
  assert.equal(r.error, "modules.error.requires");
  const failed = r.missing[0];
  assert.deepEqual([failed.reason, failed.module, failed.error], ["failed", "p2", "modules.error.idmismatch"]);
  assert.deepEqual(await allModules(), [], "ni p1, ni cons, ni p2");
  assert.equal(await db.prisma.moduleInstance.count(), 0);
  assert.deepEqual(await Auto.readAuto(), {});
  assert.equal(fs.existsSync(path.join(db.dir, "modules", "p1")), false, "fichiers de p1 retirés aussi");
});

test("un candidat qui ment (l'index annonce un service que le manifeste n'offre pas) est défait, le suivant est essayé", async () => {
  const liar = remote("liar", {}, {});
  liar.entry.offers = [SVC];
  bundled("honnete", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  setIndex(liar.entry);
  // le livré passe avant le reconnu : le menteur n'est jamais essayé
  assert.equal((await I.installFromCatalogue("cons")).provided[0], "honnete");
  await db.reset(); listed.delete("honnete"); publishIndex();
  const r = await I.installFromCatalogue("cons");
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].error, "modules.error.serviceMismatch");
  assert.deepEqual(await allModules(), []);
});

test("rien n'est disponible : refus avec le service manquant (aucun module installé)", async () => {
  bundled("cons", { requires: [{ service: SVC, label: { fr: "Carnet" } }] });
  const r = await I.installFromCatalogue("cons");
  assert.deepEqual([r.ok, r.error, r.detail, r.missing[0].reason], [false, "modules.error.requires", SVC, "none"]);
  assert.deepEqual(await allModules(), []);
  const view = await View.viewPlan("cons", [{ service: SVC, min: 1 }], await View.buildNames("fr", "fr"));
  assert.deepEqual(view.problems.map((p) => p.reason), ["none"]);
});

/* ───────────── B5 : refus lisibles ───────────── */

test("refus de désinstaller : les modules qui en dépendent, par leur nom, et ce qu'ils perdraient", async () => {
  bundled("prov", { name: "Contacts", offers: [{ service: SVC, label: { fr: "le carnet de contacts" } }] });
  bundled("cons", { name: "Partenariats", requires: [{ service: SVC }] });
  await I.installFromCatalogue("cons");
  const un = await I.uninstallModule("prov", { keepData: false });
  assert.deepEqual([un.ok, un.error], [false, "modules.error.requiredBy"]);
  const names = await View.buildNames("fr", "fr");
  assert.deepEqual([names.module("cons"), names.service(SVC)], ["Partenariats", "le carnet de contacts"], "ni identifiant ni nom technique");
  const links = await View.viewModuleLinks("prov", names);
  assert.deepEqual(links.losses, [{ module: "cons", name: "Partenariats", services: ["le carnet de contacts"] }]);
  assert.deepEqual(links.usedBy.map((u) => [u.name, u.services]), [["Partenariats", ["le carnet de contacts"]]]);
  const consLinks = await View.viewModuleLinks("cons", names);
  assert.deepEqual(consLinks.needs.map((n) => [n.label, n.ok, n.providers.map((p) => [p.name, p.active])]), [["le carnet de contacts", true, [["Contacts", true]]]]);
  assert.equal(consLinks.autoFor, null, "cons installé à la main : pas de mention automatique");
  assert.deepEqual((await View.viewModuleLinks("prov", names)).autoFor, ["Partenariats"]);
});

test("messages : phrases lisibles, transport d'adresse validé (entrée d'URL non fiable)", () => {
  const t = (k, v) => `${k}${v ? "|" + Object.entries(v).map(([a, b]) => `${a}=${b}`).join(",") : ""}`;
  const names = { module: (id) => `M(${id})`, service: (s) => `S(${s})` };
  assert.equal(Msg.describeMissing({ service: SVC, min: 1, have: null, reason: "none" }, t, names), "deps.missing.none|name=S(demo.store)");
  assert.equal(Msg.describeMissing({ service: SVC, min: 1, have: null, reason: "cycle", chain: ["a", "b", "a"] }, t, names), "deps.missing.cycle|name=S(demo.store),chain=M(a) → M(b) → M(a)");
  assert.match(Msg.describeMissing({ service: SVC, min: 1, have: null, reason: "failed", module: "p2", error: "modules.error.clone" }, t, names), /module=M\(p2\),reason=modules\.error\.clone/);
  const enc = Msg.encodeMissing([{ service: SVC, min: 2, have: 1, reason: "old" }]);
  assert.deepEqual(Msg.decodeMissing(enc), [{ service: SVC, min: 2, have: 1, reason: "old" }]);
  for (const bad of [undefined, "", "pas du json", "{}", '[{"service":"X y","reason":"none"}]', '[{"service":"a.b","reason":"hack"}]', "x".repeat(2000)]) assert.deepEqual(Msg.decodeMissing(bad), [], String(bad).slice(0, 20));
  assert.deepEqual(Msg.decodeMissing('[{"service":"a.b","reason":"failed","error":"<script>","module":"BAD ID","min":-3}]'), [{ service: "a.b", reason: "failed", min: 1, have: null }]);
});

/* ───────────── Nettoyage proposé (jamais automatique) ───────────── */

test("nettoyage : proposé quand plus personne ne dépend, jamais appliqué tout seul ; données → avertissement ; « garder » retire la marque", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  await I.installFromCatalogue("cons");
  assert.deepEqual(await Auto.cleanupSuggestions(), [], "encore utilisé");

  assert.deepEqual(await Auto.cleanupSuggestions(), [], "un consommateur éteint mais installé peut être rallumé : pas de proposition");
  assert.equal((await I.uninstallModule("cons", { keepData: false })).ok, true);
  assert.deepEqual(await Auto.cleanupSuggestions(), [{ id: "prov", for: [], hasData: false }]);
  assert.ok(await row("prov"), "proposition seulement : le module est toujours là");
  // données saisies par l'admin → avertissement
  const inst = (await insts("prov"))[0];
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "contacts", data: "{}" } });
  assert.equal((await Auto.cleanupSuggestions())[0].hasData, true);
  await db.prisma.moduleRecord.deleteMany();
  // réglages modifiés → avertissement aussi
  await setSetting(`instance.${inst.id}.apiKey`, "x");
  assert.equal((await Auto.cleanupSuggestions())[0].hasData, true);
  await db.prisma.setting.deleteMany({ where: { key: `instance.${inst.id}.apiKey` } });
  assert.equal((await Auto.cleanupSuggestions())[0].hasData, false);
  const links = await View.viewModuleLinks("prov", await View.buildNames("fr", "fr"));
  assert.deepEqual(links.cleanup, { hasData: false });
  await Auto.forgetAuto("prov");
  assert.deepEqual(await Auto.cleanupSuggestions(), []);
  assert.deepEqual(await Auto.readAuto(), {});
});

test("nettoyage : désinstaller un module marqué retire sa marque ; un module installé à la main n'est jamais proposé", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  bundled("manuel", { offers: [{ service: SVC2 }] });
  await I.installFromCatalogue("manuel");
  await I.installFromCatalogue("cons");
  assert.deepEqual(await Auto.cleanupSuggestions(), [], "tant que le consommateur est installé");
  assert.equal((await I.uninstallModule("cons", { keepData: false })).ok, true);
  assert.deepEqual((await Auto.cleanupSuggestions()).map((c) => c.id), ["prov"]);
  assert.equal((await I.uninstallModule("prov", { keepData: false })).ok, true);
  assert.deepEqual(await Auto.readAuto(), {});
});

/* ───────────── B3 : mise à jour qui AJOUTE un requires ───────────── */

const gitModule = (id, extra = {}) => makeRepo({ "module.json": manifestOf(id, extra), "index.mjs": "export default {};" });
const publish = (repo, id, version, extra) => { fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifestOf(id, { version, ...extra }))); repo.g("commit", "-qam", `v${version}`); };

test("mise à jour qui ajoute un requires : le fournisseur disponible est installé d'office (avec son instance)", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  const repo = gitModule("gcons");
  assert.equal((await I.installModule(repo.url)).ok, true);
  publish(repo, "gcons", "1.1.0", { requires: [{ service: SVC }] });
  const r = await I.updateModule("gcons");
  assert.deepEqual([r.ok, r.provided, r.missing], [true, ["prov"], undefined]);
  assert.deepEqual([(await row("prov")).enabled, (await insts("prov")).length], [true, 1]);
  assert.deepEqual((await Auto.readAuto()).prov.for, ["gcons"]);
});

test("mise à jour qui ajoute un requires IMPOSSIBLE à satisfaire : la mise à jour réussit, l'admin est averti, le module dégrade sans planter", async () => {
  const repo = gitModule("gcons");
  await I.installModule(repo.url);
  publish(repo, "gcons", "1.1.0", { requires: [{ service: SVC }] });
  const r = await I.updateModule("gcons");
  assert.equal(r.ok, true);
  assert.equal((await row("gcons")).version, "1.1.0");
  assert.deepEqual(r.missing.map((m) => [m.service, m.reason]), [[SVC, "none"]]);
  assert.equal((await row("gcons")).enabled, true, "toujours actif (comme avant : muet mais jamais désactivé)");
  const links = await View.viewModuleLinks("gcons", await View.buildNames("fr", "fr"));
  assert.equal(links.gaps.length, 1, "la page du module dit « Il manque »");
  assert.deepEqual([...(await View.missingByModule()).keys()], ["gcons"]);
});

test("« Tout mettre à jour » : l'avertissement figure au bilan et ne bloque pas les autres mises à jour", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  const a = gitModule("g-a"); const b = gitModule("g-b"); const c = gitModule("g-c");
  for (const [repo, id] of [[a, "g-a"], [b, "g-b"], [c, "g-c"]]) { await I.installModule(repo.url);}
  publish(a, "g-a", "1.1.0", { requires: [{ service: "introuvable.service" }] });   // impossible
  publish(b, "g-b", "1.1.0", { requires: [{ service: SVC }] });                      // possible
  publish(c, "g-c", "1.1.0");                                                         // simple
  const s = await Upd.updateModules(["g-a", "g-b", "g-c"]);
  assert.deepEqual(s.updated, ["g-a", "g-b", "g-c"]);
  assert.deepEqual(s.failed, []);
  assert.deepEqual(s.warnings.map((w) => [w.id, w.missing[0].service]), [["g-a", "introuvable.service"]]);
  assert.deepEqual(s.provided, ["prov"]);
});

test("bilan en bloc : un résultat avec 'missing' est un avertissement, pas un échec (fonction pure)", async () => {
  const s = await Bulk.updateSequentially(["x", "y"], async (id) => (id === "x" ? { ok: true, missing: [{ service: SVC, min: 1, have: null, reason: "none" }] } : { ok: true }));
  assert.deepEqual([s.updated, s.failed, s.warnings.length], [["x", "y"], [], 1]);
});

/* ───────────── B4 : restauration ───────────── */

const fakeBackup = (modules) => ({
  manifest: { createdAt: "2026-01-01T00:00:00Z", frameworkVersion: "1.0.0", site: { name: "S" }, counts: {}, modules, files: [], format: "curiosa-backup", formatVersion: 1 },
  data: { users: [{ id: "u1", email: "o@x.org", name: "O", role: "owner", passwordHash: "h", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", advanced: false, locale: null }], settings: [], modules, instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [] }, uploads: [],
});
const bm = (id, enabled = true) => ({ id, source: "bundled", origin: "catalogue", name: id, version: "1.0.0", enabled, repoUrl: null, ref: null, commit: null });
const spyInstallers = (calls) => ({
  fromCatalogue: async (id) => { calls.push(id); return I.installFromCatalogue(id, { dependencies: false }); },
  fromRepo: async (url) => I.installModule(url, { dependencies: false }),
});

test("restauration : les modules sont réinstallés dans l'ordre des dépendances (fournisseurs d'abord)", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  const calls = [];
  const report = await Rs.applyRestore(fakeBackup([bm("cons"), bm("prov")]), { confirmCustom: [], actor: "o", installers: spyInstallers(calls) });
  assert.equal(report.ok, true);
  assert.deepEqual(calls, ["prov", "cons"]);
  assert.deepEqual(report.dependencies, []);
  assert.deepEqual([...report.provided], ["prov"], "le fournisseur restauré sans instance en reçoit une");
  assert.equal((await insts("prov")).length, 1);
  assert.deepEqual(await Dep.requirementGaps((await R.getModule("cons")).manifest), []);
});

test("restauration : fournisseur absent de la sauvegarde mais disponible → installé d'office avec son instance", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  const report = await Rs.applyRestore(fakeBackup([bm("cons")]), { confirmCustom: [], actor: "o", installers: spyInstallers([]) });
  assert.deepEqual([report.ok, report.provided, report.dependencies], [true, ["prov"], []]);
  assert.deepEqual([(await row("prov")).enabled, (await insts("prov")).length, (await row("cons")).enabled], [true, 1, true]);
});

test("restauration : fournisseur introuvable → le consommateur est restauré (activé comme sauvegardé) et le bilan dit « il manque »", async () => {
  bundled("cons", { requires: [{ service: SVC }] });
  const backup = fakeBackup([bm("cons")]);
  const preview = await Rs.planModules(backup.data.modules);
  assert.deepEqual(preview[0].missing.map((m) => [m.service, m.reason]), [[SVC, "none"]], "l'aperçu le dit avant");
  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o", installers: spyInstallers([]) });
  assert.equal(report.ok, true, "la restauration n'est jamais interrompue");
  assert.deepEqual(report.dependencies.map((d) => [d.id, d.missing[0].service]), [["cons", SVC]]);
  assert.equal((await row("cons")).enabled, true, "l'état de la sauvegarde est respecté");
});

test("restauration : un module « éteint » dans une ancienne sauvegarde est désinstallé en gardant ses données, sans rien réparer", async () => {
  bundled("prov", { offers: [{ service: SVC }] });
  bundled("cons", { requires: [{ service: SVC }] });
  const backup = fakeBackup([bm("cons", false), bm("prov")]);
  assert.equal((await Rs.planModules(backup.data.modules)).every((p) => !p.missing), true);
  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o", installers: spyInstallers([]) });
  assert.deepEqual([await row("cons"), report.dependencies], [null, []], "plus d'état éteint : désinstallé (ses données seraient gardées)");
});

test("restauration : ordre topologique stable, cycles et inconnus gardent leur place", () => {
  const items = ["c", "b", "a", "x"].map((id) => ({ id }));
  const links = { a: { offers: [{ service: "s1", version: 1 }], needs: [] }, b: { offers: [{ service: "s2", version: 1 }], needs: [{ service: "s1", min: 1 }] }, c: { offers: [], needs: [{ service: "s2", min: 1 }] } };
  assert.deepEqual(RD.orderByDependencies(items, (id) => links[id]).map((i) => i.id), ["a", "b", "c", "x"]);
  const loop = { p: { offers: [{ service: "s1", version: 1 }], needs: [{ service: "s2", min: 1 }] }, q: { offers: [{ service: "s2", version: 1 }], needs: [{ service: "s1", min: 1 }] } };
  assert.deepEqual(RD.orderByDependencies([{ id: "p" }, { id: "q" }], (id) => loop[id]).map((i) => i.id).sort(), ["p", "q"], "cycle : personne n'est perdu");
  assert.deepEqual(RD.orderByDependencies(items, () => undefined).map((i) => i.id), ["c", "b", "a", "x"], "aucun lien connu : ordre d'origine");
});

/* ───────────── Garde-fous divers ───────────── */

test("anciens modules sans dépendance et manifestes existants : mêmes comportements qu'avant", async () => {
  bundled("simple");
  assert.deepEqual(await I.installFromCatalogue("simple"), { ok: true, id: "simple" });
  assert.deepEqual(await Auto.readAuto(), {});
  assert.deepEqual((await Plan.planDependencies("simple", [])).steps, []);
});

test("locales : toutes les clés « deps. » existent en français et en anglais avec les mêmes variables", async () => {
  const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/locales/fr.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/locales/en.json"), "utf8"));
  const keys = (d) => Object.keys(d).filter((k) => k.startsWith("deps.") || k.startsWith("backup.deps.") || k.startsWith("modules.error.auto"));
  assert.deepEqual(keys(fr).sort(), keys(en).sort());
  assert.ok(keys(fr).length > 30);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  // tout `t("deps.…")` écrit dans le code existe
  for (const f of ["src/components/admin/DependencyPlanBox.tsx", "src/components/admin/ModuleLinksBox.tsx", "src/core/modules/dependencyMessages.ts"]) {
    for (const m of fs.readFileSync(path.join(process.cwd(), f), "utf8").matchAll(/\bt\("([a-zA-Z0-9_.-]+)"/g)) assert.ok(m[1] in fr && m[1] in en, `${f} : ${m[1]}`);
  }
  for (const reason of ["none", "old", "cycle", "depth", "failed"]) assert.ok(`deps.missing.${reason}` in fr);
  for (const a of ["install", "setup", "present"]) assert.ok(`deps.plan.line.${a}` in fr);
});
