// L'exemple minimal de skin de docs/SKINS.md §17 doit passer l'assainisseur et le contrôle de lisibilité tels quels.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { sanitizeSkinCss, sanitizeTokenValue } = await import("@/core/skins/sanitize");
const R = await import("@/core/skins/readability");
const C = await import("@/core/color");
const { parseColor } = await import("@/core/skins/colorParse");

const doc = fs.readFileSync(path.join(import.meta.dirname, "../../docs/SKINS.md"), "utf8");
const section = doc.slice(doc.indexOf("## 17. Exemple complet d'un skin minimal"), doc.indexOf("## 18."));
const blocks = [...section.matchAll(/```(json|css)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], text: m[2] }));
const manifest = JSON.parse(blocks[0].text);
const tokens = JSON.parse(blocks[1].text);
const css = blocks[2].text;

test("§17 : le document contient bien les trois fichiers de l'exemple", () => {
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.lang), ["json", "json", "css"]);
  assert.equal(manifest.id, "plain-light");
  assert.deepEqual(manifest.modes, ["light"]);
  assert.ok(css.includes('[data-skin-part="card"]'));
});

test("§17 : skin.css passe l'assainisseur sans aucun problème", () => {
  const r = sanitizeSkinCss(css, { skinId: manifest.id, assets: manifest.assets.map((a) => a.file) });
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assertSafeOutput(assert, r.css, manifest.id);
  const P = `:root[data-skin="plain-light"] `;
  assert.ok(r.css.includes(`${P}[data-skin-part="card"]{box-shadow:var(--sk-shadow-card);transition:transform var(--sk-duration) var(--sk-ease), box-shadow var(--sk-duration) var(--sk-ease)}`), r.css);
  assert.ok(r.css.includes(`@media (prefers-reduced-motion: no-preference){\n${P}[data-skin-part="card"]:hover{transform:translatey(-2px);box-shadow:0 6px 16px rgb(0 0 0 / 0.12)}\n}`));
  assert.ok(r.css.includes(`${P}[data-skin-region="header"]{border-bottom:2px solid var(--v-accent)}`));
  assert.ok(r.css.includes(`${P}[data-skin-part="button"][data-btn="primary"]{font-weight:var(--sk-weight-bold)}`));
  assert.ok(r.css.includes(`@media (min-width: 40rem){\n${P}[data-skin-region="header"]{display:flex;justify-content:space-between;align-items:center}\n}`));
  assert.equal(r.stats.rules, 7);
  assert.deepEqual(r.stats.assets, []);
  // le résultat se ré-assainit à l'identique
  assert.equal(sanitizeSkinCss(r.css, { skinId: manifest.id }).css, r.css);
});

test("§17 : chaque jeton de tokens.json passe la vérification des valeurs", () => {
  for (const group of [tokens.light, tokens.dark, tokens.common]) {
    for (const [name, value] of Object.entries(group)) {
      const r = sanitizeTokenValue(name, value, { skinId: manifest.id });
      assert.equal(r.ok, true, `${name}: ${value}`);
    }
  }
});

test("§17 : les valeurs du skin sont lisibles en mode clair (le seul mode déclaré)", () => {
  const effective = { ...C.buildPalette(tokens.light["--v-bg"], tokens.light["--v-accent"], { surface: tokens.light["--v-surface"], text: tokens.light["--v-fg"] }), ...tokens.light };
  const issues = R.checkReadability(effective, "light", { skinId: manifest.id, advice: true });
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  // le texte courant atteint même le niveau AAA
  assert.ok(!issues.some((i) => i.pair === 1 || i.pair === 2), JSON.stringify(issues.map((i) => [i.pair, i.ratio])));
});

test("§17 : les rapports de contraste annoncés par le document sont exacts", () => {
  const ratio = (a, b) => R.contrastRatio(parseColor(a), parseColor(b));
  assert.ok(ratio("#1b1b1f", "#fafaf7") > 15.5 && ratio("#1b1b1f", "#fafaf7") < 17, `≈ 16:1 : ${ratio("#1b1b1f", "#fafaf7")}`);
  assert.ok(Math.abs(ratio("#1d4ed8", "#fafaf7") - 6.5) < 0.3, `≈ 6,5:1 : ${ratio("#1d4ed8", "#fafaf7")}`);
  assert.ok(Math.abs(ratio("#ffffff", "#1d4ed8") - 6.7) < 0.3, `≈ 6,7:1 : ${ratio("#ffffff", "#1d4ed8")}`);
});
