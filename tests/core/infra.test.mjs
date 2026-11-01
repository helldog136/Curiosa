import test from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
test.after(() => db.close());

test("l'infrastructure de test charge le code de src/ (alias, TS, JSON, Prisma)", async () => {
  const { setSetting, getSetting } = await import("@/core/settings");
  await setSetting("x", { a: 1 }, "fr");
  assert.deepEqual(await getSetting("x", "fr"), { a: 1 });
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  assert.equal(makeTranslator("fr")("action.save"), "Enregistrer");
});
