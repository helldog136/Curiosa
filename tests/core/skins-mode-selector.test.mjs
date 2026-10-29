// Choix clair/sombre du visiteur dans la feuille d'un skin (docs/SKINS.md §3.8, décision Q-B) :
// [data-mode="light"|"dark"] est permis EN TÊTE de sélecteur seulement, et réécrit à côté de data-skin sur la racine.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const A = await import("@/core/skins/allowlist");

const ID = "duo-test";
const P = `:root[data-skin="${ID}"]`;
const run = (css) => sanitizeSkinCss(css, { skinId: ID });
const ok = (css) => { const r = run(css); assert.equal(r.ok, true, JSON.stringify(r.issues.map((i) => i.code))); assertSafeOutput(assert, r.css, ID); return r.css; };
const refused = (css) => { const r = run(css); assert.equal(r.ok, false, `devrait être refusé : ${css}`); assert.equal(r.css.includes("data-mode"), false, "rien de ce sélecteur ne sort"); return r.issues.map((i) => i.code); };

test("liste blanche : le qualificatif de mode est déclaré dans l'allowlist", () => {
  assert.equal(A.MODE_ATTRIBUTE, "data-mode");
  assert.deepEqual([...A.MODE_QUALIFIER_VALUES], ["light", "dark"]);
  assert.equal("data-mode" in A.STATE_ATTRIBUTES, false, "data-mode n'est PAS un attribut d'état utilisable n'importe où");
});

test("[data-mode] en tête, seul : réécrit sur la racine à côté de data-skin", () => {
  assert.equal(ok('[data-mode="dark"] [data-skin-part="card"]{color:red}'), `${P}[data-mode="dark"] [data-skin-part="card"]{color:red}`);
  assert.equal(ok('[data-mode="light"] > [data-skin-region="header"] a:hover{color:red}'), `${P}[data-mode="light"] [data-skin-region="header"] a:hover{color:red}`);
  assert.equal(ok("[data-mode='dark'] [data-skin-part='card']::before{content:\"·\"}"), `${P}[data-mode="dark"] [data-skin-part="card"]::before{content:"\\b7 "}`);
});

test("[data-mode] après le préfixe d'auteur :root[data-skin=\"<id>\"] : accepté, jamais doublé", () => {
  assert.equal(ok(`${P}[data-mode="dark"] [data-skin-part="card"]{color:red}`), `${P}[data-mode="dark"] [data-skin-part="card"]{color:red}`);
  assert.equal(ok(`${P}[data-mode="light"] > [data-skin-part="button"]{color:red}`), `${P}[data-mode="light"] [data-skin-part="button"]{color:red}`);
  // sans qualificatif, comme avant
  assert.equal(ok(`${P} [data-skin-part="card"]{color:red}`), `${P} [data-skin-part="card"]{color:red}`);
});

test("une liste de sélecteurs peut mélanger les modes ; chacun garde le sien", () => {
  const css = ok('[data-mode="dark"] [data-skin-part="card"], [data-mode="light"] [data-skin-part="card"], [data-skin-part="card"]{color:red}');
  assert.equal(css, `${P}[data-mode="dark"] [data-skin-part="card"],${P}[data-mode="light"] [data-skin-part="card"],${P} [data-skin-part="card"]{color:red}`);
});

test("dans une condition @media, le qualificatif de mode est permis aussi", () => {
  const css = ok('@media (min-width: 40rem){ [data-mode="dark"] [data-skin-region="header"]{border-bottom:1px solid #fff} }');
  assert.ok(css.includes(`${P}[data-mode="dark"] [data-skin-region="header"]`));
});

test("refusé : autre valeur, sans valeur, ailleurs qu'en tête, seul, dans :is/:not/:has, avec un opérateur", () => {
  assert.ok(refused('[data-mode="auto"] [data-skin-part="card"]{color:red}').includes("attribute-not-allowed"));
  assert.ok(refused('[data-mode] [data-skin-part="card"]{color:red}').includes("attribute-not-allowed"));
  assert.ok(refused('[data-mode="dark"]{color:red}').length > 0, "la racine seule ne se style pas");
  assert.ok(refused('[data-skin-part="card"][data-mode="dark"]{color:red}').includes("attribute-not-allowed"));
  assert.ok(refused('[data-skin-region="main"] [data-mode="dark"] a{color:red}').includes("attribute-not-allowed"));
  assert.ok(refused('[data-skin-part="card"]:not([data-mode="dark"]){color:red}').includes("attribute-not-allowed"));
  assert.ok(refused('[data-skin-part="card"]:is([data-mode="dark"]) a{color:red}').length > 0);
  assert.ok(refused('[data-mode^="d"] [data-skin-part="card"]{color:red}').length > 0);
  assert.ok(refused('[data-mode="dark"][data-mode="light"] [data-skin-part="card"]{color:red}').length > 0);
  assert.ok(refused('[data-mode="dark"] a{color:red}').includes("selector-needs-anchor"), "toujours ancré à une région ou une pièce");
  assert.ok(refused(':root[data-mode="dark"] [data-skin-part="card"]{color:red}').length > 0, ":root nu reste refusé");
  assert.ok(refused(':root[data-skin="autre"][data-mode="dark"] [data-skin-part="card"]{color:red}').length > 0);
});

test("le choix du visiteur n'ouvre aucune autre porte : les garde-fous de valeur restent actifs sous [data-mode]", () => {
  assert.ok(refused('[data-mode="dark"] [data-skin-part="heading"]{display:none}').length > 0);
  assert.ok(refused('[data-mode="dark"] [data-skin-part="card"]{background:url(https://evil.test/a.png)}').length > 0);
  assert.ok(refused('[data-mode="dark"] [data-skin-part="mode-switch"]{display:none}').length > 0, "la bascule ne se masque pas");
});
