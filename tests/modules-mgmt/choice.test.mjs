import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Réglage « choix parmi » (`choice`, contrat 1 de docs/V2-CONTRACTS.md) : manifeste, résolution 0/1/N options, élément supprimé ou fusionné,
// validation asynchrone BORNÉE (fournisseur « trou noir »), `fromText`, création à la volée (droit du propriétaire de la donnée), graine, actions d'admin.
// Modules de test : dépôts git locaux (makeRepo), installés sans catalogue. Aucun réseau.
const db = await useTestDb();
const { prisma } = db;
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const C = await import("@/core/modules/choice");
const V = await import("@/core/modules/choiceValues");
const { parseManifest } = await import("@/core/modules/manifest");
const { missingSettings } = await import("@/core/modules/missingSettings");
const { createInstance } = await import("@/core/instanceService");
const { getInstanceById } = await import("@/core/instances");
const { buildContext, forViewer } = await import("@/core/modules/context");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { openSeedSession } = await import("@/core/modules/seeding");
const { auditLabelKey } = await import("@/core/auditLabels");

after(() => db.close());
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

/* ───────────── modules de test ───────────── */

const CHAN = "demo.chan";   // source « providers » : une instance par chaîne
const CATS = "demo.cats";   // source « service » : les catégories d'un module propriétaire
const CONS = "demo.cons";   // offert par le consommateur (pour la graine)

// Le propriétaire des catégories garde ses éléments dans un objet global piloté par le test (supprimer, fusionner, ne plus répondre…).
const CATS_CODE = `
const S = () => globalThis.__cats;
const hang = () => new Promise(() => {});
export default { services: { "${CATS}": {
  list: async (ctx, a) => {
    const s = S(); s.lists.push(a); if (s.hang) return hang();
    const q = String(a?.q ?? "").toLowerCase();
    const all = s.items.filter((i) => !q || i.label.toLowerCase().includes(q) || (i.aliases ?? []).some((x) => x.toLowerCase().includes(q)));
    const start = a?.cursor ? Number(a.cursor) : 0, lim = a?.limit ?? 20;
    const next = start + lim < all.length ? String(start + lim) : (s.longNext ? "x".repeat(600) : null);
    return { items: [...all.slice(start, start + lim), ...(s.flood ? Array.from({ length: 80 }, (_, i) => ({ id: "f" + i, label: "F" + i })) : [])], next };
  },
  get: async (ctx, a) => {
    const s = S(); if (s.hang || s.hangGet) return hang();
    const items = s.items.filter((i) => a.ids.includes(i.id)).map((i) => ({ id: i.id, label: i.label }));
    const moved = Object.fromEntries(Object.entries(s.moved).filter(([k]) => a.ids.includes(k)));
    return { items, moved, missing: a.ids.filter((id) => !items.some((i) => i.id === id) && !moved[id]) };
  },
  create: async (ctx, a) => {
    const s = S(); s.creates.push({ label: a.label, can: typeof ctx.can === "function" ? ctx.can("cats.create") : "absent" });
    if (s.hangCreate) return hang();
    if (!ctx.can?.("cats.create")) return { ok: false, error: "denied" };
    const dup = s.items.find((i) => i.label.toLowerCase() === a.label.toLowerCase());
    if (dup) return { ok: false, error: "duplicate", id: dup.id };
    const id = "c" + (s.items.length + 100); s.items.push({ id, label: a.label }); return { ok: true, id, label: a.label };
  },
} } };`;
const reset = () => { globalThis.__cats = { items: [], moved: {}, lists: [], creates: [], hang: false, hangGet: false, hangCreate: false, longNext: false, flood: false }; };

const chanSetting = { key: "chan", type: "choice", label: { fr: "Chaîne", en: "Channel" }, source: { kind: "providers", service: CHAN }, fromText: true, optional: true };
const catSetting = { key: "cat", type: "choice", label: { fr: "Catégorie", en: "Category" }, source: { kind: "service", service: CATS, list: "list", get: "get", create: "create" }, allowCreate: true, fromText: true, refersTo: "category" };
const consManifest = { apiVersion: 2, id: "cons", name: "Cons", version: "1.0.0", main: "index.mjs", requires: [{ service: CHAN }, { service: CATS }], offers: [{ service: CONS }], settings: [chanSetting, catSetting] };

const install = async (files) => assert.equal((await installModule(makeRepo(files).url, { dependencies: false })).ok, true);
const manifestOf = async (id) => (await R.getModule(id)).manifest;
const newInstance = async (id, nickname) => createInstance(prisma, { manifest: await manifestOf(id), nickname, names: { fr: nickname } });
let consumer, chanField, catField;

async function setup() {
  await install({ "module.json": { apiVersion: 2, id: "chan", name: "Chan", version: "1.0.0", main: "index.mjs", offers: [{ service: CHAN, each: true }] }, "index.mjs": `export default { services: { "${CHAN}": { who: async (ctx) => ctx.instance.key } } };` });
  await install({ "module.json": { apiVersion: 2, id: "cats", name: "Cats", version: "1.0.0", main: "index.mjs", offers: [{ service: CATS }], rights: [{ id: "cats.create", label: { fr: "Créer", en: "Create" }, default: { admin: false } }] }, "index.mjs": CATS_CODE });
  await install({ "module.json": consManifest, "index.mjs": "export default {};" });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["chan", "cats", "cons"] } } });   // instances par défaut éventuelles
  await newInstance("cats", "Catégories");
  const inst = await newInstance("cons", "form");
  consumer = { mod: await R.getModule("cons"), instance: await getInstanceById(inst.id) };
  chanField = consumer.mod.manifest.settings.find((f) => f.key === "chan");
  catField = consumer.mod.manifest.settings.find((f) => f.key === "cat");
}

beforeEach(async () => {
  await db.reset();
  reset();
  C.forgetChoices();
  globalThis.curiosaTestSession = null;
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
});

const stored = async (key) => (await getSettingByLocale(`instance.${consumer.instance.id}.${key}`))[""];
const viewer = (rights = [], level = "admin") => ({ id: "u1", email: "ada@example.org", name: "Ada", level, roles: [level], rights: new Set(rights), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false });

/* ───────────── manifeste ───────────── */

test("manifeste : choice exige une source ; allowCreate refusé pour providers, sans create, ou pour un rôle / connecteur / module ; ni défaut ni traduction", () => {
  const m = (setting, extra = {}) => parseManifest({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", requires: [{ service: CATS }, { service: CHAN }], settings: [{ key: "k", label: "K", ...setting }], ...extra });
  const svc = { kind: "service", service: CATS, list: "list", get: "get", create: "create" };
  assert.equal(m({ type: "choice", source: svc }).ok, true);
  assert.equal(m({ type: "choice", source: { kind: "providers", service: CHAN, min: 2 } }).ok, true);
  assert.match(m({ type: "choice" }).error, /needs a source/);
  assert.match(m({ type: "choice", source: { kind: "providers", service: CHAN }, allowCreate: true }).error, /allowCreate/);
  assert.match(m({ type: "choice", source: { ...svc, create: undefined }, allowCreate: true }).error, /allowCreate/);
  for (const refersTo of ["role", "connector", "module", "instance", "user"]) assert.match(m({ type: "choice", source: svc, allowCreate: true, refersTo }).error, /not allowed/, refersTo);
  assert.equal(m({ type: "choice", source: svc, allowCreate: true, refersTo: "category" }).ok, true);
  assert.match(m({ type: "choice", source: svc, default: "x" }).error, /default/);
  assert.match(m({ type: "choice", source: svc, translatable: true }).error, /translatable/);
  assert.match(m({ type: "text", source: svc }).error, /only for a choice/);
  assert.match(m({ type: "text", fromText: true }).error, /only for a choice/);
  assert.equal(m({ type: "text", refersTo: "external" }).ok, true, "refersTo est permis sur un texte (règle de kit, pas du manifeste)");
  assert.equal(m({ type: "text", refersTo: "planète" }).ok, false);
  assert.match(m({ type: "choice", source: { kind: "providers", service: "demo.other" } }).error, /must be declared in requires/);
  assert.match(m({ type: "choice", source: { kind: "service", service: CATS, list: "bad name", get: "get" } }).error, /settings/);
  const inSection = parseManifest({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", requires: [{ service: CHAN }], sections: [{ id: "s", label: "S", options: [{ key: "k", label: "K", type: "choice", source: { kind: "providers", service: CHAN } }] }] });
  assert.match(inSection.error, /only for instance settings/);
});

/* ───────────── règles pures ───────────── */

test("bornes : list recoupé à 50, curseur > 500 ignoré, recherche ≤ 100, get ne garde que ce qui a été demandé", () => {
  const many = { items: Array.from({ length: 80 }, (_, i) => ({ id: `i${i}`, label: `L${i}` })), next: "x".repeat(501) };
  const l = V.sanitizeList(many);
  assert.equal(l.items.length, 50);
  assert.equal(l.next, null, "curseur trop long : fin de liste");
  assert.equal(V.sanitizeList({ items: [{ id: "a", label: "A" }, { id: "a", label: "B" }, { id: "", label: "x" }, { id: "b" }, null], next: "p2" }).items.length, 1);
  assert.equal(V.sanitizeList({ items: [], next: "p2" }).next, "p2");
  assert.deepEqual(V.searchArgs("x".repeat(300), "c".repeat(501), 999), { q: "x".repeat(100), cursor: null, limit: 50 });
  assert.deepEqual(V.searchArgs(42, "ok", undefined), { q: "", cursor: "ok", limit: 20 });
  const g = V.sanitizeGet({ items: [{ id: "a", label: "A" }, { id: "zz", label: "intrus" }], moved: { b: "c", zz: "y" } }, ["a", "b", "d"]);
  assert.deepEqual(g, { items: [{ id: "a", label: "A" }], moved: { b: "c" }, missing: ["d"] });
});

test("décision : chosen, only (rien d'écrit), none, ambiguous, missing avec ou sans remplaçant unique, unverified", () => {
  const one = { items: [{ id: "a", label: "A" }], more: false };
  const two = { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }], more: false };
  assert.deepEqual(V.decideChoice({ stored: "", options: { items: [], more: false } }), { status: "none" });
  assert.deepEqual(V.decideChoice({ stored: "", options: one }), { status: "only", id: "a", label: "A" });
  assert.deepEqual(V.decideChoice({ stored: "", options: two }), { status: "ambiguous" });
  assert.deepEqual(V.decideChoice({ stored: "", options: { items: [{ id: "a", label: "A" }], more: true } }), { status: "ambiguous" }, "une page suivante = plusieurs options");
  assert.deepEqual(V.decideChoice({ stored: "", options: null }), { status: "unverified" });
  assert.deepEqual(V.decideChoice({ stored: "x", known: { state: "found", id: "x", label: "X" }, options: null }), { status: "chosen", id: "x", label: "X" });
  assert.deepEqual(V.decideChoice({ stored: "x", known: { state: "missing" }, options: one }), { status: "missing", id: "a", label: "A" });
  assert.deepEqual(V.decideChoice({ stored: "x", known: { state: "missing" }, options: two }), { status: "missing" });
  assert.deepEqual(V.decideChoice({ stored: "x", known: { state: "unverified" }, options: one }), { status: "unverified" });
  // « À configurer » : missingSettings reste pur ; l'appelant lui passe « rempli » ou rien.
  const fields = [{ key: "c", type: "choice" }];
  const miss = (r, raw = "") => missingSettings(fields, new Set(), { c: V.fillStored(r, raw) }).length;
  assert.equal(miss({ status: "none" }), 1);
  assert.equal(miss({ status: "ambiguous" }), 1);
  assert.equal(miss({ status: "missing" }, "x"), 1);
  assert.equal(miss({ status: "only", id: "a", label: "A" }), 0);
  assert.equal(miss({ status: "missing", id: "a", label: "A" }, "x"), 0);
  assert.equal(miss({ status: "chosen", id: "a", label: "A" }, "a"), 0);
  assert.equal(miss({ status: "unverified" }, "a"), 0, "une panne ne crie pas « à configurer »");
  assert.equal(missingSettings([{ key: "c", type: "choice", optional: true }], new Set(), { c: {} }).length, 0, "facultatif : jamais à configurer");
});

test("fromText : correspondance unique (sans casse, espaces réduits, alias compris), ambiguë ou absente", () => {
  const items = [{ id: "1", label: "Cible de raid" }, { id: "2", label: "Amis", aliases: ["Copains"] }, { id: "3", label: "amis " }];
  assert.deepEqual(V.matchText(items, "  cible   DE raid "), { status: "match", id: "1", label: "Cible de raid" });
  assert.deepEqual(V.matchText(items, "copains"), { status: "match", id: "2", label: "Amis" });
  assert.deepEqual(V.matchText(items, "amis"), { status: "ambiguous" });
  assert.deepEqual(V.matchText(items, "cible"), { status: "none" }, "une étiquette qui CONTIENT le texte ne suffit pas");
  assert.deepEqual(V.matchText(items, "   "), { status: "none" });
});

test("bounded : un « trou noir » rend la main au délai, une erreur n'est pas un délai", async () => {
  const t0 = Date.now();
  assert.deepEqual(await V.bounded(new Promise(() => {}), 60), { ok: false, timeout: true });
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(await V.bounded(Promise.reject(new Error("x")), 1000), { ok: false, timeout: false });
  assert.deepEqual(await V.bounded(async () => 3, 1000), { ok: true, value: 3 });
});

/* ───────────── source « providers » : 0 / 1 / N options, suppression ───────────── */

test("providers : 0 option → none ; 1 → only, JAMAIS écrit ; une 2e fait réapparaître le choix ; l'id d'instance est stocké, pas la clé", async () => {
  await setup();
  assert.deepEqual(await C.resolveChoiceFor(consumer, chanField, ""), { status: "none" });
  const view0 = await C.choiceAdminView(consumer, chanField);
  assert.equal(view0.mode, "none");
  assert.equal(view0.kind, "providers");

  const a = await newInstance("chan", "Alpha");   // créer un fournisseur oublie tout seul les résolutions gardées (pas de forgetChoices à la main)
  const only = await C.resolveChoiceFor(consumer, chanField, "");
  assert.deepEqual(only, { status: "only", id: a.id, label: "Alpha" });
  assert.equal((await C.choiceAdminView(consumer, chanField)).mode, "only");
  // Valider l'unique option : rien n'est stocké (store null).
  assert.deepEqual(await C.validateChoice(consumer, chanField, a.id), { ok: true, store: null });
  assert.equal(await stored("chan"), undefined, "l'unique option n'est jamais écrite");

  const b = await newInstance("chan", "Beta");
  C.forgetChoices();
  assert.deepEqual(await C.resolveChoiceFor(consumer, chanField, ""), { status: "ambiguous" }, "une deuxième option : le sélecteur revient");
  const view = await C.choiceAdminView(consumer, chanField);
  assert.equal(view.mode, "select");
  assert.equal(view.state, "empty");
  assert.deepEqual(await C.validateChoice(consumer, chanField, b.id), { ok: true, store: b.id });
  assert.equal((await C.validateChoice(consumer, chanField, "beta")).ok, false, "la clé (renommable) n'est jamais un identifiant valable");
  assert.deepEqual(await C.resolveChoiceFor(consumer, chanField, b.id), { status: "chosen", id: b.id, label: "Beta" });

  // Recherche et pagination locales.
  const page = await C.listChoiceOptions(consumer, chanField, { q: "alp" });
  assert.deepEqual(page.items.map((i) => i.id), [a.id]);
  const p1 = await C.listChoiceOptions(consumer, chanField, { limit: 1 });
  assert.equal(p1.items.length, 1);
  assert.equal(p1.next, "1");
  assert.equal((await C.listChoiceOptions(consumer, chanField, { limit: 1, cursor: p1.next })).items[0].id, b.id);
});

test("providers : instance choisie supprimée → s'il reste UNE option elle est utilisée (bannière), sinon à configurer", async () => {
  await setup();
  const a = await newInstance("chan", "Alpha");
  const b = await newInstance("chan", "Beta");
  await setSetting(`instance.${consumer.instance.id}.chan`, b.id);
  await prisma.moduleInstance.delete({ where: { id: b.id } });
  C.forgetChoices();
  assert.deepEqual(await C.resolveChoiceFor(consumer, chanField, b.id), { status: "missing", id: a.id, label: "Alpha" });
  const fb = await C.choiceAdminView(consumer, chanField);
  assert.deepEqual(fb, { mode: "fallback", id: a.id, label: "Alpha" });
  assert.equal(C.viewCountsAsFilled(fb), true);

  await newInstance("chan", "Gamma");
  C.forgetChoices();
  assert.deepEqual(await C.resolveChoiceFor(consumer, chanField, b.id), { status: "missing" });
  const v = await C.choiceAdminView(consumer, { ...chanField, fromText: false });
  assert.equal(v.mode, "select");
  assert.equal(v.state, "missing");
  assert.equal(v.value, b.id, "la valeur disparue reste dans le formulaire : enregistrer autre chose ne l'efface pas en silence");
  assert.equal(C.viewCountsAsFilled(v), false, "à configurer");
});

test("ctx.resolveChoice : branché sur le contexte de l'instance, clé inconnue → none, résultat gardé peu de temps", async () => {
  await setup();
  const a = await newInstance("chan", "Alpha");
  const ctx = await buildContext(consumer.mod, consumer.instance, "fr");
  assert.equal(typeof ctx.resolveChoice, "function");
  assert.deepEqual(await ctx.resolveChoice("chan"), { status: "only", id: a.id, label: "Alpha" });
  assert.deepEqual(await ctx.resolveChoice("nope"), { status: "none" });
  // Le module passe l'id résolu à call(…, { provider }).
  const r = await ctx.resolveChoice("chan");
  assert.deepEqual(await ctx.api.services.call(CHAN, "who", {}, { provider: r.id }), { ok: true, value: "alpha" });
});

/* ───────────── source « service » ───────────── */

test("service : chosen, fusion suivie (moved), élément supprimé, recherche paginée bornée", async () => {
  await setup();
  globalThis.__cats.items.push({ id: "c1", label: "Cible de raid" }, { id: "c2", label: "Amis" }, { id: "c3", label: "Famille" });
  assert.deepEqual(await C.resolveChoiceFor(consumer, catField, "c2"), { status: "chosen", id: "c2", label: "Amis" });
  globalThis.__cats.moved.old = "c3";
  assert.deepEqual(await C.resolveChoiceFor(consumer, catField, "old"), { status: "chosen", id: "c3", label: "Famille" }, "fusion : on suit le nouvel id");
  assert.deepEqual(await C.resolveChoiceFor(consumer, catField, "gone"), { status: "missing" });
  assert.deepEqual(await C.validateChoice(consumer, catField, "old"), { ok: true, store: "c3" }, "on enregistre l'id d'arrivée");
  assert.deepEqual(await C.validateChoice(consumer, catField, "gone"), { ok: false, reason: "unknown" });
  assert.deepEqual(await C.validateChoice(consumer, catField, "a\nb"), { ok: false, reason: "invalid" });

  // Recherche : la page est recoupée à la limite, un curseur de plus de 500 caractères est ignoré (fin de liste).
  globalThis.__cats.flood = true;
  const r = await C.listChoiceOptions(consumer, catField, { q: "", limit: 20 });
  assert.equal(r.items.length, 20);
  globalThis.__cats.flood = false; globalThis.__cats.longNext = true;
  assert.equal((await C.listChoiceOptions(consumer, catField, { limit: 20 })).next, null);
  globalThis.__cats.longNext = false;
  await C.listChoiceOptions(consumer, catField, { q: "x".repeat(300), cursor: "y".repeat(900) });
  const sent = globalThis.__cats.lists.at(-1);
  assert.equal(sent.q.length, 100);
  assert.equal("cursor" in sent, false, "un curseur trop long n'est même pas transmis");
});

test("service « trou noir » : résolution « unverified » et validation REFUSÉE dans le délai ; rien n'est écrit", async () => {
  await setup();
  globalThis.__cats.items.push({ id: "c1", label: "A" }, { id: "c2", label: "B" });
  globalThis.__cats.hang = true;
  let t0 = Date.now();
  assert.deepEqual(await quiet(() => C.resolveChoiceFor(consumer, catField, "c1", { timeoutMs: 150 })), { status: "unverified" });
  assert.ok(Date.now() - t0 < 2000, `résolution bornée (${Date.now() - t0} ms)`);
  t0 = Date.now();
  assert.deepEqual(await quiet(() => C.validateChoice(consumer, catField, "c2", { timeoutMs: 150 })), { ok: false, reason: "timeout" });
  assert.ok(Date.now() - t0 < 2000);
  // Formulaire : borne globale même si chaque champ a un délai plus long.
  t0 = Date.now();
  const checks = await quiet(() => C.validateChoices(consumer, [{ field: catField, raw: "c2" }], { timeoutMs: 10_000, formMs: 200 }));
  assert.deepEqual(checks.get("cat"), { ok: false, reason: "timeout" });
  assert.ok(Date.now() - t0 < 2000, "borne du formulaire");
  assert.equal((await C.choiceAdminView(consumer, catField, { timeoutMs: 150 })).mode, "unverified");
  assert.equal(await stored("cat"), undefined);
});

/* ───────────── fromText ───────────── */

test("fromText : texte égal à UNE étiquette → remplacé par l'id (audit), ambigu ou inconnu → rien d'écrit, « Valeur à confirmer »", async () => {
  await setup();
  globalThis.__cats.items.push({ id: "c1", label: "Cible de raid" }, { id: "c2", label: "Amis" }, { id: "c3", label: "AMIS" });
  const key = `instance.${consumer.instance.id}.cat`;
  await setSetting(key, "cible  de RAID");
  const r = await C.convertFromText(consumer, catField, { actor: "ada@example.org" });
  assert.deepEqual(r, { status: "converted", id: "c1", label: "Cible de raid" });
  assert.equal(await stored("cat"), "c1");
  const log = await prisma.auditLog.findFirst({ where: { action: "setting.fromText" } });
  assert.equal(log.actor, "ada@example.org");
  assert.equal(log.target.includes("Cible"), false, "l'audit ne recopie pas la valeur");
  assert.equal(auditLabelKey("setting.fromText"), "audit.action.setting.fromText");
  assert.deepEqual(await C.convertFromText(consumer, catField), { status: "kept" }, "déjà un id : rien à faire");

  await setSetting(key, "amis");
  assert.deepEqual(await C.convertFromText(consumer, catField), { status: "ambiguous", text: "amis" });
  assert.equal(await stored("cat"), "amis", "ambigu : rien n'est écrit");
  const view = await C.choiceAdminView(consumer, catField);
  assert.equal(view.mode, "select");
  assert.equal(view.state, "pending");
  assert.equal(view.value, "amis", "la valeur à confirmer est gardée tant qu'on ne choisit pas");

  await setSetting(key, "inconnue");
  assert.deepEqual(await C.convertFromText(consumer, catField), { status: "nomatch", text: "inconnue" });

  // Balayage (appelé au démarrage par le balayage de conversion) : compte, convertit, s'arrête au budget.
  await setSetting(key, "Cible de raid");
  const sweep = await C.sweepFromText({ budgetMs: 5000 });
  assert.equal(sweep.converted, 1);
  assert.equal(sweep.done, true);
  assert.equal(await stored("cat"), "c1");
  await setSetting(key, "Personne");
  assert.deepEqual(await C.sweepFromText({ budgetMs: 5000 }), { checked: 2, converted: 0, pending: 1, unverified: 0, done: true });
  assert.equal((await C.sweepFromText({ budgetMs: 0 })).done, false, "budget épuisé : le passage suivant reprend");
});

test("fromText côté providers : la clé technique d'une instance sert d'alias, l'id est écrit", async () => {
  await setup();
  const a = await newInstance("chan", "Alpha");
  await newInstance("chan", "Beta");
  await setSetting(`instance.${consumer.instance.id}.chan`, "alpha");
  assert.deepEqual(await C.convertFromText(consumer, chanField), { status: "converted", id: a.id, label: "Alpha" });
  assert.equal(await stored("chan"), a.id);
});

/* ───────────── création à la volée ───────────── */

test("création : le module PROPRIÉTAIRE crée avec les droits de la personne ; refusée sans droit, sans personne, ou si le réglage ne la permet pas", async () => {
  await setup();
  const ok = await C.createChoiceItem(consumer, catField, "  Nouvelle   catégorie ", viewer(["cats:cats.create"]));
  assert.equal(ok.ok, true);
  assert.equal(ok.label, "Nouvelle catégorie");
  assert.equal(globalThis.__cats.creates.at(-1).can, true, "ctx.can du fournisseur vérifie le droit de la personne connectée");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "module.form.choice.create" } }));

  const denied = await C.createChoiceItem(consumer, catField, "Autre", viewer([]));
  assert.deepEqual(denied, { ok: false, error: "denied" });
  assert.equal(globalThis.__cats.creates.at(-1).can, false);
  assert.equal(globalThis.__cats.items.some((i) => i.label === "Autre"), false);
  assert.deepEqual(await C.createChoiceItem(consumer, catField, "Autre", viewer(["demo:cats.create", "cons:cats.create"])), { ok: false, error: "denied" }, "le droit d'un AUTRE module ne vaut rien");
  assert.deepEqual(await C.createChoiceItem(consumer, catField, "Autre", null), { ok: false, error: "denied" });
  assert.equal((await C.createChoiceItem(consumer, catField, "Tout", viewer([], "owner"))).ok, true, "le propriétaire du site a tous les droits");

  // Doublon avec id : l'existant est sélectionné.
  const dup = await C.createChoiceItem(consumer, catField, "nouvelle catégorie", viewer(["cats:cats.create"]));
  assert.deepEqual(dup, { ok: true, id: ok.id, label: "Nouvelle catégorie", existing: true });

  assert.deepEqual(await C.createChoiceItem(consumer, { ...catField, allowCreate: false }, "X", viewer(["cats:cats.create"])), { ok: false, error: "notAllowed" });
  assert.deepEqual(await C.createChoiceItem(consumer, { ...catField, refersTo: "role" }, "X", viewer(["cats:cats.create"])), { ok: false, error: "notAllowed" });
  assert.deepEqual(await C.createChoiceItem(consumer, chanField, "X", viewer(["cats:cats.create"])), { ok: false, error: "notAllowed" }, "jamais pour des instances (connecteurs, modules)");
  assert.deepEqual(await C.createChoiceItem(consumer, catField, "x".repeat(101), viewer(["cats:cats.create"])), { ok: false, error: "invalid" });
  globalThis.__cats.hangCreate = true;
  assert.deepEqual(await quiet(() => C.createChoiceItem(consumer, catField, "Lente", viewer(["cats:cats.create"]), { timeoutMs: 150 })), { ok: false, error: "timeout" });

  // Hors administration, ctx.can vaut toujours « non » (un service appelé sans personne ne crée rien).
  const ctx = await buildContext(consumer.mod, consumer.instance, "fr");
  globalThis.__cats.hangCreate = false;
  assert.deepEqual(await ctx.api.services.call(CATS, "create", { label: "Par un module" }), { ok: true, value: { ok: false, error: "denied" } });
  assert.equal(forViewer(ctx, viewer(["cons:x"])).can("x"), true);
});

/* ───────────── enregistrement (action d'admin) et graine ───────────── */

test("enregistrement : id revérifié ; unique option non écrite ; champ masqué gardé ; fournisseur muet → refus sans rien écrire", async () => {
  await setup();
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const { searchChoice, createChoice } = await import("@/app/admin/(panel)/instances/choiceActions");
  const admin = await prisma.user.create({ data: { email: "adam@example.org", name: "Adam", role: "admin", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: admin.id, sv: 0 } };
  globalThis.__cats.items.push({ id: "c1", label: "A" }, { id: "c2", label: "B" });
  const form = (fields) => { const fd = new FormData(); fd.set("id", consumer.instance.id); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; };

  assert.ok((await saveInstanceSettings(null, form({ s__cat: "c2", s__cat__choice: "1" }))).ok);
  assert.equal(await stored("cat"), "c2");
  assert.ok((await saveInstanceSettings(null, form({ s__cat: "forged", s__cat__choice: "1" }))).errors?.s__cat, "un id forgé est refusé (message sous le champ)");
  assert.equal(await stored("cat"), "c2");
  assert.ok((await saveInstanceSettings(null, form({ s__cat: "zzz" }))).ok, "champ non montré (pas de marque __choice) : gardé");
  assert.equal(await stored("cat"), "c2");

  globalThis.__cats.hang = true;
  const t0 = Date.now();
  const r = await quiet(() => saveInstanceSettings(null, form({ s__cat: "c1", s__cat__choice: "1" })));
  assert.match(r.errors?.s__cat ?? "", /vérifier/);
  assert.ok(Date.now() - t0 < 9000, "refus dans la borne de 5 s");
  assert.equal(await stored("cat"), "c2", "rien n'a été écrit");
  assert.ok((await saveInstanceSettings(null, form({ s__cat: "c2", s__cat__choice: "1" }))).ok, "valeur inchangée : gardée sans interroger le fournisseur");
  globalThis.__cats.hang = false;

  // Une seule option restante : l'enregistrer ne l'écrit pas.
  globalThis.__cats.items.splice(0, 1);   // ne reste que c2
  assert.ok((await saveInstanceSettings(null, form({ s__cat: "", s__cat__choice: "1" }))).ok);
  assert.equal(await stored("cat"), undefined);
  assert.ok((await saveInstanceSettings(null, form({ s__cat: "c2", s__cat__choice: "1" }))).ok);
  assert.equal(await stored("cat"), undefined, "l'unique option reste résolue à l'exécution");

  // Recherche et création par les actions (même garde que l'enregistrement).
  const found = await searchChoice(consumer.instance.id, "cat", "b", "c".repeat(800));
  assert.deepEqual(found, { ok: true, items: [{ id: "c2", label: "B" }], next: null });
  assert.equal((await searchChoice(consumer.instance.id, "nope", "", null)).ok, false);
  assert.equal((await createChoice(consumer.instance.id, "cat", "Nouvelle")).ok, false, "un administrateur sans le droit du module propriétaire ne crée rien");
  globalThis.curiosaTestSession = null;
  await assert.rejects(() => searchChoice(consumer.instance.id, "cat", "", null), "personne de connecté : refusé");
});

test("graine : un choice semé est validé comme à l'admin (id inconnu ou fournisseur muet → graine refusée)", async () => {
  await setup();
  await install({ "module.json": { apiVersion: 2, id: "seeder", name: "Seeder", version: "1.0.0", main: "index.mjs", requires: [{ service: CONS }], seeds: [{ module: "cons", reason: "test" }] }, "index.mjs": "export default {};" });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: "seeder" } });
  const owner = await getInstanceById((await newInstance("seeder", "Semeur")).id);
  globalThis.__cats.items.push({ id: "c1", label: "A" }, { id: "c2", label: "B" });
  const seeder = await R.getModule("seeder");
  const session = () => openSeedSession(seeder, owner).attach({});
  await assert.rejects(() => session().seedInstance("cons", { seedKey: "bad", nickname: "Semée", settings: { cat: "forged" } }), /not a current choice/);
  globalThis.__cats.hang = true;
  await assert.rejects(() => quiet(() => session().seedInstance("cons", { seedKey: "slow", nickname: "Semée", settings: { cat: "c1" } })), /not a current choice \(timeout\)/);
  globalThis.__cats.hang = false;
  const ok = await session().seedInstance("cons", { seedKey: "good", nickname: "Semée", settings: { cat: "c2" } });
  assert.equal(ok.created, true);
  const made = await prisma.moduleInstance.findFirst({ where: { key: ok.instanceKey } });
  assert.equal((await getSettingByLocale(`instance.${made.id}.cat`))[""], "c2");
});

/* ───────────── accessibilité du sélecteur ───────────── */

test("sélecteur accessible : clavier (↑ ↓ Début Fin Entrée Échap), annonces aria-live, « Créer » seulement s'il manque, liste listbox", async () => {
  const M = await import("@/components/admin/choicePickerModel");
  assert.deepEqual(M.keyIntent("ArrowDown", { open: false, active: -1, count: 3 }), { type: "open" });
  assert.deepEqual(M.keyIntent("ArrowDown", { open: true, active: -1, count: 3 }), { type: "move", active: 0 });
  assert.deepEqual(M.keyIntent("ArrowDown", { open: true, active: 2, count: 3 }), { type: "move", active: 0 }, "en boucle");
  assert.deepEqual(M.keyIntent("ArrowUp", { open: true, active: 0, count: 3 }), { type: "move", active: 2 });
  assert.deepEqual(M.keyIntent("End", { open: true, active: 0, count: 3 }), { type: "move", active: 2 });
  assert.deepEqual(M.keyIntent("Home", { open: true, active: 2, count: 3 }), { type: "move", active: 0 });
  assert.deepEqual(M.keyIntent("Enter", { open: true, active: 1, count: 3 }), { type: "select", index: 1 });
  assert.equal(M.keyIntent("Enter", { open: true, active: -1, count: 3 }), null);
  assert.deepEqual(M.keyIntent("Escape", { open: true, active: 1, count: 3 }), { type: "close" });
  assert.equal(M.keyIntent("a", { open: true, active: 1, count: 3 }), null);
  const s = { loading: "…", resultsNone: "0", resultsOne: "1", resultsMany: "{count}", resultsMore: "{count}+", unreachable: "x" };
  assert.equal(M.announce(s, { loading: false, count: 0, more: false }), "0");
  assert.equal(M.announce(s, { loading: false, count: 1, more: false }), "1");
  assert.equal(M.announce(s, { loading: false, count: 7, more: false }), "7");
  assert.equal(M.announce(s, { loading: false, count: 20, more: true }), "20+");
  assert.equal(M.announce(s, { loading: false, count: 0, more: false, error: true }), "x");
  assert.equal(M.showCreate("Amis", [{ id: "1", label: "amis" }], true), false);
  assert.equal(M.showCreate("Amis", [], false), false);
  assert.equal(M.showCreate("Amis", [], true), true);
  assert.equal(M.showCreate("  ", [], true), false);
  assert.deepEqual(M.mergePage([{ id: "a", label: "A" }], [{ id: "a", label: "A" }, { id: "b", label: "B" }], true).map((i) => i.id), ["a", "b"]);

  const ui = fs.readFileSync("src/components/admin/ChoicePicker.tsx", "utf8");
  for (const needle of ['role="combobox"', 'role="listbox"', 'role="option"', 'aria-live="polite"', "aria-activedescendant", "aria-expanded", "aria-controls", "aria-selected", "maxLength={100}", "DEBOUNCE_MS = 250", "e.preventDefault()", "__choice"]) assert.ok(ui.includes(needle), needle);
  assert.ok(/px-3 py-2\.5/.test(ui), "options assez hautes pour le doigt");
  const settings = fs.readFileSync("src/components/admin/ModuleSettings.tsx", "utf8");
  assert.ok(settings.includes("<SuggestInstall"), "aucune option (providers) : bloc suggestInstall");
});

test("textes du choix en français ET en anglais", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = Object.keys(fr).filter((k) => k.startsWith("choice."));
  assert.ok(keys.length >= 25);
  for (const k of keys) assert.ok(en[k], k);
  for (const k of Object.keys(en).filter((k) => k.startsWith("choice."))) assert.ok(fr[k], k);
});

/* ───────────── kit de test des modules ───────────── */

test("kit : « refersTo » non externe exige un choice ; un texte qui fait taper le nom d'un existant est signalé (conseil) ; minCore 0.2.0 ; fakeCtx.resolveChoice", async () => {
  const { REQUIREMENTS } = await import("../../testsupport/requirements/index.mjs");
  const { FEATURES } = await import("../../testsupport/requirements/manifest.mjs");
  const { fakeCtx } = await import("../../testsupport/fakeCtx.mjs");
  const rule = (id) => REQUIREMENTS.find((r) => r.id === id);
  for (const id of ["settings.refersToChoice", "settings.textNamesExisting"]) assert.equal(rule(id).level, "advice", `${id} : conseil dans le cœur 0.2.0`);
  const run = (id, manifest) => rule(id).run({ manifest });
  const s = (extra) => ({ key: "k", label: { fr: "K", en: "K" }, type: "text", ...extra });
  assert.equal(run("settings.refersToChoice", { settings: [s({ refersTo: "category" })] }).length, 1);
  assert.deepEqual(run("settings.refersToChoice", { settings: [s({ refersTo: "external" })] }), []);
  assert.deepEqual(run("settings.refersToChoice", { settings: [s({ type: "choice", refersTo: "category" })] }), []);
  const asks = { fr: "Utile s'il y a plusieurs chaînes : saisissez le nom de la chaîne.", en: "Only useful with several channels: type the channel name." };
  assert.equal(run("settings.textNamesExisting", { settings: [s({ key: "channel", help: asks })] }).length, 1);
  assert.deepEqual(run("settings.textNamesExisting", { settings: [s({ key: "channel", help: asks, refersTo: "external" })] }), [], "refersTo external fait taire la règle");
  assert.deepEqual(run("settings.textNamesExisting", { type: "social", settings: [s({ key: "channel", help: asks })] }), [], "channel d'un module social : profil externe");
  assert.deepEqual(run("settings.textNamesExisting", { settings: [s({ key: "profile", help: asks })] }), []);
  assert.deepEqual(run("settings.textNamesExisting", { settings: [s({ help: { fr: "Le nom de votre page Facebook ou l'adresse de votre profil.", en: "Your page name." } })] }), []);
  const f = FEATURES.find((x) => x.since === "0.2.0");
  assert.ok(f.test({ code: "" }, { settings: [{ type: "choice" }] }));
  assert.ok(f.test({ code: "const r = await ctx.resolveChoice('chan');" }, { settings: [] }));
  const ctx = fakeCtx({ choices: { chan: { status: "only", id: "id-a", label: "A" } } });
  assert.deepEqual(await ctx.resolveChoice("chan"), { status: "only", id: "id-a", label: "A" });
  assert.deepEqual(await ctx.resolveChoice("other"), { status: "none" });
  assert.deepEqual(ctx.calls.choices, ["chan", "other"]);
});

test("choix sans option mais avec création : la bannière « rien à choisir » disparaît dès qu'un élément est créé ou choisi, sans rechargement, et ne laisse aucune marge vide", async () => {
  const M = await import("@/components/admin/choicePickerModel");
  assert.equal(M.showEmptyNote({ hasNote: true, created: false, value: "", found: 0 }), true, "au départ : visible");
  assert.equal(M.showEmptyNote({ hasNote: true, created: true, value: "", found: 0 }), false, "élément créé, puis valeur retirée : plus de bannière");
  assert.equal(M.showEmptyNote({ hasNote: true, created: false, value: "c1", found: 0 }), false);
  assert.equal(M.showEmptyNote({ hasNote: true, created: false, value: "", found: 2 }), false, "la recherche trouve des éléments : ce n'est plus vrai");
  assert.equal(M.showEmptyNote({ hasNote: false, created: false, value: "", found: 0 }), false, "pas de bannière à montrer");
  // Branché dans le composant : état « créé » posé après la création, et la bannière est dans le sélecteur (pas dans un conteneur à part qui garderait sa marge).
  const picker = fs.readFileSync("src/components/admin/ChoicePicker.tsx", "utf8");
  assert.match(picker, /setCreated\(true\)/);
  assert.match(picker, /showEmptyNote\(\{ hasNote: emptyNote !== undefined, created, value, found: items\.length \}\)/);
  const settings = fs.readFileSync("src/components/admin/ModuleSettings.tsx", "utf8");
  assert.match(settings, /emptyNote=\{text\}/);
  assert.doesNotMatch(settings, /<div className="space-y-2">\s*\{text\}/, "plus de conteneur qui garde sa marge une fois la bannière retirée");
});
