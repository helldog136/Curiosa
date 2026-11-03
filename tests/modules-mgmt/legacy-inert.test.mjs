// Copies de sécurité INERTES (0.6.5) : une extension promet qu'une collection héritée ne sert plus (`inertLegacyCollections`) ; la personne propriétaire peut la
// supprimer en mode avancé depuis Entretien. Ici : le contrat du manifeste, le rapport, et surtout ce que le cœur REFUSE de supprimer.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const R = await import("@/core/modules/registry");
const Rp = await import("@/core/modules/legacyReport");
const C = await import("@/core/modules/legacyCollections");
const { parseManifest, manifestSchema } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");
const { upkeepRows } = await import("@/core/modules/legacyUpkeep");
const prisma = db.prisma;
beforeEach(async () => { await db.reset(); R.resetModuleRegistry(); });
after(() => db.close());

async function module(id, manifest = {}) {
  const dir = path.join(db.dir, "modules", id);
  fs.mkdirSync(dir, { recursive: true });
  const full = { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...manifest };
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(full));
  fs.writeFileSync(path.join(dir, "index.mjs"), "export default {};");
  await prisma.module.create({ data: { id, source: "git", repoUrl: "https://github.com/exemple/perso", version: full.version, enabled: true } });
  R.forgetModule(id);
}
async function instance(id, nickname) {
  const mod = await R.getModule(id);
  return createInstance(prisma, { manifest: mod.manifest, nickname, names: { fr: nickname } });
}
const rec = (instanceId, collection, n = 1) => prisma.moduleRecord.createMany({ data: Array.from({ length: n }, (_, i) => ({ instanceId, collection, data: JSON.stringify({ i }) })) });
const count = (instanceId, collection) => prisma.moduleRecord.count({ where: { instanceId, collection } });
const base = { legacyCollections: ["legacyContacts", "meta"], inertLegacyCollections: ["legacyContacts"] };

test("manifeste : inertLegacyCollections ⊆ legacyCollections, sans doublon ; legacyCollections reste une liste de textes (un cœur ancien ne refuse donc rien)", () => {
  const ok = (extra) => parseManifest({ apiVersion: 2, id: "demo", name: "d", version: "1.0.0", ...extra });
  assert.equal(ok(base).ok, true);
  assert.equal(ok({ legacyCollections: ["a"] }).ok, true, "sans la nouvelle clé, rien ne change");
  assert.equal(ok({ legacyCollections: ["a"], inertLegacyCollections: ["b"] }).ok, false, "inerte mais pas héritée");
  assert.equal(ok({ inertLegacyCollections: ["a"] }).ok, false);
  assert.equal(ok({ legacyCollections: ["a"], inertLegacyCollections: ["a", "a"] }).ok, false);
  assert.equal(ok({ legacyCollections: [{ name: "a", inert: true }] }).ok, false, "la forme objet casserait les cœurs anciens : elle n'existe pas");
  assert.equal(ok({ legacyCollections: ["a"], inertLegacyCollections: ["a b"] }).ok, false, "nom valide");
  assert.equal(ok({ legacyCollections: Array.from({ length: 10 }, (_, i) => `c${i}`), inertLegacyCollections: Array.from({ length: 11 }, (_, i) => `c${i}`) }).ok, false, "10 au plus");
  assert.ok(manifestSchema.shape.inertLegacyCollections);
});

test("rapport : chaque copie dit si son extension la déclare inerte ; elle reste « gardée par prudence », jamais « à faire »", async () => {
  await module("carnet", base);
  const a = await instance("carnet", "Un");
  await rec(a.id, "legacyContacts", 5); await rec(a.id, "meta", 1);
  const r = await Rp.legacyReport();
  assert.deepEqual(r.collections.map((c) => [c.collection, c.count, c.inert]).sort(), [["legacyContacts", 5, true], ["meta", 1, false]]);
  assert.equal(upkeepRows(r).find((x) => x.id === "collections").group, "kept");
});

test("suppression : seulement la copie déclarée inerte, seulement de cette instance, rien d'autre", async () => {
  await module("carnet", base);
  const a = await instance("carnet", "Un"), b = await instance("carnet", "Deux");
  await rec(a.id, "legacyContacts", 5); await rec(a.id, "meta", 2); await rec(a.id, "contacts", 3); await rec(b.id, "legacyContacts", 4);
  const res = await C.deleteInertCollection(a.key, "legacyContacts");
  assert.deepEqual([res.ok, res.deleted, res.remaining], [true, 5, 0]);
  assert.equal(await count(a.id, "legacyContacts"), 0);
  assert.equal(await count(a.id, "meta"), 2, "l'état de la reprise, lu par le module, n'est jamais touché");
  assert.equal(await count(a.id, "contacts"), 3, "les données vivantes non plus");
  assert.equal(await count(b.id, "legacyContacts"), 4, "ni une autre instance");
});

test("suppression refusée, rien n'est touché : collection non inerte, non déclarée, instance inconnue, reprise pas finie", async () => {
  await module("carnet", { ...base, dataVersion: 2 });
  const a = await instance("carnet", "Un");
  await rec(a.id, "legacyContacts", 3); await rec(a.id, "meta", 2); await rec(a.id, "contacts", 1);
  await prisma.setting.upsert({ where: { key_locale: { key: `instance.${a.id}.__dataVersion`, locale: "" } }, create: { key: `instance.${a.id}.__dataVersion`, locale: "", value: "1" }, update: { value: "1" } });
  assert.equal((await C.deleteInertCollection(a.key, "legacyContacts")).reason, "not-converted", "données en retard : la copie peut encore servir de source");
  await prisma.setting.update({ where: { key_locale: { key: `instance.${a.id}.__dataVersion`, locale: "" } }, data: { value: "2" } });
  assert.equal((await C.deleteInertCollection(a.key, "meta")).reason, "not-inert", "héritée mais utilisée");
  assert.equal((await C.deleteInertCollection(a.key, "contacts")).reason, "not-declared", "ni héritée ni inerte");
  assert.equal((await C.deleteInertCollection("inconnue", "legacyContacts")).reason, "unknown-instance");
  assert.equal(await count(a.id, "legacyContacts"), 3); assert.equal(await count(a.id, "meta"), 2); assert.equal(await count(a.id, "contacts"), 1);
  // le manifeste est relu AU MOMENT de l'action : une mise à jour qui reprend la collection la rend aussitôt non supprimable
  const file = path.join(db.dir, "modules", "carnet", "module.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8")); delete m.inertLegacyCollections; fs.writeFileSync(file, JSON.stringify(m));
  assert.equal((await C.deleteInertCollection(a.key, "legacyContacts")).reason, "not-inert");
  assert.equal(await count(a.id, "legacyContacts"), 3);
});

test("suppression bornée : 20 000 lignes par clic au plus, puis « il en reste » ; un nouveau clic continue", async () => {
  await module("carnet", base);
  const a = await instance("carnet", "Un");
  await rec(a.id, "legacyContacts", C.DELETE_BATCH * C.MAX_DELETE_BATCHES + 7);
  const first = await C.deleteInertCollection(a.key, "legacyContacts");
  assert.deepEqual([first.ok, first.deleted, first.remaining], [true, C.DELETE_BATCH * C.MAX_DELETE_BATCHES, 7]);
  const second = await C.deleteInertCollection(a.key, "legacyContacts");
  assert.deepEqual([second.deleted, second.remaining], [7, 0]);
});

test("action et page : mode avancé contrôlé côté serveur, droit core:updates, journal sans contenu, confirmation qui dit ce qui sera perdu", () => {
  const actions = fs.readFileSync("src/app/admin/(panel)/maintenance/legacy/actions.ts", "utf8");
  const body = actions.slice(actions.indexOf("export async function deleteInertCopyAction"));
  assert.match(body, /adminCtx\(\{ right: "core:updates" \}\)/);
  assert.match(body, /advanced/, "le mode avancé est contrôlé dans l'action, pas seulement caché dans la page");
  assert.match(body, /c\.inert/, "refusée si la collection n'est pas dans la liste de ce qui reste ET déclarée inerte");
  assert.match(body, /audit\(user\.email, "core\.legacy\.copy\.delete"/);
  assert.match(body, /audit\(user\.email, "core\.legacy\.copy\.refused"/);
  assert.doesNotMatch(body, /\.data\b|JSON\.parse/, "le journal ne contient jamais le contenu d'une ligne");
  assert.doesNotMatch(fs.readFileSync("src/core/modules/legacyCollections.ts", "utf8"), /setInterval|setTimeout/, "aucun minuteur");
  const page = fs.readFileSync("src/app/admin/(panel)/maintenance/legacy/page.tsx", "utf8");
  assert.match(page, /advanced && row\.id === "collections"/, "bouton réservé au mode avancé");
  assert.match(page, /ConfirmButton[^>]*message=\{t\("legacy\.copy\.confirm", \{ n: c\.count \}\)\}/);
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  assert.equal(fr["legacy.copy.confirm"], "Cette copie de {n} éléments ne sera plus dans le site. Elle reste dans vos sauvegardes.");
  for (const k of Object.keys(fr).filter((x) => x.startsWith("legacy.copy") || x.startsWith("legacy.result.copy") || x.startsWith("audit.action.core.legacy.copy"))) assert.ok(en[k], k);
  const keys = Object.keys(fr); assert.ok(keys.indexOf("legacy.copy.delete") < keys.indexOf("theme.custom") && keys.at(-1) === "settings.contrast.accent2");
});
