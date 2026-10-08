import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
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
  assert.match(editor, /ui\.btnDanger[^>]*onClick=\{onRemove\}/);
  assert.match(editor, /setItems\(\(a\) => a\.filter\(\(x\) => x\.uid !== item\.uid\)\)/);
  assert.match(editor, /🗑/);
});

test("navigation : côté serveur, les pages viennent de la base (jamais du navigateur), les liens sont validés, les doublons et les lignes vides ignorés", () => {
  assert.match(actions, /known\.get\(String\(entry\.id\)\)/);
  assert.match(actions, /seen\.has\(page\.id\)/);
  assert.match(actions, /isSafeExternalUrl\(href\)/);
  assert.match(actions, /MAX_ITEMS/);
  assert.match(actions, /!href && Object\.keys\(label\)\.length === 0\) return null/);
});

test("catalogue : pas de bandeau « modules gratuits » (le README de chaque module dit comment le soutenir)", () => {
  assert.ok(!/catalogue\.free/.test(fs.readFileSync("src/app/admin/(panel)/catalogue/page.tsx", "utf8")));
});

test("menus déroulants : un groupe range des pages et des liens (un seul niveau), se réordonne, et n'est enregistré que nommé et non vide", () => {
  assert.match(editor, /k: "group", label: i\.label, items: i\.items\.map\(leafPayload\)/);
  assert.match(editor, /data-testid="nav-group"/);
  assert.ok(!/addGroup[^\n]*kind: "group"[^\n]*items: \[\{ uid[^\n]*kind: "group"/.test(editor), "pas de groupe dans un groupe");
  assert.match(actions, /entry\?\.k === "group"/);
  assert.match(actions, /if \(children\.length === 0\) continue/, "un groupe vide est ignoré");
  assert.match(actions, /Object\.keys\(label\)\.length === 0\) return \{ error: t\("navigation\.error\.label"\) \}/, "un groupe sans nom est refusé");
  assert.match(actions, /items\.push\(\{ href: "", label, children \}\)/);
  const dropdown = read("src/components/site/NavDropdown.tsx");
  assert.match(dropdown, /aria-expanded=\{open\}/);
  assert.match(dropdown, /e\.key === "Escape"/);
  assert.match(read("src/components/site/Header.tsx"), /<NavDropdown key=\{item\.label\}/);
});

test("en-tête : quatre dispositions au choix, réseaux sociaux repris de TOUTES les listes actives, lien secondaire et bouton validés", () => {
  const header = read("src/components/site/Header.tsx");
  for (const k of ['case "twoRows"', 'case "centered"', 'case "minimal"']) assert.ok(header.includes(k), k);
  assert.match(header, /instance\.display !== "links"/, "toutes les listes d'affichage « liens », quel que soit le module — le cœur ne connaît aucun module");
  assert.match(header, /isSafeExternalUrl\(e\.url\)/);
  const actions2 = read("src/app/admin/(panel)/settings/actions.ts");
  assert.match(actions2, /isHeaderLayout\(layout\) \? layout : "classic"/);
  assert.match(actions2, /!headerLink\("x", href\)\) return \{ error/);
  assert.match(read("src/app/admin/(panel)/settings/page.tsx"), /<HeaderLayoutPicker name="headerLayout"/);
});
