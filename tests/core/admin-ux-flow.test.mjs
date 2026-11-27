import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");
const page = (d) => read(`src/app/admin/(panel)/${d}/page.tsx`);
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));

test("pages d'administration du site : le titre porte le même nom que le menu, en mode simple comme en mode avancé", () => {
  assert.match(page("settings"), /<h1 className=\{ui\.pageTitle\}>\{t\("nav\.settings"\)\}<\/h1>/);
  // The menu page is a tab of "Home and menu": same name in both modes ("Navigation" is gone), see tests/core/home-menu-entry.test.mjs.
  assert.match(page("navigation"), /title=\{t\("navigation\.title"\)\}/);
  assert.match(page("redirects"), /<h1 className=\{ui\.pageTitle\}>\{t\("nav\.redirects"\)\}<\/h1>/, "one name, \"Short links\", in both modes");
});

test("réglages : chaque onglet commence par une phrase d'aide (pas un titre qui répète l'onglet), un seul enregistrement flottant, rien d'autre", () => {
  const p = page("settings");
  assert.ok(!/<h2 className="text-lg font-semibold">\{t\("settings\.(identity|languages|privacy|mail)"\)\}<\/h2>/.test(p), "le titre de l'onglet n'est pas répété");
  assert.match(p, /<ActionForm action=\{saveSettings\} floating=\{floatingLabels\(t\)\}/);
  // C5e: every settings form (identity, search, sound, e-mail) opts in to the sticky bar, but the bar itself is shared: ActionForm renders it once per page
  // (`slot <= 0`, checked in floating-bar.test.mjs) and its Save sends every modified form. The old count of 1 only counted source occurrences.
  assert.equal((p.match(/floating=/g) ?? []).length, 4);
  for (const a of ["saveSettings", "saveSearch", "saveSound", "saveMail"]) assert.match(p, new RegExp(`<ActionForm action=\\{${a}\\} floating=`));
  assert.ok(!/hideSubmit/.test(p), "no second Save button next to the shared bar");
  // Le formulaire principal est masqué en entier sur l'onglet e-mail : pas de vide au-dessus du formulaire d'e-mail.
  assert.match(p, /<div data-tab="site languages privacy">\s*<ActionForm action=\{saveSettings\}/);
  // Contact et pied de page : dans les deux modes (en mode simple, replié sous « Plus d'options ») ; seul le fuseau horaire reste réservé au mode avancé.
  assert.match(p, /\{advanced \? \(\s*<div className=\{`\$\{ui\.card\} space-y-4`\}>\s*<h3 className="font-semibold">\{t\("settings\.contactCard"\)\}/);
  assert.match(p, /<MoreOptions title=\{t\("settings\.contactCard"\)\}/);
  assert.match(p, /\{advanced && <TextField name="timezone"/);
  assert.match(p, /name="contactEmail"/);
  assert.match(p, /name="adminLocale"/);
});

test("raccourcis : état vide explicatif avec exemples, formulaire sans « — » ni option inutile, entrée à suivre repliée et seulement s'il y en a", () => {
  const p = page("redirects");
  assert.match(p, /redirects\.length === 0 \?/);
  assert.match(p, /t\("redirects\.examples"\)/);
  assert.match(p, /<(?:details|MoreOptions)[\s\S]*withUrl\.length > 0 && \(/, "l'entrée à suivre est dans une zone repliée, et seulement s'il y en a");
  assert.ok(!/label: "—"/.test(p));
  assert.match(p, /<ActionForm action=\{createRedirect\}[^>]*\breset\b/);
});

test("réseaux sociaux : liste compacte à ajouter, état vide qui dit quoi faire ensuite, et le nom de la page des réglages suit le mode", () => {
  const p = page("social");
  assert.match(p, /t\("social\.noneHelp"\)/);
  assert.match(p, /t\("social\.header\.label"\)/);
  assert.ok(!/ui\.btnPrimary/.test(p), "un bouton « Ajouter » par ligne reste discret");
  assert.match(p, /data-testid="social-available"/);
});

test("accueil : le sélecteur de blocs a un bouton « Annuler » lisible et n'affiche pas un groupe vide sans explication", () => {
  const b = read("src/components/admin/HomeBuilder.tsx");
  assert.ok(!b.includes(">↩</button>"));
  assert.match(b, /labels\.cancel/);
  assert.match(b, /choices\.every\(\(c\) => c\.core\) && <p className=\{ui\.help\}>\{labels\.noFeatures\}/);
});

test("textes : mêmes clés en français et en anglais, aucune consigne « Vide = » ni renvoi à un fichier dans les pages revues", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["settings.who", "settings.contactCard", "redirects.empty.simple", "social.noneHelp", "home.noFeatures", "home.cancel"]) {
    assert.ok(fr[k] && en[k], k);
  }
  for (const k of Object.keys(fr).filter((x) => /^(settings|redirects|social|navigation|home)\./.test(x) && !/^settings\.(bg|layer|glow)/.test(x))) {
    assert.ok(!/^Vide\s*=/i.test(fr[k]), `${k} : pré-remplir la valeur plutôt que « Vide = … »`);
    assert.ok(!/docs\/[A-Z-]+\.md/.test(fr[k]), `${k} : pas de renvoi à un fichier dans l'interface`);
  }
});
