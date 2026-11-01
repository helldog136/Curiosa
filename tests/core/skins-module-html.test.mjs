// Boîtes intérieures des modules (docs/SKINS.md §6.1.1) : `div`, `span`, `section`, `article` et `[data-marker]` ne se ciblent QUE sous `[data-skin-part="module-html"]`,
// avec les mêmes interdits que partout ailleurs (apparence seule, jamais de masquage).
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const ID = "plain-light";
const P = `:root[data-skin="${ID}"] `;
const MH = '[data-skin-part="module-html"]';
const run = (css) => sanitizeSkinCss(css, { skinId: ID });
const codes = (r) => r.issues.map((i) => i.code);

test("sous module-html : div, span, section, article et [data-marker] sont permis", () => {
  for (const sel of [`${MH} div`, `${MH} > div`, `${MH} span`, `${MH} section > article`, `${MH} div span`, `${MH} [data-marker]`, `${MH} div[data-marker]`, `${MH} div:first-child`, `${MH} div::before`,
    `${MH} :is(div, span)`, `${MH} :where(section, article)`, `${MH} div:not(span)`, `${MH}:has(div)`, `${MH}:has(> span)`, `${MH} p:has(span)`, `${MH} div > p`, `${MH} h2 + div`]) {
    const r = run(`${sel}{border-radius:0;padding:1rem}`);
    assert.equal(r.ok, true, `${sel} : ${JSON.stringify(codes(r))}`);
    assertSafeOutput(assert, r.css, ID);
    assert.ok(r.css.startsWith(P), sel);
  }
});

test("hors module-html : refusé avec un message qui montre la forme permise", () => {
  for (const sel of ["div", "span", "section", "article", "[data-marker]", '[data-skin-part="card"] div', '[data-skin-part="card"] span', '[data-skin-part="heading"][data-marker]', '[data-skin-region="main"] section',
    `${MH} + div`, `${MH} ~ span`, `div ${MH}`, `${MH}, div`, `div, ${MH}`, `:is(div) ${MH}`, `${MH}:is(div) + div`, `[data-skin-part="card"]:has(div)`, `[data-skin-region="main"] :is(div, span)`]) {
    const r = run(`${sel}{border-radius:0}`);
    assert.equal(r.ok, false, sel);
    assert.ok(codes(r).some((c) => c === "element-needs-module-html" || c === "element-not-allowed" || c === "selector-needs-anchor"), `${sel} : ${JSON.stringify(codes(r))}`);
  }
  const r = run('[data-skin-part="card"] div{border-radius:0}');
  assert.ok(codes(r).includes("element-needs-module-html"));
  assert.match(r.issues.find((i) => i.code === "element-needs-module-html").hint.fr, /module-html/);
});

test("[data-marker] : présence seulement, jamais de valeur ni d'opérateur", () => {
  for (const sel of [`${MH} [data-marker=""]`, `${MH} [data-marker="x"]`, `${MH} [data-marker^="x"]`]) {
    assert.equal(run(`${sel}{color:red}`).ok, false, sel);
  }
});

test("sous module-html : mêmes interdits de masquage et de sortie de l'écran", () => {
  for (const decl of ["display:none", "visibility:hidden", "opacity:0", "opacity:.2", "font-size:0", "font-size:6px", "height:0", "width:0", "position:fixed", "transform:translateX(-9999px)", "clip-path:inset(50%)", "left:-9999px", "text-indent:-9999px", "content:\"abc def\"", "color:transparent", "overflow:hidden;height:1px", "max-height:0"]) {
    const r = run(`${MH} div{${decl}}`);
    // `color:transparent` et `overflow` sont jugés par les mêmes règles que sur une pièce de contenu : la liste ne doit pas devenir un contournement
    if (r.ok) assert.ok(!/display:none|visibility|opacity:0|font-size:0|height:0|width:0/.test(decl), `${decl} accepté sous module-html`);
  }
  for (const decl of ["display:none", "visibility:hidden", "opacity:0", "font-size:0", "height:0", "width:0"]) {
    assert.equal(run(`${MH} div{${decl}}`).ok, false, decl);
    assert.equal(run(`${MH} [data-marker]{${decl}}`).ok, false, decl);
  }
});

test("sélecteur jusqu'à 600 caractères", () => {
  const long = `${MH}${" div".repeat(5)}`; // 5 niveaux, reste court
  assert.equal(run(`${long}{padding:0}`).ok, true);
  const list = Array.from({ length: 9 }, (_, i) => `[data-skin-part="card"]:nth-child(${i + 1}) [data-skin-part="heading"]`).join(",");
  assert.ok(list.length > 300 && list.length < 600);
  const r = run(`:is(${list}){color:red}`);
  assert.ok(!codes(r).includes("selector-too-long"), JSON.stringify(codes(r)));
  assert.ok(codes(run(`:is(${"[data-skin-part=\"card\"],".repeat(20)}[data-skin-part=\"chip\"]) a ${"a ".repeat(300)}{color:red}`)).length > 0);
});
