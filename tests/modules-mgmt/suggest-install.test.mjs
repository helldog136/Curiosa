import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// v2, contrat 4 : bloc `suggestInstall` (propriétaire seulement, refus mémorisé, jamais d'office) et origine du catalogue. Noms génériques, aucun réseau.
const db = await useTestDb();
const cat = createCatalogue();
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Rec = await import("@/core/modules/recognized");
const S = await import("@/core/modules/suggestInstall");
const { auditLabelKey } = await import("@/core/auditLabels");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");

beforeEach(async () => {
  await db.reset(); await cat.clear(); delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
});
after(() => { cat.close(); return db.close(); });

const SVC = "demo.agenda";
const OWNER = { id: "u1", email: "owner@example.test", role: "owner", level: "owner", roles: [], rights: new Set() };
const ADMIN = { id: "u2", email: "admin@example.test", role: "admin", level: "admin", roles: [], rights: new Set() };
const pub = (id, manifest = {}, { listed = true } = {}) => cat.add(id, { manifest, listed, entry: { ...(manifest.offers ? { offers: manifest.offers } : {}), ...(manifest.requires ? { requires: manifest.requires } : {}) } });
const entry = (id, over = {}) => ({ id, name: id, description: "d", kind: "recognized", compatible: true, origin: "official", offers: [{ service: SVC, version: 1 }], ...over });

/** Un consommateur installé, avec une instance, qui a un besoin FACULTATIF du service (le cas typique de la suggestion). */
async function consumer() {
  await pub("cons", { requires: [{ service: SVC, optional: true }] });
  assert.equal((await I.installFromCatalogue("cons")).ok, true);
  return createInstance(db.prisma, { manifest: (await R.getModule("cons")).manifest, names: { fr: "c" } });
}

test("classement : officiels d'abord (ordre de l'index), puis extra ; incompatibles, trop anciens et déjà installés écartés ; 10 au plus", () => {
  const list = [entry("x-one", { origin: "extra" }), entry("b-off"), entry("old", { offers: [{ service: SVC, version: 1 }] }), entry("a-off"), entry("bad", { compatible: false }), entry("core", { needsNewerCore: "9.0.0" }), entry("there")];
  assert.deepEqual(S.rankSuggestions(list, SVC, 1, new Set(["there"])).map((c) => [c.id, c.origin]), [["b-off", "official"], ["old", "official"], ["a-off", "official"], ["x-one", "extra"]]);
  assert.deepEqual(S.rankSuggestions(list, SVC, 2, new Set()), [], "version insuffisante");
  assert.equal(S.rankSuggestions(Array.from({ length: 30 }, (_, i) => entry(`m${i}`)), SVC, 1, new Set()).length, 10);
});

test("bloc : liste si personne n'offre le service ; vide si un fournisseur actif existe ; service invalide ignoré", async () => {
  const inst = await consumer();
  await pub("prov", { offers: [{ service: SVC }] });
  const view = await S.suggestionView(inst.id, SVC, 1);
  assert.deepEqual([view.state, view.candidates.map((c) => c.id)], ["list", ["prov"]]);
  assert.deepEqual(await S.suggestionView(inst.id, "Pas Valide"), { state: "hidden" });
  assert.equal((await S.installSuggested(OWNER, { instanceId: inst.id, service: SVC, moduleId: "prov" })).ok, true);
  assert.deepEqual(await S.suggestionView(inst.id, SVC, 1), { state: "hidden" }, "un fournisseur actif existe : rien n'est montré");
});

test("bloc : catalogue qui ne répond jamais → « injoignable » en 2 s au plus (ici 50 ms), sans rester bloqué", async () => {
  const inst = await consumer();
  const started = Date.now();
  const view = await S.suggestionView(inst.id, SVC, 1, { catalogue: () => new Promise(() => {}), timeoutMs: 50 });
  assert.deepEqual(view, { state: "unreachable" });
  assert.ok(Date.now() - started < 1500);
  assert.deepEqual(await S.withDeadline(new Promise(() => {}), 10), { ok: false }, "trou noir : borné");
  assert.deepEqual(await S.withDeadline(Promise.reject(new Error("x")), 1000), { ok: false });
  assert.deepEqual(await S.withDeadline(Promise.resolve(3), 1000), { ok: true, value: 3 });
  assert.equal(S.SUGGEST_CATALOGUE_TIMEOUT_MS, 2000);
});

test("« Ne plus proposer » : mémorisé par instance et par service, jusqu'à « Afficher de nouveau » ; propriétaire seulement", async () => {
  const inst = await consumer();
  await pub("prov", { offers: [{ service: SVC }] });
  assert.equal(await S.dismissSuggestion(ADMIN, inst.id, SVC), false, "un administrateur ne peut pas refuser pour le propriétaire");
  assert.equal((await S.suggestionView(inst.id, SVC)).state, "list");
  assert.equal(await S.dismissSuggestion(OWNER, inst.id, SVC), true);
  assert.deepEqual(await S.suggestionView(inst.id, SVC), { state: "hidden" });
  assert.deepEqual(await S.dismissedServices(inst.id), [SVC]);
  assert.equal(await S.resetSuggestions(ADMIN, inst.id), false);
  assert.deepEqual(await S.dismissedServices(inst.id), [SVC]);
  assert.equal(await S.resetSuggestions(OWNER, inst.id), true);
  assert.deepEqual(await S.dismissedServices(inst.id), []);
  assert.equal((await S.suggestionView(inst.id, SVC)).state, "list");
});

test("installSuggested : refusé à un administrateur non propriétaire, à un service non déclaré, à un module qui n'offre pas le service ; audit à la réussite", async () => {
  const inst = await consumer();
  await pub("prov", { offers: [{ service: SVC }] });
  await pub("autre", { offers: [{ service: "demo.other" }] });
  assert.deepEqual(await S.installSuggested(ADMIN, { instanceId: inst.id, service: SVC, moduleId: "prov" }), { ok: false, error: "modules.error.ownerOnly" });
  assert.deepEqual(await S.installSuggested(null, { instanceId: inst.id, service: SVC, moduleId: "prov" }), { ok: false, error: "modules.error.ownerOnly" });
  assert.equal((await S.installSuggested(OWNER, { instanceId: inst.id, service: "demo.other", moduleId: "autre" })).error, "modules.error.suggestInvalid", "service absent des requires du module");
  assert.equal((await S.installSuggested(OWNER, { instanceId: inst.id, service: SVC, moduleId: "autre" })).error, "modules.error.suggestInvalid", "ce module n'offre pas le service");
  assert.equal((await S.installSuggested(OWNER, { instanceId: "inconnue", service: SVC, moduleId: "prov" })).error, "modules.error.suggestInvalid");
  assert.equal(await db.prisma.module.count({ where: { id: { in: ["prov", "autre"] } } }), 0, "rien d'installé");
  const ok = await S.installSuggested(OWNER, { instanceId: inst.id, service: SVC, moduleId: "prov" });
  assert.equal(ok.ok, true);
  const audits = await db.prisma.auditLog.findMany({ where: { action: "module.install.suggested" } });
  assert.deepEqual(audits.map((a) => [a.actor, a.target]), [[OWNER.email, `prov ${SVC} official`]]);
  assert.ok(auditLabelKey("module.install.suggested"));
});

test("installSuggested : une entrée « extra » exige la case cochée ; jamais proposée avant l'officiel", async () => {
  const inst = await consumer();
  const xEntry = await pub("xprov", { offers: [{ service: SVC }] }, { listed: false });
  await pub("prov", { offers: [{ service: SVC }] });
  process.env.MODULES_INDEX_URL = "https://index.example/extra.json";
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url) === process.env.MODULES_INDEX_URL ? Response.json([{ ...xEntry, offers: [SVC] }]) : real(url, init));
  Rec.clearRecognizedCache();
  try {
    const view = await S.suggestionView(inst.id, SVC);
    assert.deepEqual(view.candidates.map((c) => [c.id, c.origin]), [["prov", "official"], ["xprov", "extra"]]);
    assert.equal((await S.installSuggested(OWNER, { instanceId: inst.id, service: SVC, moduleId: "xprov" })).error, "modules.error.extraConfirm");
    assert.equal(await db.prisma.module.count({ where: { id: "xprov" } }), 0);
    assert.equal((await S.installSuggested(OWNER, { instanceId: inst.id, service: SVC, moduleId: "xprov", confirmExtra: true })).ok, true);
    assert.equal((await db.prisma.auditLog.findFirst({ where: { action: "module.install.suggested" } })).target, `xprov ${SVC} extra`);
  } finally { globalThis.fetch = real; delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache(); }
});

test("jamais d'office : ctx.api n'expose aucune installation ; le bloc n'est rendu que dans le panneau d'admin d'une instance", async () => {
  const fs = await import("node:fs");
  const { makeApi } = await import("@/core/modules/api");
  const inst = await consumer();
  const api = makeApi((await (await import("@/core/instances")).getInstanceById(inst.id)), "fr");
  const names = (o, seen = new Set()) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !seen.has(v) ? (seen.add(v), [k, ...names(v, seen)]) : [k]));
  assert.ok(!names(api).some((k) => /install|suggest/i.test(k)), "aucune porte d'installation dans ctx.api");
  const blocks = fs.readFileSync("src/components/site/Blocks.tsx", "utf8");
  assert.match(blocks, /case "suggestInstall":\s*\n\s*\/\/[^\n]*\n\s*if \(panelInstanceId && !entryScope\)/, "panneau d'instance seulement");
});
