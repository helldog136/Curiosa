import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const dir = path.join(process.cwd(), "prisma", "migrations");
const frozen = JSON.parse(fs.readFileSync(path.join(dir, "frozen.json"), "utf8"));

test("une migration figée (déjà livrée) n'est jamais modifiée ni supprimée : on en ajoute une nouvelle", () => {
  for (const [name, sha] of Object.entries(frozen)) {
    const f = path.join(dir, name, "migration.sql");
    assert.ok(fs.existsSync(f), `${name} est figée mais a disparu`);
    assert.equal(createHash("sha256").update(fs.readFileSync(f)).digest("hex"), sha, `${name} est figée : ne la modifiez pas, ajoutez une migration (npm run migrations:freeze à chaque sortie)`);
  }
});

test("les migrations figées sont toutes au début de l'historique (aucune migration ajoutée AVANT une migration livrée)", () => {
  const all = fs.readdirSync(dir).filter((d) => /^\d{8,}_/.test(d)).sort();
  const last = Object.keys(frozen).sort().at(-1);
  if (last) for (const n of all) if (n < last) assert.ok(frozen[n], `${n} est antérieure à une migration livrée mais n'est pas figée : renommez-la avec un horodatage plus récent`);
});
