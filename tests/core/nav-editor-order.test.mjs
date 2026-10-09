import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync("src/components/admin/NavEditor.tsx", "utf8");

test("éditeur de menu : le libellé (ce qu'on lit) est demandé avant l'adresse (où ça mène)", () => {
  const link = src.slice(src.indexOf("return (\n      <>"));
  assert.ok(link.indexOf("labelFields(labels.label") > -1 && link.indexOf("labelFields(labels.label") < link.indexOf("labels.href}"), "libellé avant adresse");
  assert.match(src, /labels\.hrefHelp/, "aide courte sous le champ adresse");
});

test("éditeur de menu : pas de « — Langue » quand le site n'a qu'une langue ; un titre commun sinon", () => {
  assert.match(src, /locales\.length <= 1 \?/);
  assert.ok(!/\{title\} — /.test(src) && !/labels\.(label|groupName)\} — /.test(src), "jamais de « — Langue » accolé au titre");
  assert.match(src, /<fieldset[\s\S]*<legend/);
});

test("éditeur de menu : boutons de déplacement et de retrait avec texte, sous les champs", () => {
  assert.match(src, /↑ \{labels\.up\}/);
  assert.ok(!src.includes("absolute right-3 top-3"));
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  assert.ok(fr["navigation.hrefHelp"] && en["navigation.hrefHelp"]);
  assert.ok(!/raccourci/i.test(fr["navigation.hrefHelp"] + fr["navigation.href"] + fr["navigation.hrefPlaceholder"]));
});
