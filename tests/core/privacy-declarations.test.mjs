// ctx.api.privacy.declarations() : les déclarations de vie privée des modules actifs, en lecture seule, bornées, sans secret.
import test from "node:test";
import assert from "node:assert/strict";

const { privacyDeclarations, privacyByLanguage, MAX_PRIVACY_MODULES, MAX_PRIVACY_INSTANCES, MAX_PRIVACY_TEXT, MAX_PRIVACY_LANGUAGES } = await import("@/core/modules/privacyDeclarations");

const active = (id, key, privacy, extra = {}) => ({
  instance: { key, id: `i-${key}`, moduleId: id, names: { en: `Name ${key}` }, name: `Name ${key}`, ...extra },
  mod: { manifest: { id, name: { en: `Module ${id}`, fr: `Module ${id} (fr)` }, privacy, settings: [{ key: "apiKey", type: "secret" }] }, def: {} },
});

test("par langue : un texte simple vaut pour la langue par défaut ; vides, mauvaises langues et excès écartés", () => {
  assert.deepEqual(privacyByLanguage("  Votre nom  ", "fr"), { fr: "Votre nom" });
  assert.deepEqual(privacyByLanguage(undefined, "fr"), {});
  assert.deepEqual(privacyByLanguage("   ", "fr"), {});
  assert.deepEqual(privacyByLanguage({ fr: "a", en: "b", "../x": "c", de: "", xx: 5 }, "fr"), { fr: "a", en: "b" });
  assert.equal(privacyByLanguage("x".repeat(5000), "fr").fr.length, MAX_PRIVACY_TEXT);
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`a${String.fromCharCode(97 + (i % 26))}`, "t" + i]));
  assert.ok(Object.keys(privacyByLanguage(many, "fr")).length <= MAX_PRIVACY_LANGUAGES);
});

test("un élément par module (instances regroupées), indicateur declares, texte par langue, aucun réglage ni secret", () => {
  const out = privacyDeclarations([
    active("zeta", "z1", undefined),
    active("alpha", "a1", { fr: "Nom et message.", en: "Name and message." }),
    active("alpha", "a2", { fr: "Nom et message.", en: "Name and message." }),
  ], "en", "fr");
  assert.deepEqual(out.modules.map((m) => m.module), ["alpha", "zeta"], "trié par identifiant");
  const [alpha, zeta] = out.modules;
  assert.equal(alpha.declares, true);
  assert.deepEqual(alpha.text, { fr: "Nom et message.", en: "Name and message." });
  assert.deepEqual(alpha.instances.map((i) => i.key), ["a1", "a2"]);
  assert.equal(alpha.name, "Module alpha");
  assert.equal(zeta.declares, false);
  assert.deepEqual(zeta.text, {});
  assert.equal(out.truncated, false);
  assert.ok(!JSON.stringify(out).includes("apiKey"), "aucun réglage dans le résultat");
  assert.deepEqual(Object.keys(alpha).sort(), ["declares", "instances", "module", "name", "text"]);
});

test("bornes : 100 modules au plus (truncated), 10 instances par module", () => {
  const many = Array.from({ length: 130 }, (_, i) => active(`mod${String(i).padStart(3, "0")}`, `k${i}`, "x"));
  const out = privacyDeclarations(many, "fr", "fr");
  assert.equal(out.modules.length, MAX_PRIVACY_MODULES);
  assert.equal(out.truncated, true);
  const crowd = Array.from({ length: 40 }, (_, i) => active("same", `s${i}`, "x"));
  assert.equal(privacyDeclarations(crowd, "fr", "fr").modules[0].instances.length, MAX_PRIVACY_INSTANCES);
  assert.deepEqual(privacyDeclarations([], "fr", "fr"), { modules: [], truncated: false });
});

// ── Vrai cœur : permission, modules actifs seulement ─────────────────────────────────────────────────────────────────
import { after, beforeEach } from "node:test";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
const { getActiveInstances, getModule } = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { makeApi } = await import("@/core/modules/api");
const { parseManifest } = await import("@/core/modules/manifest");
beforeEach(() => db.reset());
after(() => db.close());

test("makeApi : sans la permission « privacy » rien ; avec elle, les modules installés, leur déclaration par langue", async () => {
  const repo = makeRepo({ "module.json": { apiVersion: 2, id: "gather", name: "Gather", version: "1.0.0", main: "index.mjs", privacy: { fr: "Nom et message.", en: "Name and message." } }, "index.mjs": "export default {};" });
  const res = await installModule(repo.url, { dependencies: false });
  assert.equal(res.ok, true, JSON.stringify(res));
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "gather" } });
  await createInstance(db.prisma, { manifest: (await getModule("gather")).manifest, nickname: "gather", names: { fr: "Livre" } });
  const inst = (await getActiveInstances()).find((a) => a.mod.manifest.id === "gather");
  assert.ok(inst, "instance active");
  assert.deepEqual(await makeApi(inst.instance, "en", ["storage"]).privacy.declarations(), { modules: [], truncated: false });
  const out = await makeApi(inst.instance, "en", ["privacy"]).privacy.declarations();
  const mine = out.modules.find((m) => m.module === "gather");
  assert.deepEqual(mine.text, { fr: "Nom et message.", en: "Name and message." });
  assert.equal(mine.declares, true);
  const parsed = parseManifest({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", permissions: ["privacy"] });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
});
