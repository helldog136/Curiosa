import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");
const page = (d) => read(`src/app/admin/(panel)/${d}/page.tsx`);
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));

test("pages d'administration du site : le titre porte le même nom que le menu, en mode simple comme en mode avancé", () => {
  assert.match(page("settings"), /advanced \? t\("nav\.settings"\) : t\("nav\.settings\.simple"\)/);
  assert.match(page("navigation"), /advanced \? t\("nav\.navigation"\) : t\("nav\.navigation\.simple"\)/);
  assert.match(page("redirects"), /advanced \? t\("nav\.redirects"\) : t\("nav\.redirects\.simple"\)/);
});

test("réglages : chaque onglet commence par une phrase d'aide (pas un titre qui répète l'onglet), un seul enregistrement flottant, rien d'autre", () => {
  const p = page("settings");
  assert.ok(!/<h2 className="text-lg font-semibold">\{t\("settings\.(identity|languages|privacy|mail)"\)\}<\/h2>/.test(p), "le titre de l'onglet n'est pas répété");
  assert.match(p, /<ActionForm action=\{saveSettings\} floating=\{floatingLabels\(t\)\}/);
  assert.equal((p.match(/floating=/g) ?? []).length, 1);
  // Le formulaire principal est masqué en entier sur l'onglet e-mail : pas de vide au-dessus du formulaire d'e-mail.
  assert.match(p, /<div data-tab="site languages appearance privacy">\s*<ActionForm action=\{saveSettings\}/);
  // Les réglages facultatifs sont regroupés par intention, et seulement en mode avancé.
  assert.match(p, /\{advanced && \(\s*<div className=\{`\$\{ui\.card\} space-y-4`\}>\s*<h3 className="font-semibold">\{t\("settings\.contactCard"\)\}/);
  assert.match(p, /name="contactEmail"/);
  assert.match(p, /name="adminLocale"/);
});

test("raccourcis : état vide explicatif avec exemples, formulaire sans « — » ni option inutile, entrée à suivre repliée et seulement s'il y en a", () => {
  const p = page("redirects");
  assert.match(p, /redirects\.length === 0 \?/);
  assert.match(p, /t\("redirects\.examples"\)/);
  assert.match(p, /withUrl\.length > 0 && \(\s*<details/);
  assert.ok(!/label: "—"/.test(p));
  assert.match(p, /<ActionForm action=\{createRedirect\}[^>]*\breset\b/);
});

test("réseaux sociaux : liste compacte à ajouter, état vide qui dit quoi faire ensuite, et le nom de la page des réglages suit le mode", () => {
  const p = page("social");
  assert.match(p, /t\("social\.noneHelp"\)/);
  assert.match(p, /advanced \? t\("nav\.settings"\) : t\("nav\.settings\.simple"\)/);
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
  for (const k of ["settings.identityIntro", "settings.who", "settings.contactCard", "redirects.empty.simple", "social.noneHelp", "home.noFeatures", "home.cancel"]) {
    assert.ok(fr[k] && en[k], k);
  }
  for (const k of Object.keys(fr).filter((x) => /^(settings|redirects|social|navigation|home)\./.test(x) && !/^settings\.(bg|layer|glow)/.test(x))) {
    assert.ok(!/^Vide\s*=/i.test(fr[k]), `${k} : pré-remplir la valeur plutôt que « Vide = … »`);
    assert.ok(!/docs\/[A-Z-]+\.md/.test(fr[k]), `${k} : pas de renvoi à un fichier dans l'interface`);
  }
});
