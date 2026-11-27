import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const P = await import("@/app/admin/(auth)/setup/progress");

test("setup wizard (C5i, R8): three screens, the total is known and shown (“Step 2 of 3”)", () => {
  const wizard = fs.readFileSync("src/app/admin/(auth)/setup/SetupWizard.tsx", "utf8");
  assert.match(wizard, /const STEPS = \["welcome", "identity", "account"\] as const/);
  assert.match(wizard, /setup\.stepOf/);
  assert.match(wizard, /stepNumber\(step\)/);
  assert.equal(P.MAX_STEPS, 3);
  assert.equal(P.stepNumber(0), 1);
  assert.equal(P.stepNumber(2), 3);
  assert.equal(P.stepNumber(-4), 1);
  assert.equal(P.stepNumber(9), 3, "never past the last screen");
});

test("setup wizard: the bar never goes back and fills on the last screen", () => {
  const seq = [0, 1, 2].map((s) => P.progressPercent(s, s === 2));
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
  assert.deepEqual(seq, [33, 67, 100]);
});
