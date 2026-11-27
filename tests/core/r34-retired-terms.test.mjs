// R34 on the texts of the core (docs/ERGONOMIE-ADMIN.md, ADR 0011): « module » is the only word for a piece installed from the catalogue.
// Every FR and EN text of src/locales is scanned with retiredTerms() of the kit (testsupport/ergonomics.mjs): extension, plugin, add-on, fonctionnalité, feature.
// ALLOWED: a text that keeps a retired word because the word means something else there. It starts EMPTY and each line must say why; a line whose text no longer
// holds the word fails (remove it). It never grows silently: a new line is a reviewed decision. The rewrite itself is done by scripts/vocab-migrate.mjs (re-runnable).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { retiredTerms, RETIRED_WHITELIST } from "../../testsupport/ergonomics.mjs";

const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const locales = { fr: read("src/locales/fr.json"), en: read("src/locales/en.json") };

/** `lang:key` -> why this text may keep a retired word. */
const ALLOWED = new Map([]);

test("R34: no retired term in a visible text of the core (extension, plugin, add-on, fonctionnalité, feature)", () => {
  const found = [];
  for (const [lang, loc] of Object.entries(locales)) {
    for (const [key, text] of Object.entries(loc)) {
      if (typeof text !== "string" || ALLOWED.has(`${lang}:${key}`)) continue;
      const hits = retiredTerms(text, lang);
      if (hits.length) found.push(`${lang}:${key}: ${hits.join(", ")}: ${text.slice(0, 80)}`);
    }
  }
  assert.deepEqual(found, [], "write « module » (run: node scripts/vocab-migrate.mjs --write) or justify the text in ALLOWED");
});

test("R34: every allowed text still exists and still holds a retired word (the list does not rot)", () => {
  for (const [id, why] of ALLOWED) {
    assert.ok(why.length > 20, `${id}: say why`);
    const [lang, ...rest] = id.split(":");
    const text = locales[lang]?.[rest.join(":")];
    assert.equal(typeof text, "string", `${id} is gone: remove it from ALLOWED`);
    assert.ok(retiredTerms(text, lang).length > 0, `${id} no longer holds a retired word: remove it from ALLOWED`);
  }
  assert.equal(RETIRED_WHITELIST.length, 0, "the kit whitelist starts empty; add an entry only with a reason");
});

test("R34: the checker sees the retired words and spares the lookalikes", () => {
  assert.deepEqual(retiredTerms("Une extension installée", "fr"), ["extension"]);
  assert.deepEqual(retiredTerms("Cette fonctionnalité", "fr"), ["fonctionnalite"]);
  assert.deepEqual(retiredTerms("Install the add-on or the plugin", "en"), ["add-on", "plugin"]);
  assert.deepEqual(retiredTerms("A new feature", "en"), ["feature"]);
  assert.deepEqual(retiredTerms("Featured (shown first)", "en"), []);
  assert.deepEqual(retiredTerms("Un module installé", "*"), []);
});

test("R34: the migration script has nothing left to do (idempotent) and no text is left over", async () => {
  const { retiredLeftovers } = await import("../../scripts/vocab-migrate.mjs");
  assert.deepEqual(retiredLeftovers(), []);
});

test("R34: the kit documents the rule", async () => {
  const { RULES } = await import("../../testsupport/ergonomics.mjs");
  assert.ok(RULES.R34);
});
