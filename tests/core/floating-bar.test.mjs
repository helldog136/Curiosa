import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const form = read("src/components/admin/ActionForm.tsx");

test("barre flottante : n'apparaît que s'il y a des modifications, avec Enregistrer et Annuler, en bas à droite, sans masquer la page", () => {
  assert.match(form, /floating && visible/);
  assert.match(form, /const visible = !!floating && \(dirty \|\| recent !== null\)/);
  assert.match(form, /fixed right-4 z-40[\s\S]*sm:right-6/);
  assert.match(form, /type="submit" disabled=\{pending\}/, "Enregistrer = le même envoi que le bouton de la page");
  assert.match(form, /window\.confirm\(floating\.discardConfirm\)[\s\S]*window\.location\.reload\(\)/, "Annuler demande confirmation puis recharge");
  assert.match(form, /<div aria-hidden="true" className="h-12" \/>/, "de la place sous le dernier champ : la barre ne cache pas le contenu en fin de page");
});

test("barre flottante : détecte aussi les éditeurs qui changent leurs champs cachés sans événement (menu, accueil, thème), et une sauvegarde réussie remet la référence", () => {
  assert.match(form, /window\.setInterval\(check, 400\)/);
  assert.match(form, /if \(state\.ok\) baseline\.current = snapshot\(ref\.current\)/);
  assert.match(form, /\$ACTION/, "les champs internes de React ne comptent pas comme des modifications");
  assert.match(form, /beforeunload/);
  assert.match(form, /e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "s"/);
});

test("barre flottante : plusieurs formulaires modifiés sur une page ne se recouvrent pas ; branchée sur les formulaires qui MODIFIENT, pas sur ceux qui créent", () => {
  assert.match(form, /calc\(1\.25rem \+ \$\{Math\.max\(slot, 0\)\} \* 4\.25rem\)/);
  for (const [file, action] of [["settings/page.tsx", "saveSettings"], ["navigation/page.tsx", "saveNavigation"], ["home/page.tsx", "saveHome"], ["instances/[id]/page.tsx", "saveInstanceSettings"], ["entries/EntryForm.tsx", "saveEntry"]]) {
    assert.match(read(`src/app/admin/(panel)/${file}`), new RegExp(`<ActionForm action=\\{${action}\\} floating=\\{floatingLabels\\(t\\)\\}`), `${file} : ${action}`);
  }
  assert.ok(!/floating=/.test(read("src/app/admin/(panel)/users/page.tsx")), "formulaire de création : pas de barre");
  assert.ok(!/floating=/.test(read("src/app/admin/(auth)/login/page.tsx")));
});
