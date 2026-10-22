import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const editor = fs.readFileSync("src/components/admin/NavEditor.tsx", "utf8");
const page = fs.readFileSync("src/app/admin/(panel)/navigation/page.tsx", "utf8");
const actions = fs.readFileSync("src/app/admin/(panel)/navigation/actions.ts", "utf8");

test("navigation : un seul arbre ordonné où pages, contenus, raccourcis, liens et sous-menus se mélangent, sans champs vides imposés", () => {
  assert.ok(!/\{ label: \{\}, href: "" \}/.test(page), "plus de lignes vides ajoutées d'office");
  assert.match(page, /ensureMenuMigrated\(\)/, "l'ancien menu est figé avant d'être modifié");
  assert.match(page, /describeMenuRefs\(items, ctx\)/, "les noms viennent de la base, jamais du navigateur");
  assert.match(editor, /name="items"/);
  assert.match(editor, /↑ \{strings\.up\}/);
  assert.match(editor, /↓ \{strings\.down\}/);
});

test("navigation : chaque élément a un bouton de retrait rouge « Retirer du menu » en bas de carte, avec Monter/Descendre (plus de corbeille)", () => {
  assert.ok(!editor.includes("absolute right-3 top-3"), "plus de corbeille en haut à droite");
  assert.ok(!editor.includes("🗑"), "plus d'icône corbeille");
  assert.match(editor, /ui\.btnDanger[^>]*onClick=\{\(\) => remove\(node\.uid\)\}/);
  assert.match(editor, /data-action="remove"[\s\S]{0,200}?>\{strings\.remove\}</, "bouton de retrait avec texte visible");
  assert.match(editor, /border-t border-line pt-3/, "filet qui sépare les boutons des champs");
  const fr = JSON.parse(read("src/locales/fr.json"));
  assert.equal(fr["navigation.remove"], "Retirer du menu");
});

test("navigation : côté serveur, les références viennent de la base (jamais du navigateur), les liens sont validés, les doublons et les lignes vides ignorés", () => {
  assert.match(actions, /existingRefs\(citedRefs\(raw\)\)/);
  assert.match(actions, /validateMenuInput\(raw/);
  assert.match(actions, /adminCtx\("admin"\)/);
  const input = read("src/core/menuInput.ts");
  assert.match(input, /seen\.has\(key\)/);
  assert.match(input, /isSafeExternalUrl\(href\)/);
  assert.match(input, /normalizeLinkInput\(/, "indulgent avant d'être strict (lot UX 0.2.1)");
  assert.match(input, /if \(!href && Object\.keys\(label\)\.length === 0\) return null/);
  assert.match(input, /MENU_MAX_TOTAL/);
});

test("catalogue : pas de bandeau « modules gratuits » (le README de chaque module dit comment le soutenir)", () => {
  assert.ok(!/catalogue\.free/.test(fs.readFileSync("src/app/admin/(panel)/catalogue/page.tsx", "utf8")));
});

test("sous-menus : un élément peut contenir des éléments (deux niveaux), se réordonne, et un sous-menu sans nom ou vide n'est pas enregistré", () => {
  assert.match(editor, /kind: "group"/);
  assert.match(editor, /data-testid=\{parent \? "nav-group" : undefined\}/);
  const input = read("src/core/menuInput.ts");
  assert.match(input, /if \(node\.kind === "group" && kids\.length === 0\) continue/, "un sous-menu vide est ignoré");
  assert.match(input, /Object\.keys\(label\)\.length === 0\) return \{ path: `\$\{path\}\.label`, error: t\("navigation\.error\.label"\) \}/, "un sous-menu sans nom est refusé, sous son champ");
  const nav = read("src/components/site/SiteNav.tsx");
  assert.match(nav, /aria-expanded=\{isOpen\}/);
  assert.match(nav, /e\.key === "Escape"/);
  assert.match(read("src/components/site/Header.tsx"), /<SiteNav items=\{items\}/);
  assert.ok(!fs.existsSync("src/components/site/NavDropdown.tsx"), "remplacé par SiteNav");
});

test("en-tête : quatre dispositions au choix, réseaux sociaux repris de TOUS les modules réseau actifs, lien secondaire et bouton validés", () => {
  const header = read("src/components/site/Header.tsx");
  for (const k of ['case "twoRows"', 'case "centered"', 'case "minimal"']) assert.ok(header.includes(k), k);
  assert.match(header, /loadSocialLinks\(locale\)/, "les réseaux viennent de tous les modules qui fournissent « social.link » — le cœur ne connaît aucun réseau");
  assert.match(read("src/core/social.ts"), /isSafeExternalUrl\(href\)/);
  const actions2 = read("src/app/admin/(panel)/settings/actions.ts");
  assert.match(actions2, /isHeaderLayout\(layout\) \? layout : "classic"/);
  assert.match(actions2, /!headerLink\("x", href\)\) return \{ error/);
  assert.match(read("src/app/admin/(panel)/settings/page.tsx"), /<HeaderLayoutPicker name="headerLayout"/);
});
