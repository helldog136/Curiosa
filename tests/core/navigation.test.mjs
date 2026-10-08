import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const editor = fs.readFileSync("src/components/admin/NavEditor.tsx", "utf8");
const page = fs.readFileSync("src/app/admin/(panel)/navigation/page.tsx", "utf8");
const actions = fs.readFileSync("src/app/admin/(panel)/navigation/actions.ts", "utf8");

test("navigation : une seule liste ordonnée où pages et liens se mélangent, sans champs vides imposés", () => {
  assert.ok(!/\{ label: \{\}, href: "" \}/.test(page), "plus de lignes vides ajoutées d'office");
  assert.match(page, /byHref\.get\(n\.href\)/, "une entrée du menu qui correspond à une page est présentée comme une page, dans l'ordre du menu");
  assert.match(editor, /name="items"/);
  assert.match(editor, /aria-label=\{labels\.up\}/);
  assert.match(editor, /aria-label=\{labels\.down\}/);
});

test("navigation : chaque élément a une corbeille rouge en haut à droite pour le retirer", () => {
  assert.match(editor, /absolute right-3 top-3/);
  assert.match(editor, /ui\.btnDanger[^>]*onClick=\{\(\) => setItems\(\(a\) => a\.filter/);
  assert.match(editor, /🗑/);
});

test("navigation : côté serveur, les pages viennent de la base (jamais du navigateur), les liens sont validés, les doublons et les lignes vides ignorés", () => {
  assert.match(actions, /known\.get\(String\(entry\.id\)\)/);
  assert.match(actions, /seen\.has\(page\.id\)/);
  assert.match(actions, /isSafeExternalUrl\(href\)/);
  assert.match(actions, /MAX_ITEMS/);
  assert.match(actions, /!href && Object\.keys\(label\)\.length === 0\) continue/);
});

test("catalogue : pas de bandeau « modules gratuits » (le README de chaque module dit comment le soutenir)", () => {
  assert.ok(!/catalogue\.free/.test(fs.readFileSync("src/app/admin/(panel)/catalogue/page.tsx", "utf8")));
});
