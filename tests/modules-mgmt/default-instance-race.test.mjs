import test, { after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Deux demandes d'instance par défaut en même temps pour un même module (installation par la reprise finale RAWG en arrière-plan + cascade de dépendance) :
// une seule instance est créée, les autres voient « présente ». Avant : « Unique constraint failed on the fields: (key) ».
const db = await useTestDb();
const cat = createCatalogue();
after(() => { cat.close(); return db.close(); });
const I = await import("@/core/modules/installer");
const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");

test("ensureDefaultInstance : appels simultanés = une seule instance, aucune erreur", async () => {
  await cat.add("race-mod", { manifest: { name: { fr: "Course", en: "Race" }, description: { fr: "d", en: "d" }, instances: "multiple", settings: [], permissions: [] }, files: { "index.mjs": "export default {};" } });
  assert.equal((await I.installFromCatalogue("race-mod", { dependencies: false })).ok, true);
  const results = await Promise.all(Array.from({ length: 6 }, () => ensureDefaultInstance("race-mod")));
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "race-mod" } }), 1);
  assert.equal(results.filter((r) => r?.kind === "created").length, 1);
  assert.equal(results.filter((r) => r?.kind === "present").length, 5);
});
