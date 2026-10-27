// Assainisseur de skins : tests de PROPRIÉTÉ (fuzz déterministe, graine fixe) et mesures de performance.
// Invariant : quelle que soit l'entrée, la sortie ne contient jamais d'élément interdit, et rien ne lève d'exception.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const { PARTS, REGIONS, ALLOWED_PROPERTIES } = await import("@/core/skins/allowlist");

const ID = "fuzz-skin";
const OPTS = { skinId: ID };

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, n) => Math.floor(r() * n);

const ATTACKS = [
  "url(http://evil.example/x.png)", "url(//evil.example/x)", "url('https://evil.example')", "url(data:text/html,<script>alert(1)</script>)", "url(javascript:alert(1))", "@import 'x';", "@IMPORT url(x);",
  "expression(alert(1))", "\\75 rl(http://evil.example)", "\\000075rl(", "ur/**/l(http://evil.example)", "/*", "*/", "</style><script>alert(1)</script>", "<!--", "-->", "\\0", "\u0000", "‮", "﻿", "é", "😀",
  "!important", "! important", "{", "}", ";", ";;", "(", ")", "[", "]", "\"", "'", "\\", "\\\n", "@", "@media", "@keyframes x", "@font-face", "image-set(", "-webkit-image-set(", "attr(data-x)", "var(--x)", "var(--sk-x,",
  "behavior:url(x)", "-moz-binding:url(x)", "javascript:", "vbscript:", "data:", "*", "html", "body", ":root", "#id", ".cls", "&", "||", ">>>", "display:none", "visibility:hidden", "opacity:0", "font-size:0",
  "position:fixed", "left:-9999px", "content:\"abc\"", "content:attr(x)", "src:url(x)", "filter:blur(100px)", "transform:scale(0)", "animation:x 1s infinite", "--sk-a:var(--sk-b)", "--sk-b:var(--sk-a)",
];
const SELECTORS = [
  ...REGIONS.map((r) => `[data-skin-region="${r}"]`), ...PARTS.map((p) => `[data-skin-part="${p}"]`),
  "a", "body", "*", ".x", "#y", ":root", "html", "div", "[data-skin-part]", "[data-skin-part=\"x\"]", ":hover", "::before", "[data-skin-part=\"card\"]::before", "[data-skin-part=\"card\"] a:hover",
  "[data-skin-part=\"card\"]:is(a, body)", "[data-skin-part=\"card\"]:not(.x)", "[data-skin-part=\"card\"]:has(img)", ":is([data-skin-part=\"card\"], [data-skin-part=\"chip\"])", "[data-skin-part=\"card\"],body",
];
const PROPS = [...ALLOWED_PROPERTIES, "visibility", "clip", "behavior", "-moz-binding", "zoom", "all", "will-change", "--sk-a", "--sk-b", "--v-accent", "--evil", "_x", "*y"];
const VALUES = ["red", "#fff", "0", "none", "1px", "100%", "auto", "block", "grid", "flex", "calc(1px + 2px)", "var(--v-fg)", "var(--sk-a)", "var(--x)", "linear-gradient(red, blue)", "url(skin:images/a.png)", "\"·\"", "\"abc\"",
  "translateX(-9999px)", "blur(30px)", "inherit", "0 0 4px red", "1s infinite", "1px solid red", "rgb(0 0 0 / .5)", "oklch(.7 .1 200)", "min(1px, 2px)", "-9999px", "9999px", "999999", "1e999", "50%", "0.3"];
const AT = ["@media (min-width: 40rem)", "@media print", "@media (prefers-reduced-motion: no-preference)", "@supports (display: grid)", "@container (min-width: 20rem)", "@media (min-width: 9999px)", "@keyframes k", "@font-face", "@import", "@layer x", "@page"];

function randomSheet(r) {
  const parts = [];
  const n = 1 + int(r, 12);
  for (let i = 0; i < n; i++) {
    const sel = r() < 0.12 ? `${pick(r, SELECTORS)}, ${pick(r, SELECTORS)}` : pick(r, SELECTORS);
    const decls = Array.from({ length: 1 + int(r, 5) }, () => `${pick(r, PROPS)}:${r() < 0.25 ? pick(r, ATTACKS) : pick(r, VALUES)}`).join(r() < 0.1 ? ";;" : ";");
    let rule = `${sel}{${decls}}`;
    if (r() < 0.25) rule = `${pick(r, AT)}{${rule}}`;
    if (r() < 0.05) rule = `${pick(r, AT)}{${pick(r, AT)}{${rule}}}`;
    if (r() < 0.04) rule += pick(r, ATTACKS);
    parts.push(rule);
  }
  return parts.join(r() < 0.5 ? "\n" : "");
}

const VALID = `/* base */
[data-skin-part="card"]{box-shadow:var(--sk-shadow-card);transition:transform var(--sk-duration) var(--sk-ease),box-shadow var(--sk-duration) var(--sk-ease)}
@media (prefers-reduced-motion: no-preference){[data-skin-part="card"]:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgb(0 0 0 / .12)}}
[data-skin-region="header"]{border-bottom:2px solid var(--v-accent)}
[data-skin-part="button"][data-btn="primary"]{font-weight:var(--sk-weight-bold)}
@media (min-width:40rem){[data-skin-region="header"]{display:flex;justify-content:space-between;align-items:center}}
[data-skin-part="list-item"]::before{content:"—";color:var(--v-accent)}
[data-skin-region="backdrop"]{background-image:url(skin:images/grid.svg);opacity:.4}
@font-face{font-family:"Skin Body";src:url(skin:fonts/body.woff2) format("woff2")}
@media (prefers-reduced-motion: no-preference){@keyframes glow{0%{opacity:1}50%{opacity:.8}100%{opacity:1}}[data-skin-part="badge"]{animation:glow 3s infinite}}`;

function mutate(r, text) {
  let s = text;
  const k = 1 + int(r, 3);
  for (let i = 0; i < k; i++) {
    const at = int(r, s.length + 1);
    switch (int(r, 9)) {
      case 0: s = s.slice(0, at) + pick(r, ATTACKS) + s.slice(at); break;
      case 1: s = s.slice(0, at) + s.slice(at + 1 + int(r, 12)); break;
      case 2: s = s.slice(0, at) + String.fromCharCode(int(r, 256)) + s.slice(at); break;
      case 3: { const len = 1 + int(r, 40); s = s.slice(0, at) + s.slice(at, at + len) + s.slice(at); break; }
      case 5: s = s.slice(0, at) + pick(r, [" ", "\n", "/* ok */", "\t"]) + s.slice(at); break;
      case 6: s = s.replace(/\d/, String(int(r, 10))); break;
      case 7: s = s.replace(/(\d)(px|rem|s)/, `${int(r, 100)}$2`); break;
      default: s = s.slice(0, at) + pick(r, ["{", "}", ";", ":", "(", ")", "\"", "'", "/*", "*/", "\\", "@", "!", "<", ">", "&", "*", "#", ".", ","]) + s.slice(at);
    }
  }
  return s;
}

function check(css, label) {
  const t0 = performance.now();
  const r = sanitizeSkinCss(css, OPTS);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `trop lent (${ms.toFixed(0)} ms) : ${label}`);
  assertSafeOutput(assert, r.css, ID, label);
  assert.equal(r.ok, !r.issues.some((i) => i.severity === "error"));
  if (r.ok) {
    // idempotence : une feuille assainie et acceptée se réassainit à l'identique
    const again = sanitizeSkinCss(r.css, OPTS);
    assert.equal(again.ok, true, `ré-assainissement refusé : ${JSON.stringify(again.issues.map((i) => i.code))} pour ${r.css.slice(0, 300)}`);
    assert.equal(again.css, r.css, label);
  }
  return r;
}

test("fuzz : la sortie ne contient jamais d'élément interdit (feuilles aléatoires structurées)", () => {
  let accepted = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const r = rng(seed);
    const css = randomSheet(r);
    if (check(css, `structuré #${seed}: ${css.slice(0, 200)}`).ok) accepted++;
  }
  assert.ok(accepted > 0, "le générateur doit aussi produire des feuilles valides");
});

test("fuzz : mutations d'une feuille valide", () => {
  const base = check(VALID, "base");
  assert.equal(base.ok, true, JSON.stringify(base.issues));
  let accepted = 0;
  for (let seed = 1; seed <= 4000; seed++) {
    const r = rng(seed * 7919);
    const css = mutate(r, VALID);
    if (check(css, `mutation #${seed}`).ok) accepted++;
  }
  assert.ok(accepted > 300, `${accepted} mutations acceptées sur 4000`);
});

test("fuzz : soupe de caractères significatifs du CSS", () => {
  const alphabet = ["a", "b", "[", "]", "{", "}", "(", ")", ":", ";", ",", ".", "#", "*", "@", "!", "\\", "/", "\"", "'", " ", "\n", "-", "_", "0", "9", "%", "<", ">", "=", "~", "|", "&", "é", "\u0000", "‮", "data-skin-part", "card", "url", "import", "media", "var", "--sk-", "calc", "important", "none", "skin:"];
  for (let seed = 1; seed <= 2000; seed++) {
    const r = rng(seed * 104729);
    const len = 1 + int(r, 120);
    let css = "";
    for (let i = 0; i < len; i++) css += pick(r, alphabet);
    check(css, `soupe #${seed}: ${JSON.stringify(css.slice(0, 100))}`);
  }
});

test("fuzz : octets aléatoires", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const r = rng(seed * 31337);
    let css = "";
    const len = int(r, 200);
    for (let i = 0; i < len; i++) css += String.fromCharCode(int(r, 0x2fff));
    check(css, `octets #${seed}`);
  }
});

test("propriété : ok ⇒ aucune erreur, et toute règle d'une feuille acceptée est dans la liste blanche", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const css = randomSheet(rng(seed * 17));
    const r = sanitizeSkinCss(css, OPTS);
    if (!r.ok) continue;
    assert.ok(!r.issues.some((i) => i.severity === "error"));
    for (const m of r.css.matchAll(/[{;]([a-z-]+):/g)) {
      const prop = m[1];
      assert.ok(ALLOWED_PROPERTIES.has(prop) || prop.startsWith("--") || ["font-display", "unicode-range"].includes(prop), `propriété inattendue ${prop}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Performance : temps borné

function bigValidSheet(targetBytes) {
  let css = "";
  let i = 0;
  while (Buffer.byteLength(css) < targetBytes - 160 && i < 590) {
    css += `[data-skin-part="card"]:nth-child(${i + 1}){color:var(--v-fg);padding:calc(var(--sk-space) * 4);border:1px solid var(--v-line);border-radius:var(--sk-radius-card);margin:0 auto}\n`;
    i++;
  }
  return css;
}

test("performance : une feuille de 60 Ko s'assainit en temps borné", () => {
  const css = bigValidSheet(60 * 1024);
  const bytes = Buffer.byteLength(css);
  assert.ok(bytes > 55 * 1024 && bytes <= 60 * 1024, `taille ${bytes}`);
  sanitizeSkinCss(css, OPTS); // échauffement
  const t0 = performance.now();
  const r = sanitizeSkinCss(css, OPTS);
  const ms = performance.now() - t0;
  assert.equal(r.ok, true, JSON.stringify(r.issues.slice(0, 3)));
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms pour ${bytes} octets`);
});

test("performance : entrées hostiles de 60 Ko, chacune sous 2 secondes", () => {
  const KB = 60 * 1024;
  const hostile = {
    "parenthèses ouvrantes": "[data-skin-part=\"card\"]{color:" + "(".repeat(KB - 40) + "}",
    "pseudo-classes imbriquées": "[data-skin-part=\"card\"]" + ":is(".repeat(Math.floor(KB / 4)) + "}",
    "at-règles imbriquées": "@media (min-width: 40rem){".repeat(Math.floor(KB / 26)),
    "règles vides répétées": "a{}".repeat(Math.floor(KB / 3)),
    "une déclaration énorme": '[data-skin-part="card"]{color:' + "red ".repeat(Math.floor(KB / 4) - 8) + "}",
    "commentaires": "/**/".repeat(Math.floor(KB / 4)),
    "commentaire non fermé": "/*" + "x".repeat(KB - 4),
    "guillemets": '[data-skin-part="card"]{content:' + '"'.repeat(KB - 40) + "}",
    "antislashs": '[data-skin-part="card"]{color:' + "\\".repeat(KB - 40) + "}",
    "accolades": "{".repeat(KB),
    "sélecteurs séparés par des virgules": "[data-skin-part=\"card\"],".repeat(Math.floor(KB / 24)) + "a{color:red}",
    "attributs": "[data-skin-part=\"card\"]" + "[aria-current]".repeat(Math.floor(KB / 14)) + "{color:red}",
    "règles distinctes en trop": Array.from({ length: 4000 }, (_, i) => `[data-skin-part="card"]:nth-child(${i}){color:red}`).join("").slice(0, KB),
    "variables en chaîne": '[data-skin-part="card"]{' + Array.from({ length: 1900 }, (_, i) => `--sk-c${i}:var(--sk-c${i + 1})`).join(";") + "}",
    "variables en cycle long": '[data-skin-part="card"]{' + Array.from({ length: 1500 }, (_, i) => `--sk-c${i}:var(--sk-c${(i + 1) % 1500})`).join(";") + "}",
    "explosion de variables": '[data-skin-part="card"]{--sk-a0:xxxxxxxxxx;' + Array.from({ length: 400 }, (_, i) => `--sk-a${i + 1}:var(--sk-a${i}) var(--sk-a${i}) var(--sk-a${i})`).join(";") + "}",
    "var() dans width, avec beaucoup de définitions": '[data-skin-part="card"]{' + Array.from({ length: 800 }, (_, i) => `--sk-w${i}:${i}px`).join(";") + ";width:var(--sk-w1)}",
    "contenu unicode": "é".repeat(Math.floor(KB / 2)),
  };
  for (const [name, css] of Object.entries(hostile)) {
    const t0 = performance.now();
    const r = sanitizeSkinCss(css.slice(0, 80 * 1024), OPTS);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${name} : ${ms.toFixed(0)} ms`);
    assertSafeOutput(assert, r.css, ID, name);
    assert.equal(typeof r.ok, "boolean", name);
  }
});

test("performance : entrée de 20 Mo rejetée sans analyse", () => {
  const huge = "a".repeat(20 * 1024 * 1024);
  const t0 = performance.now();
  const r = sanitizeSkinCss(huge, OPTS);
  const ms = performance.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.css, "");
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

test("performance : pas d'effet de bord entre appels (aucun état partagé)", () => {
  const css = '[data-skin-part="card"]{background-attachment:fixed}';
  for (let i = 0; i < 10; i++) assert.equal(sanitizeSkinCss(css, OPTS).ok, true, "le compteur de fonds fixes repart de zéro à chaque appel");
  const a = sanitizeSkinCss(VALID, OPTS);
  const b = sanitizeSkinCss(VALID, OPTS);
  assert.deepEqual(a, b, "déterministe");
});
