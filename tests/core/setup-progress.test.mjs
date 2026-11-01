import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const P = await import("@/app/admin/(auth)/setup/progress");

test("assistant d'installation : aucun total affiché (il changeait de 4 à 5 selon un choix), numéro d'étape stable", () => {
  const wizard = fs.readFileSync("src/app/admin/(auth)/setup/SetupWizard.tsx", "utf8");
  assert.doesNotMatch(wizard, /visibleSteps\.length\}/, "le nombre d'étapes visibles ne s'affiche plus");
  assert.doesNotMatch(wizard, /step \+ 1\} \/ /);
  assert.match(wizard, /stepNumber\(step\)/);
  assert.equal(P.stepNumber(0), 1);
  assert.equal(P.stepNumber(2), 3);
  assert.equal(P.stepNumber(-4), 1);
});

test("assistant d'installation : la barre n'a pas de total variable, ne recule jamais, et se remplit à la dernière étape (avec ou sans l'étape des liens)", () => {
  // Sans l'étape des liens : 4 étapes (0..3) ; avec : 5 étapes (0..4). Choisir « liens » à l'étape 3 ne fait jamais reculer la barre.
  const without = [0, 1, 2, 3].map((s) => P.progressPercent(s, s === 3));
  const withLinks = [0, 1, 2, 3, 4].map((s) => P.progressPercent(s, s === 4));
  for (const seq of [without, withLinks]) { assert.deepEqual(seq, [...seq].sort((a, b) => a - b)); assert.equal(seq.at(-1), 100); }
  assert.equal(P.progressPercent(2, false), P.progressPercent(2, false), "même étape, même largeur quel que soit le choix");
  // L'étape 3 (modules, index 2) donne la même largeur que l'on choisisse les liens ou non : plus de saut « 3/4 → 4/5 ».
  assert.equal(without[2], withLinks[2]);
});
