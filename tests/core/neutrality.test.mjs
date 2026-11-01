import test from "node:test";
import assert from "node:assert/strict";
import { parseNeutralityRules, findViolations } from "../helpers/neutrality.mjs";

const rules = parseNeutralityRules(`
# commentaire
acme-corp => README.md, src/brand.ts

jane-doe
`);

test("neutralité : analyse des règles (commentaires et lignes vides ignorés, exceptions par fichier)", () => {
  assert.equal(rules.length, 2);
  assert.deepEqual([...rules[0].allowed], ["README.md", "src/brand.ts"]);
  assert.equal(rules[1].allowed.size, 0);
  assert.deepEqual(parseNeutralityRules(""), []);
  assert.deepEqual(parseNeutralityRules(undefined), []);
});

test("neutralité : terme interdit partout, insensible à la casse, exception limitée aux fichiers listés", () => {
  const v = findViolations({ "README.md": "by ACME-Corp", "src/a.ts": "acme-corp", "src/b.ts": "Jane-Doe", "src/c.ts": "rien" }, rules);
  assert.deepEqual(v, [{ file: "src/a.ts", term: "acme-corp" }, { file: "src/b.ts", term: "jane-doe" }]);
});

test("neutralité : le terme est une expression régulière", () => {
  const r = parseNeutralityRules("jane-doe(\\.org)?");
  assert.equal(findViolations({ x: "jane-doe.org" }, r).length, 1);
  assert.equal(findViolations({ x: "jane doe" }, r).length, 0);
});
