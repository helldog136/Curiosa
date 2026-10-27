// Jetons de design (docs/SKINS.md §4) : vocabulaire défini une fois, skin basic = apparence ACTUELLE, validation par type, liaison Tailwind avec repli.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const T = await import("@/core/skins/tokens");
const { BASIC } = await import("@/core/skins/basic");
const C = await import("@/core/color");
const { VAR_NAME_RE } = await import("@/core/skins/allowlist");

const read = (p) => fs.readFileSync(p, "utf8");
const css = read("src/app/globals.css");

/** Une valeur CSS ramenée à une forme comparable : espaces, casse, zéros inutiles (« 0.25rem » = « .25rem »). */
const norm = (v) => String(v).replace(/'/g, '"').replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().toLowerCase().replace(/(^|[^0-9])0\./g, "$1.");
/** Deux valeurs égales, en comptant « rgb(0 0 0 / 0.1) » et « #0000001a » comme la même couleur (le CSS compilé écrit l'une ou l'autre). */
function sameValue(a, b) {
  if (norm(a) === norm(b)) return true;
  const strip = (s) => String(s).replace(/rgb\(0 0 0 \/ (\.?\d*\.?\d+)\)/g, (m, x) => `#000000${Math.round(Number(x) * 255).toString(16).padStart(2, "0")}`);
  return norm(strip(a)) === norm(strip(b));
}

test("vocabulaire : noms valides et uniques, un type et un rôle pour chacun", () => {
  const names = T.TOKEN_DEFS.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, "pas de doublon");
  for (const d of T.TOKEN_DEFS) {
    assert.match(d.name, VAR_NAME_RE, d.name);
    assert.ok(d.name.startsWith("--v-") || d.name.startsWith("--sk-"), d.name);
    assert.ok(d.role.length > 5, d.name);
  }
  // les --v-* existants gardent leur nom (contrat public des modules)
  for (const n of ["--v-bg", "--v-fg", "--v-muted", "--v-surface", "--v-line", "--v-accent", "--v-accent-fg", "--v-success", "--v-warning", "--v-danger", "--v-accent2", "--v-accent2-fg", "--v-gradient", "--v-font"]) assert.ok(T.isKnownToken(n), n);
  // les groupes du §4.2 sont tous là
  for (const g of ["color", "typography", "space", "radius", "border", "shadow", "motion", "layout"]) assert.ok(T.TOKEN_DEFS.some((d) => d.group === g), g);
  // jetons obligatoires du §4.2
  for (const n of ["--sk-space", "--sk-page-width", "--sk-radius-card", "--sk-radius-button", "--sk-shadow-pop", "--sk-duration", "--sk-target", "--sk-shell-areas", "--sk-flow-gap", "--sk-vh-large-basis", "--sk-leading-body", "--sk-heading-transform"]) assert.ok(T.isKnownToken(n), n);
});

test("basic : définit chaque jeton du vocabulaire (sauf les deux facultatifs) et chaque valeur passe la validation", () => {
  const defined = { ...BASIC.tokens.common, ...BASIC.tokens.dark };
  const optional = T.TOKEN_DEFS.filter((d) => d.basic === null).map((d) => d.name).sort();
  assert.deepEqual(optional, ["--sk-color-heading", "--sk-color-selection"], "jetons facultatifs que basic ne fixe pas");
  for (const d of T.TOKEN_DEFS) {
    if (d.basic === null) { assert.equal(defined[d.name], undefined, d.name); continue; }
    assert.equal(defined[d.name], d.basic, `tokens.json de basic = vocabulaire : ${d.name}`);
    const r = T.validateTokenValue(d.name, d.basic);
    assert.ok(r.ok, `${d.name} = ${d.basic} : ${JSON.stringify(r.issues?.map((i) => i.code))}`);
  }
  assert.deepEqual(Object.keys(defined).filter((n) => !T.isKnownToken(n)), [], "basic ne définit rien hors vocabulaire");
  assert.deepEqual(BASIC.modes, ["dark"]);
  assert.equal(BASIC.colorScheme, false, "aucun color-scheme : l'apparence actuelle n'en pose pas");
  assert.equal(BASIC.css, "");
  assert.equal(BASIC.deriveFromBackground, true);
});

test("basic : les couleurs sont EXACTEMENT celles du thème d'avant les skins (buildPalette du fond et de l'accent par défaut)", () => {
  const p = C.buildPalette("#121214", "#e8a23b");
  const dark = BASIC.tokens.dark;
  for (const [k, v] of Object.entries(p)) {
    if (k === "--v-accent2") { assert.equal(dark[k], "var(--v-accent)", "accent2 = accent tant qu'il n'est pas choisi"); assert.equal(v, "#e8a23b"); continue; }
    assert.equal(dark[k], v, k);
  }
  assert.equal(BASIC.tokens.common["--v-font"], C.FONT_STACKS.sans);
  // et ce sont les défauts que le site utilise quand aucun réglage n'existe
  assert.match(read("src/core/settings.ts"), /theme\.accent"\)\) \?\? "#e8a23b"/);
  assert.match(read("src/core/settings.ts"), /theme\.background"\)\) \?\? "#121214"/);
});

test("basic : chaque valeur reliée à Tailwind est celle de Tailwind 4.3.3 (theme.css) ; la liaison @theme inline a pour repli cette valeur", () => {
  const theme = read("node_modules/tailwindcss/theme.css");
  const tw = (name) => {
    const m = new RegExp(`\\n  ${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(theme);
    return m ? m[1].replace(/\s+/g, " ").trim() : null;
  };
  const block = css.slice(css.indexOf("@theme inline"), css.indexOf("/* Valeurs par défaut"));
  const bindings = [...block.matchAll(/\n\s*(--[a-z0-9-]+): var\((--sk-[a-z0-9-]+), ([^;]+)\);/g)].map((m) => ({ tw: m[1], sk: m[2], fallback: m[3] }));
  assert.ok(bindings.length === 30, `liaisons trouvées : ${bindings.length}`);
  for (const b of bindings) {
    const def = T.TOKEN_BY_NAME.get(b.sk);
    assert.ok(def && def.basic !== null, `${b.sk} est un jeton du vocabulaire avec une valeur de basic`);
    assert.ok(sameValue(b.fallback, tw(b.tw)), `repli de ${b.tw} (${b.fallback}) = valeur de Tailwind (${tw(b.tw)})`);
    assert.ok(sameValue(def.basic, tw(b.tw)), `basic ${b.sk} (${def.basic}) = valeur de Tailwind ${b.tw} (${tw(b.tw)})`);
  }
  // les échelles reliées : rayons, textes, graisses, interlettrage, espace, ombre, mouvement, police mono
  const bound = new Set(bindings.map((b) => b.tw));
  for (const n of ["--spacing", "--radius-xl", "--radius-2xl", "--text-sm", "--text-5xl", "--font-weight-semibold", "--tracking-tight", "--shadow-lg", "--font-mono", "--default-transition-duration", "--default-transition-timing-function"]) assert.ok(bound.has(n), n);
});

test("liaison : repères de globals.css (focus, accueil fluide) ont pour repli la valeur d'origine", () => {
  assert.match(css, /outline: var\(--sk-focus-width, 2px\) solid var\(--sk-color-focus, var\(--color-accent\)\);/);
  assert.match(css, /outline-offset: var\(--sk-focus-offset, 2px\);/);
  assert.match(css, /gap: var\(--sk-flow-gap, 2rem 1\.5rem\)/);
  for (const [n, v] of [["small", "14rem"], ["medium", "22rem"], ["large", "34rem"]]) {
    assert.match(css, new RegExp(`\\.vh-${n}\\s*\\{ --vh-basis: var\\(--sk-vh-${n}-basis, ${v}\\);`));
    assert.equal(T.TOKEN_BY_NAME.get(`--sk-vh-${n}-basis`).basic, v);
  }
});

test("l'administration ne définit AUCUN --sk-* et garde ses valeurs (le repli)", () => {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p); else files.push(p); } };
  walk("src/app/admin"); walk("src/components/admin");
  files.push("src/core/adminTheme.ts");
  for (const f of files) assert.ok(!/--sk-/.test(read(f)), `${f} ne définit ni n'emploie de jeton --sk-*`);
  // le skin n'est posé que par la mise en page du site public
  assert.ok(!/data-skin/.test(read("src/app/admin/layout.tsx")));
  assert.match(read("src/app/(site)/layout.tsx"), /data-skin=\{look\.composed\.skinId\}/);
});

// ── validation par type : mêmes minimums que l'assainisseur
const bad = (name, value) => { const r = T.validateTokenValue(name, value); assert.equal(r.ok, false, `${name}: ${value} devrait être refusé`); return r; };
const good = (name, value) => { const r = T.validateTokenValue(name, value); assert.equal(r.ok, true, `${name}: ${value} devrait passer : ${JSON.stringify(r.issues?.map((i) => i.code))}`); return r.value; };

test("validation : taille de texte >= 0,6875 rem (11 px), comme l'assainisseur", () => {
  good("--sk-text-xs", "0.6875rem"); good("--sk-text-xs", "11px"); good("--sk-text-sm", "clamp(0.875rem, 1vw + 0.5rem, 1rem)");
  bad("--sk-text-xs", "0.5rem"); bad("--sk-text-sm", "10px"); bad("--sk-text-base", "0"); bad("--sk-text-lg", "calc(0px)"); bad("--sk-text-lg", "red"); bad("--sk-text-lg", "xx-small");
});

test("validation : types (longueur, graisse, durée, courbe, casse, bordure, ombre, police, cible)", () => {
  good("--sk-radius-card", "0"); good("--sk-radius-card", "0.5rem"); good("--sk-radius-card", "var(--sk-radius-lg)"); bad("--sk-radius-card", "red"); bad("--sk-radius-card", "1 2 3");
  good("--sk-weight-bold", "700"); bad("--sk-weight-bold", "bold"); bad("--sk-weight-bold", "1000"); bad("--sk-weight-bold", "650.5");
  good("--sk-duration", "200ms"); good("--sk-duration", "0.3s"); bad("--sk-duration", "700ms"); bad("--sk-duration", "2s"); bad("--sk-duration", "1rem");
  good("--sk-ease", "ease-in-out"); good("--sk-ease", "cubic-bezier(0.2, 0, 0, 1)"); bad("--sk-ease", "banana"); bad("--sk-ease", "200ms");
  good("--sk-heading-transform", "uppercase"); bad("--sk-heading-transform", "scroll"); bad("--sk-eyebrow-transform", "10px");
  good("--sk-border-style", "dashed"); bad("--sk-border-style", "banana"); good("--sk-border-width", "3px");
  good("--sk-shadow-card", "none"); good("--sk-shadow-card", "6px 6px 0 var(--v-fg)"); good("--sk-shadow-card", "0 1px 2px rgb(0 0 0 / 0.08), 0 8px 20px -10px rgb(0 0 0 / 0.3)");
  good("--v-font", '"Skin Body", Georgia, serif'); bad("--v-font", 'url(https://example.org/f.woff2)'); bad("--v-font", '"a<b"');
  good("--sk-target", "2.75rem"); good("--sk-target", "3rem"); bad("--sk-target", "2rem"); bad("--sk-target", "30px");
  good("--sk-page-width", "42rem"); good("--sk-page-width", "min(100%, 60rem)"); bad("--sk-page-width", "2px");
  good("--sk-shell-columns", "minmax(0, 1fr)"); good("--sk-shell-columns", "16rem minmax(0, 1fr)"); good("--sk-shell-areas", '"header main" "footer footer"');
  good("--sk-flow-gap", "2rem 1.5rem"); good("--sk-flow-gap", "1rem"); bad("--sk-flow-gap", "1rem 2rem 3rem");
  good("--sk-leading-body", "1.75rem"); good("--sk-leading-body", "1.6");
  good("--sk-tracking-wide", "0.05em"); bad("--sk-tracking-wide", "20px");
});

test("validation : couleurs (hexadécimal, rgb, oklch, color-mix, var), dégradé, opacité du voile", () => {
  for (const v of ["#fafaf7", "#fff", "rgb(10 20 30 / 0.5)", "oklch(0.7 0.1 200)", "color-mix(in srgb, var(--v-bg) 80%, white)", "var(--v-accent)", "hsl(200 50% 50%)"]) good("--v-bg", v);
  bad("--v-bg", "url(https://example.org/x.png)"); bad("--v-bg", "expression(alert(1))"); bad("--v-bg", "#12"); bad("--v-bg", "12px"); bad("--v-bg", "red !important");
  good("--v-gradient", "linear-gradient(120deg, #e8a23b, #5fd3cc)"); bad("--v-gradient", "#fff");
  good("--sk-color-veil", "rgb(0 0 0 / .55)");
});

test("validation : sûreté (url externe, data:, import, accolades, caractères non ASCII, 300 caractères)", () => {
  for (const v of ["url(https://evil.test/a.png)", "url(data:image/png;base64,AAAA)", "@import 'x'", "1px}body{display:none", "1px;color:red", "1rem‮", "javascript:alert(1)", "calc(1px + expression(1))"]) bad("--sk-radius-card", v);
  bad("--sk-radius-card", `${"1px ".repeat(100)}`);
  bad("--sk-shadow-card", "0 0 0 " + "a".repeat(400));
});

test("validation : jeton inconnu = ignoré sans erreur (unknown), jeton de module via le vocabulaire fourni", () => {
  const r = T.validateTokenValue("--sk-inconnu-du-vocabulaire", "1px");
  assert.equal(r.ok, false); assert.equal(r.unknown, true); assert.deepEqual(r.issues, []);
  assert.equal(T.validateTokenValue("--bad-name", "1px").unknown, true, "nom hors --sk-/--v-");
  const extra = new Map([["--sk-events-card-radius", "length"], ["--sk-events-card-bg", "color"]]);
  assert.equal(T.validateTokenValue("--sk-events-card-radius", "0", { extra }).ok, true);
  assert.equal(T.validateTokenValue("--sk-events-card-radius", "blue", { extra }).ok, false);
  assert.equal(T.validateTokenValue("--sk-events-card-bg", "#fff", { extra }).ok, true);
});

test("référence : la valeur littérale d'une chaîne de var() est retrouvée et contrôlée", () => {
  const tokens = { "--a": "var(--b)", "--b": "var(--c, 3px)", "--c": "0.4rem", "--loop1": "var(--loop2)", "--loop2": "var(--loop1)" };
  assert.equal(T.literalOf("--a", tokens), "0.4rem");
  assert.equal(T.literalOf("--b", { "--b": "var(--zz, 3px)" }), "3px", "repli de var()");
  assert.equal(T.literalOf("--loop1", tokens), null, "boucle");
  assert.equal(T.literalOf("--nope", tokens), null);
  assert.equal(T.validateResolved("--sk-text-sm", "0.4rem"), false);
  assert.equal(T.validateResolved("--sk-text-sm", "0.9rem"), true);
});
