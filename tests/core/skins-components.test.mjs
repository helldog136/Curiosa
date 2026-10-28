// Composants du site public par les jetons (docs/SKINS.md §4.4, lot S3) : plus de valeur d'apparence en dur hors de la liaison `@theme inline` / des utilitaires de jetons,
// chaque jeton du vocabulaire est LU par le cœur, et le repli de chaque liaison est la valeur exacte d'avant (basic identique).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const T = await import("@/core/skins/tokens");
const read = (p) => fs.readFileSync(p, "utf8");
const css = read("src/app/globals.css");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx$/.test(e.name) ? [p] : [];
  });
}
const SITE = [...files("src/components/site"), ...files("src/app/(site)")];
/** Contenu des attributs `className` (chaînes et gabarits) de chaque fichier : c'est là que vivent les utilitaires. */
function classNames(src) {
  const out = [];
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of src.matchAll(/(?:const|let) (?:link|card|btn|input|wideClass|iconClass|LINK|tone|frame)\b[^=]*= *"([^"]*)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/^\s+(?:veil|accent|page):\s*"([^"]*)"/gm)) out.push(m[1]);
  return out;
}
const used = SITE.flatMap((f) => classNames(read(f)).flatMap((c) => c.split(/\s+/).filter(Boolean).map((u) => [f, u])));

test("les classes des composants du site public ne portent plus de valeur d'apparence en dur", () => {
  const forbidden = [
    /^(sm:|md:|lg:)?rounded-(xl|2xl|3xl)$/, /^(sm:|md:|lg:)?rounded$/, /^(sm:|md:|lg:)?border(-2)?$/, /^(sm:|md:)?border-[tby]$/,
    /^(hover:|focus-visible:)?(bg|text|border|outline)-(white|black)(\/\d+)?$/, /^shadow-\[/, /^max-w-(2xl|3xl|5xl)$/, /^(min-h|min-w|h)-11$/, /^leading-7$/, /^text-\[\d+px\]$/,
  ];
  const bad = used.filter(([, u]) => forbidden.some((re) => re.test(u)));
  assert.deepEqual(bad.map(([f, u]) => `${f} : ${u}`), []);
  // plus aucun `rounded-full` : pastilles d'état (`rounded-chip`), boutons, portraits (`rounded-avatar`) passent par un rayon de pièce
  assert.deepEqual(used.filter(([, u]) => u === "rounded-full"), []);
});

test("rayons de pièce : chaque liaison `--radius-<pièce>` a pour repli la valeur de basic, exactement", () => {
  const num = (v) => { const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(v.trim()); return m ? `${Number(m[1])}${m[2]}` : v.trim(); };
  const basic = T.basicTokenValues();
  for (const name of ["card", "panel", "button", "field", "chip", "media", "avatar"]) {
    const m = new RegExp(`--radius-${name}: var\\(--sk-radius-${name}, var\\((--sk-radius-[a-z0-9]+), ([^)]+)\\)\\);`).exec(css);
    assert.ok(m, `liaison --radius-${name}`);
    const literal = T.literalOf(`--sk-radius-${name}`, basic);
    assert.equal(num(m[2]), num(literal), `repli de --radius-${name}`);
    assert.ok(used.some(([, u]) => u.endsWith(`rounded-${name}`)), `rounded-${name} est employé`);
  }
});

test("noirs et blancs d'avant : les liaisons de couleur reprennent la valeur de basic", () => {
  const basic = T.basicTokenValues();
  assert.match(css, new RegExp(`--color-on-veil: var\\(--sk-color-on-veil, ${basic["--sk-color-on-veil"]}\\)`));
  assert.match(css, new RegExp(`--color-veil-ink: var\\(--sk-color-veil-ink, ${basic["--sk-color-veil-ink"]}\\)`));
  assert.match(css, new RegExp(`--color-scrim: var\\(--sk-color-scrim, ${basic["--sk-color-scrim"]}\\)`));
  assert.match(css, /--color-link: var\(--sk-color-link, var\(--v-accent\)\)/);
  assert.match(css, new RegExp(`--shadow-tray: var\\(--sk-shadow-tray, ${basic["--sk-shadow-tray"].replace(/[()]/g, "\\$&")}\\)`));
});

test("bordures et cibles : les utilitaires de jetons ont pour repli 1 px, 2 px et 2,75 rem", () => {
  const basic = T.basicTokenValues();
  assert.equal(basic["--sk-border-width"], "1px");
  assert.equal(basic["--sk-border-width-strong"], "2px");
  assert.equal(basic["--sk-target"], "2.75rem");
  assert.match(css, /@utility border-token \{[^}]*var\(--sk-border-width, 1px\)/);
  assert.match(css, /@utility border-token-strong \{[^}]*var\(--sk-border-width-strong, 2px\)/);
  assert.match(css, /@utility min-h-target \{ min-height: var\(--sk-target, 2\.75rem\); \}/);
});

test("largeurs, rythme et grille : repli = valeur d'avant", () => {
  const all = SITE.map(read).join("\n");
  assert.match(all, /max-w-\[var\(--sk-prose-width,42rem\)\]/);
  assert.match(all, /max-w-\[var\(--sk-prose-width-wide,48rem\)\]/);
  assert.match(all, /space-y-\[var\(--sk-stack-gap,1\.5rem\)\]/);
  assert.match(all, /minmax\(min\(100%,var\(--sk-cards-min,15rem\)\),1fr\)/);
  assert.match(all, /gap-\[var\(--sk-grid-gap,1\.25rem\)\]/);
  assert.match(all, /leading-\[var\(--sk-leading-body,1\.75rem\)\]/);
  const basic = T.basicTokenValues();
  for (const [k, v] of [["--sk-prose-width", "42rem"], ["--sk-prose-width-wide", "48rem"], ["--sk-stack-gap", "1.5rem"], ["--sk-cards-min", "15rem"], ["--sk-grid-gap", "1.25rem"], ["--sk-leading-body", "1.75rem"], ["--sk-page-width", "64rem"]]) assert.equal(basic[k], v, k);
});

test("chaque jeton du vocabulaire est lu par le cœur (feuille, composants, pages ou feuille de jetons)", () => {
  const sources = [css, read("src/core/skins/sheet.ts"), ...SITE.map(read)].join("\n");
  const unread = T.TOKEN_DEFS.map((d) => d.name).filter((n) => !sources.includes(n));
  assert.deepEqual(unread, []);
});

test("jetons facultatifs : définis par un skin, le cœur applique la sélection et la couleur des titres ; jamais sous basic", async () => {
  const { composeSkin } = await import("@/core/skins/compose");
  const { renderSheet } = await import("@/core/skins/sheet");
  const { BASIC } = await import("@/core/skins/basic");
  const basicSheet = renderSheet(composeSkin({}));
  assert.ok(!basicSheet.includes("::selection") && !basicSheet.includes("--sk-color-heading"));
  const skin = { ...BASIC, id: "opt-test", tokens: { ...BASIC.tokens, common: { ...BASIC.tokens.common, "--sk-color-selection": "#ffd54a", "--sk-color-heading": "#ffffff" } } };
  const sheet = renderSheet(composeSkin({ skin }));
  assert.match(sheet, /:root\[data-skin="opt-test"\] ::selection\{background-color:var\(--sk-color-selection\)\}/);
  assert.match(sheet, /\[data-skin-part="heading"\]\{color:var\(--sk-color-heading\)\}/);
});

test("l'administration n'est pas restylée : aucune règle de pièce du cœur sans `data-skin` ou sans région du site public", () => {
  // les règles sur les pièces sont sous `:where(:root[data-skin])` ou sous une région / `[data-site-nav]` / `[data-skin-part="brand"]` (absents de l'administration)
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => /\[data-skin-(part|region)=/.test(l) && /\{/.test(l));
  for (const l of rules) assert.match(l, /:where\(:root\[data-skin\]\)|\[data-site-nav\]|\[data-skin-region=|\[data-skin-part="brand"\]/, l.slice(0, 100));
});
