// Assainisseur de feuilles de style de skins (docs/SKINS.md §6) : comportement attendu sur des feuilles VALIDES,
// réécriture (préfixe, ressources, animations), exceptions listées, plafonds, robustesse.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { sanitizeSkinCss, sanitizeTokenValue } = await import("@/core/skins/sanitize");
const { ALLOWED_PROPERTIES, DEFAULT_LIMITS, PARTS, REGIONS } = await import("@/core/skins/allowlist");

const ID = "plain-light";
const P = `:root[data-skin="${ID}"] `;
const run = (css, options = {}) => sanitizeSkinCss(css, { skinId: ID, ...options });
const okOut = (css, options) => {
  const r = run(css, options);
  assert.equal(r.ok, true, JSON.stringify(r.issues.map((i) => `${i.code}: ${i.message.en}`)));
  assertSafeOutput(assert, r.css, ID);
  return r;
};
const codes = (r) => r.issues.map((i) => i.code);

test("préfixe : chaque sélecteur est réécrit sous :root[data-skin=\"<id>\"]", () => {
  const r = okOut('[data-skin-part="card"]{color:red}\n[data-skin-region="header"] a:hover, [data-skin-part="button"][data-btn="primary"]{color:blue}');
  assert.equal(r.css, `${P}[data-skin-part="card"]{color:red}\n${P}[data-skin-region="header"] a:hover,${P}[data-skin-part="button"][data-btn="primary"]{color:blue}`);
});

test("préfixe d'auteur exact : accepté, jamais doublé", () => {
  const r = okOut(`${P}[data-skin-part="card"]{color:red}`);
  assert.equal(r.css, `${P}[data-skin-part="card"]{color:red}`);
  const r2 = okOut(`:root[data-skin='${ID}'] > [data-skin-part="card"]{color:red}`);
  assert.equal(r2.css, `${P}[data-skin-part="card"]{color:red}`);
});

test("sélecteurs permis : pseudo-classes, pseudo-éléments, descendants, :is/:where/:not/:has", () => {
  const sels = [
    '[data-skin-part="card"]:hover', '[data-skin-part="card"]:focus-visible', '[data-skin-part="button"]:active', '[data-skin-part="button"]:disabled', '[data-skin-part="input"]:checked',
    '[data-skin-part="list-item"]:first-child', '[data-skin-part="list-item"]:last-child', '[data-skin-part="list-item"]:only-child', '[data-skin-part="list-item"]:nth-child(2n+1)',
    '[data-skin-part="list-item"]:nth-child(odd)', '[data-skin-part="list-item"]:nth-of-type(3)', '[data-skin-part="field-error"]:empty',
    '[data-skin-part="card"]::before', '[data-skin-part="card"]::after', '[data-skin-part="list-item"]::marker', '[data-skin-part="input"]::placeholder', '[data-skin-part="prose"]::selection',
    '[data-skin-part="prose"]::first-letter', '[data-skin-part="prose"]::first-line', '[data-skin-part="prose"]:first-letter',
    '[data-skin-region="main"] a', '[data-skin-region="main"] > p', '[data-skin-region="main"] h1 + p', '[data-skin-region="main"] h2 ~ p', '[data-skin-part="table"] th', '[data-skin-part="card"] img',
    '[data-skin-part="card"] a:not([aria-current])', '[data-skin-part="nav-link"][aria-current="page"]', '[data-skin-part="nav-link"][aria-current]', '[data-skin-part="menu-toggle"][aria-expanded="true"]',
    '[data-skin-part="tab"][aria-selected="true"]', '[data-skin-part="mode-option"][aria-pressed="true"]', '[data-skin-part="nav-list"][data-open="true"]', '[data-skin-part="notice"][data-tone="danger"]',
    '[data-skin-part="heading"][data-level="1"]', '[data-skin-part="panel"][data-kind="media"]', '[data-skin-part="home-cell"][data-size="large"]', '[data-skin-part="hero"][data-variant="video"]',
    '[data-skin-region="header"][data-header-layout="centered"]', '[data-skin-part="link"][target="_blank"]', '[data-skin-part="link"][rel~="external"]', '[data-skin-part="input"][type="email"]',
    '[data-skin-part="prose"][lang="fr"]', '[data-skin-part="prose"][lang|="en"]', '[data-skin-part="card"] [role="img"]',
    '[data-skin-part="card"]:is(:hover, :focus-within)', '[data-skin-part="card"]:where(:hover)', ':is([data-skin-part="card"], [data-skin-part="panel"]):hover',
    '[data-skin-part="card"]:has(img)', '[data-skin-part="card"]:has(> img)', '[data-skin-part="card"]:has(a img)', '[data-skin-part="card"]:not(:hover):not(:focus-within)',
    '[data-skin-part="events.card"]', '[data-skin-part="events.card"]:hover', 'button[data-skin-part="button"]', 'a[data-skin-part="link"]',
  ];
  for (const sel of sels) {
    const r = run(`${sel}{color:red}`);
    assert.equal(r.ok, true, `${sel} : ${JSON.stringify(codes(r))}`);
    assertSafeOutput(assert, r.css, ID, sel);
    assert.ok(r.css.startsWith(P), sel);
  }
});

test("tous les noms de régions et de pièces du contrat sont ciblables", () => {
  for (const region of REGIONS) assert.equal(run(`[data-skin-region="${region}"]{color:red}`).ok, true, region);
  for (const part of PARTS) assert.equal(run(`[data-skin-part="${part}"]{color:red}`).ok, true, part);
  assert.equal(run('[data-skin-part="nope"]{color:red}').ok, false);
  assert.equal(run('[data-skin-region="nope"]{color:red}').ok, false);
});

test("pièces de modules : acceptées sans liste, refusées si le module ne les déclare pas", () => {
  assert.equal(run('[data-skin-part="events.card"]{color:red}').ok, true);
  assert.equal(run('[data-skin-part="events.card"]{color:red}', { moduleParts: { events: ["card"] } }).ok, true);
  assert.equal(run('[data-skin-part="events.badge"]{color:red}', { moduleParts: { events: ["card"] } }).ok, false);
  assert.equal(run('[data-skin-part="gallery.card"]{color:red}', { moduleParts: { events: ["card"] } }).ok, false);
  assert.equal(run('[data-skin-part="Events.Card"]{color:red}').ok, false);
});

test("toutes les propriétés de la liste blanche sont acceptées avec une valeur sûre", () => {
  const sample = {
    color: "#112233", background: "#fff", "background-color": "#fff", "background-image": "linear-gradient(red, blue)", "background-size": "cover", "background-position": "center", "background-repeat": "no-repeat",
    "background-attachment": "scroll", "background-clip": "padding-box", "background-blend-mode": "multiply", "accent-color": "red", "caret-color": "red", "color-scheme": "light", opacity: "0.9",
    "mix-blend-mode": "normal", filter: "blur(1px)", "backdrop-filter": "blur(12px)", "-webkit-backdrop-filter": "blur(12px)", fill: "red", stroke: "red", "stroke-width": "2",
    font: "700 1rem/1.5 serif", "font-family": "Georgia, serif", "font-size": "1rem", "font-weight": "700", "font-style": "italic", "font-variant": "small-caps", "font-feature-settings": '"liga" 1', "line-height": "1.5",
    "letter-spacing": "0.05em", "word-spacing": "2px", "text-transform": "uppercase", "text-decoration": "underline", "text-underline-offset": "3px", "text-shadow": "0 0 4px red", "text-align": "center",
    "text-wrap": "balance", "text-indent": "1em", "white-space": "nowrap", hyphens: "auto", quotes: '"«" "»"', "list-style": "none", "list-style-type": "square", "list-style-position": "inside", "tab-size": "4", "overflow-wrap": "anywhere", "word-break": "break-word", "vertical-align": "middle",
    margin: "0 auto", "margin-top": "1rem", "margin-inline": "auto", padding: "1rem 2rem", "padding-block": "1rem", gap: "1rem", "row-gap": "1rem", "column-gap": "1rem", width: "100%", "min-width": "0", "max-width": "42rem",
    height: "auto", "min-height": "2.75rem", "max-height": "40rem", "aspect-ratio": "16 / 9", "box-sizing": "border-box", overflow: "hidden", "overflow-x": "auto", "overflow-y": "auto", "object-fit": "cover", "object-position": "center", "table-layout": "fixed",
    border: "2px solid black", "border-top": "1px solid red", "border-radius": "0.5rem", "border-top-left-radius": "4px", "border-collapse": "collapse", "border-spacing": "0", "border-image": "linear-gradient(red, blue) 1",
    outline: "2px solid red", "outline-offset": "2px", "box-shadow": "6px 6px 0 #000",
    display: "grid", flex: "1 1 0", "flex-direction": "column", "flex-wrap": "wrap", "grid-template-columns": "repeat(auto-fill, minmax(15rem, 1fr))", "grid-template-areas": '"header header" "main aside"', "grid-area": "main",
    "grid-column": "1 / 3", "grid-auto-flow": "dense", "place-items": "center", "align-items": "center", "justify-content": "space-between", order: "2", columns: "2", float: "none", "container-type": "inline-size", "container-name": "card",
    position: "relative", top: "0", right: "0", bottom: "0", left: "50%", inset: "0", "z-index": "10", "scroll-margin": "1rem", "scroll-padding-top": "4rem", "scroll-behavior": "auto",
    transition: "transform 150ms ease", "transition-duration": "150ms", "transform": "translateY(-2px) rotate(1deg) scale(1.02)", "transform-origin": "center",
    cursor: "pointer", "pointer-events": "auto", "user-select": "auto", "scrollbar-color": "red blue", "scrollbar-width": "thin", appearance: "none", resize: "none",
    "clip-path": "none", "mask-image": "none",
  };
  for (const [prop, value] of Object.entries(sample)) {
    const r = run(`[data-skin-part="card"]{${prop}:${value}}`);
    assert.equal(r.ok, true, `${prop}: ${value} -> ${JSON.stringify(codes(r))}`);
  }
  // chaque propriété listée est couverte par l'échantillon ou par un test dédié
  const missing = [...ALLOWED_PROPERTIES].filter((p) => !(p in sample) && !/^(margin|padding|border|outline|inset|scroll-margin|scroll-padding|grid|place|align|justify|column|flex|animation|transition|font-variant|text-decoration|content|background)/.test(p));
  assert.deepEqual(missing, [], `propriétés non échantillonnées : ${missing.join(", ")}`);
});

test("valeurs permises : variables, calc, couleurs modernes, dégradés, env sûr", () => {
  for (const [prop, value] of [
    ["color", "var(--v-fg)"], ["color", "var(--sk-color-link, var(--v-accent))"], ["color", "rgb(0 0 0 / 0.5)"], ["color", "rgba(10, 20, 30, .5)"], ["color", "hsl(210 50% 40%)"], ["color", "oklch(0.7 0.15 250)"],
    ["color", "color-mix(in oklch, var(--v-accent) 60%, white)"], ["color", "#abc"], ["color", "#aabbccdd"], ["color", "Canvas"],
    ["width", "calc(100% - 2rem)"], ["width", "clamp(20rem, 50vw, 64rem)"], ["width", "min(100%, 42rem)"], ["height", "max(2.75rem, 10vh)"],
    ["padding", "env(safe-area-inset-bottom)"], ["padding-bottom", "env(safe-area-inset-bottom, 0px)"], ["margin", "calc(var(--sk-space) * 4)"],
    ["background", "repeating-linear-gradient(0deg, rgb(0 0 0 / .15) 0 1px, transparent 1px 3px)"], ["background-image", "radial-gradient(circle at 20% 10%, #fde68a, transparent 40%), linear-gradient(120deg, #fbcfe8, #bae6fd)"],
    ["background-image", "conic-gradient(from 90deg, red, blue)"], ["box-shadow", "0 0 12px var(--v-accent), inset 0 0 6px rgb(255 255 255 / .4)"], ["text-shadow", "0 0 6px currentcolor"],
    ["font-family", '"Skin Body", Georgia, serif'], ["font-family", "var(--v-font)"], ["font-family", "var(--sk-font-heading), ui-serif"], ["transition", "transform var(--sk-duration) var(--sk-ease)"],
    ["transition", "color .2s ease-in-out, background-color .2s cubic-bezier(.4,0,.2,1)"], ["aspect-ratio", "4 / 3"], ["grid-template-columns", "[full-start] minmax(1rem, 1fr) [content-start] minmax(0, 42rem) [content-end] minmax(1rem, 1fr) [full-end]"],
    ["filter", "drop-shadow(0 0 8px var(--v-accent))"], ["backdrop-filter", "blur(24px) saturate(1.4)"], ["--sk-radius-card", "0"], ["--sk-shadow-card", "6px 6px 0 var(--v-fg)"], ["--v-accent", "#e11d48"],
    ["--sk-space", "0.3125rem"], ["--sk-page-width", "min(100% - 2rem, 46rem)"], ["--v-font", '"Skin Body", Georgia, serif'], ["--sk-font-heading", '"Skin Head", serif'],
  ]) {
    const r = run(`[data-skin-part="card"]{${prop}:${value}}`);
    assert.equal(r.ok, true, `${prop}: ${value} -> ${JSON.stringify(codes(r))}`);
    assertSafeOutput(assert, r.css, ID, `${prop}: ${value}`);
  }
});

test("ressources : url(skin:…) conservée, réécrite avec assetBase, déclarée ou non", () => {
  const css = '[data-skin-region="backdrop"]{background-image:url(skin:images/grid.svg)}\n[data-skin-part="card"]{background:url( "skin:images/paper.png" ) center/cover}';
  const r = okOut(css);
  assert.ok(r.css.includes("url(skin:images/grid.svg)"));
  assert.ok(r.css.includes("url(skin:images/paper.png)"));
  assert.deepEqual(r.stats.assets, ["images/grid.svg", "images/paper.png"]);
  const served = okOut(css, { assetBase: "/skins/plain-light/1.0.0/" });
  assert.ok(served.css.includes('url("/skins/plain-light/1.0.0/images/grid.svg")'));
  assert.ok(!served.css.includes("skin:"));
  assert.equal(okOut(css, { assets: ["images/grid.svg", "images/paper.png"] }).ok, true);
  const missing = run(css, { assets: ["images/grid.svg"] });
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes("asset-not-declared"));
  assert.equal(run(css, { assetBase: "https://evil.example/" }).ok, false, "base d'URL invalide");
  assert.equal(run(css, { assetBase: "/skins/plain-light/../x/" }).ok, false);
  assert.equal(run(css, { assetBase: "/skins/plain-light/1.0.0" }).ok, false, "sans barre finale");
});

test("police embarquée : @font-face réécrit, display swap imposé", () => {
  const css = '@font-face{font-family:"Skin Body";src:url(skin:fonts/body.woff2) format("woff2");font-weight:400 700;font-style:normal;font-display:block}\n[data-skin-region="main"]{font-family:"Skin Body", serif}';
  const r = okOut(css, { assets: ["fonts/body.woff2"], fontFamilies: ["Skin Body"], assetBase: "/skins/plain-light/1.0.0/" });
  assert.ok(r.css.includes('@font-face{font-family:"Skin Body";src:url("/skins/plain-light/1.0.0/fonts/body.woff2") format("woff2");font-weight:400 700;font-style:normal;font-display:swap}'), r.css);
  assert.ok(!r.css.includes("block"));
  assert.deepEqual(r.stats.assets, ["fonts/body.woff2"]);
  assert.equal(r.stats.fontFaces, 1);
});

test("@keyframes : renommé sk-<id>-<nom>, animation réécrite, protégé par prefers-reduced-motion", () => {
  const css = `@media (prefers-reduced-motion: no-preference){
@keyframes pulse{0%{opacity:1}50%{opacity:.8}100%{opacity:1}}
[data-skin-part="badge"]{animation:pulse 2s ease-in-out infinite}
[data-skin-part="chip"]{animation-name:pulse;animation-duration:1s}
}`;
  const r = okOut(css);
  assert.ok(r.css.includes("@keyframes sk-plain-light-pulse{0%{opacity:1}50%{opacity:.8}100%{opacity:1}}"), r.css);
  assert.ok(r.css.includes("animation:sk-plain-light-pulse 2s ease-in-out infinite"));
  assert.ok(r.css.includes("animation-name:sk-plain-light-pulse"));
  assert.equal(r.stats.keyframes, 1);
  // pas de double renommage en repassant dans l'assainisseur
  assert.equal(okOut(r.css).css, r.css);
});

test("@media, @supports, @container : conditions réécrites", () => {
  const r = okOut(`@media screen and (min-width:40rem) and (prefers-color-scheme: dark){[data-skin-part="card"]{color:red}}
@media (width >= 48rem){[data-skin-part="card"]{color:blue}}
@media (40rem <= width <= 60rem){[data-skin-part="card"]{color:green}}
@media (hover: hover) and (pointer: fine), print{[data-skin-part="card"]{color:red}}
@supports (backdrop-filter: blur(10px)){[data-skin-part="card"]{backdrop-filter:blur(10px)}}
@supports not (display: grid){[data-skin-part="card"]{display:block}}
@container card (min-width: 20rem){[data-skin-part="card"]{padding:2rem}}
@media print{@media (min-width: 40rem){[data-skin-part="card"]{color:red}}}`);
  assert.ok(r.css.includes("@media screen and (min-width: 40rem) and (prefers-color-scheme: dark){"));
  assert.ok(r.css.includes("@media (width >= 48rem){"));
  assert.ok(r.css.includes("@media (40rem <= width <= 60rem){"));
  assert.ok(r.css.includes("@media (hover: hover) and (pointer: fine), print{"));
  assert.ok(r.css.includes("@supports (backdrop-filter: blur(10px)){"));
  assert.ok(r.css.includes("@supports not (display: grid){"));
  assert.ok(r.css.includes("@container card (min-width: 20rem){"));
  assert.ok(r.css.includes("@media print{\n@media (min-width: 40rem){"));
});

test("content : ponctuation de 1 à 3 signes, réécrite en échappements", () => {
  const r = okOut('[data-skin-part="list-item"]::before{content:"\\2014"}\n[data-skin-part="card"]::after{content:""}\n[data-skin-part="link"]::after{content:"»"}\n[data-skin-part="chip"]::before{content:"·"}\n[data-skin-part="prose"]::before{content:none}');
  assert.ok(r.css.includes('content:"\\2014 "'), r.css);
  assert.ok(r.css.includes('content:""'));
  assert.ok(r.css.includes('content:"\\bb "'));
  assert.ok(r.css.includes('content:"\\b7 "'));
  assert.ok(r.css.includes("content:none"));
  assert.equal(okOut(r.css).css, r.css, "idempotent");
});

test("masquer : seulement du décor, le bouton de menu, les menus fermés", () => {
  assert.equal(run('[data-skin-region="backdrop"]{display:none}').ok, true);
  assert.equal(run('[data-skin-region="backdrop"]{opacity:0}').ok, true);
  assert.equal(run('[data-skin-part="divider"]{display:none}').ok, true);
  assert.equal(run('[data-skin-part="card"]::before{display:none}').ok, true);
  assert.equal(run('[data-skin-part="card"]::after{opacity:.2;mix-blend-mode:multiply;pointer-events:none}').ok, true);
  assert.equal(run('[data-skin-region="backdrop"] svg{display:none}').ok, true);
  const toggle = run('[data-skin-part="menu-toggle"]{display:none}');
  assert.equal(toggle.ok, true);
  assert.deepEqual(toggle.issues.map((i) => [i.code, i.severity]), [["menu-toggle-hidden", "warning"]]);
  assert.equal(run('[data-skin-part="nav-list"][data-open="false"]{display:none}').ok, true);
  assert.equal(run('[data-skin-part="nav-list"]:not([data-open="true"]){display:none}').ok, true);
  assert.equal(run('[data-skin-part="submenu"][data-open="false"]{display:none}').ok, true);
  assert.equal(run('[data-skin-part="nav-list"]{display:none}').ok, false);
  assert.equal(run('[data-skin-part="nav-list"][data-open="true"]{display:none}').ok, false);
  assert.equal(run('[data-skin-part="nav-link"][data-open="false"]{display:none}').ok, false);
  assert.equal(run('[data-skin-part="nav-list"][data-open="false"]::before{display:none}').ok, true);
  assert.equal(run('[data-skin-part="nav-list"][data-open="false"]{opacity:0}').ok, false, "seul display:none est permis sur un menu fermé");
  assert.equal(run('[data-skin-region="backdrop"]{position:fixed}').ok, false);
  assert.equal(run('[data-skin-region="header"]{position:fixed;top:0}').ok, true);
  assert.equal(run('[data-skin-region="nav"]{position:fixed;top:0}').ok, true);
  assert.equal(run('[data-skin-region="nav"]::before{position:fixed}').ok, false);
  assert.equal(run('[data-skin-part="card"]{position:sticky;top:0}').ok, true);
});

test("décor : estomper, masquer, découper et mélanger librement ; contenu : borné", () => {
  assert.equal(run('[data-skin-region="backdrop"]{mask-image:linear-gradient(black, transparent);filter:blur(60px);transform:rotate(45deg) scale(2);clip-path:circle(50%)}').ok, true);
  assert.equal(run('[data-skin-part="card"]{filter:blur(60px)}').ok, false);
  assert.equal(run('[data-skin-part="card"]{filter:blur(2px)}').ok, true);
  assert.equal(run('[data-skin-part="card"]{backdrop-filter:blur(24px)}').ok, true);
  assert.equal(run('[data-skin-part="card"]{backdrop-filter:blur(25px)}').ok, false);
  assert.equal(run('[data-skin-part="card"]{clip-path:inset(0 round 12px)}').ok, true);
  assert.equal(run('[data-skin-part="avatar"]{clip-path:circle(50%)}').ok, true);
  assert.equal(run('[data-skin-part="image"]{clip-path:ellipse(50% 50%)}').ok, true);
  assert.equal(run('[data-skin-part="prose"]{clip-path:circle(50%)}').ok, false, "clip-path seulement sur card, panel, button, image, avatar, badge");
  assert.equal(run('[data-skin-part="card"] a{clip-path:circle(50%)}').ok, false);
  assert.equal(run('[data-skin-part="card"]{opacity:.6}').ok, true);
  assert.equal(run('[data-skin-part="card"]{transform:translateY(-4rem) rotate(5deg) scale(1.1)}').ok, true);
  assert.equal(run('[data-skin-part="card"]{transform:translateY(-4.1rem)}').ok, false);
  assert.equal(run('[data-skin-part="card"]::before{transform:rotate(45deg) translateX(-20rem) scale(3)}').ok, true);
});

test("animations : bornes de durée, de répétition et de fréquence", () => {
  const m = (body) => `@media (prefers-reduced-motion: no-preference){@keyframes spin{from{opacity:1}to{opacity:1}}[data-skin-part="card"]{${body}}}`;
  assert.equal(run(m("animation:spin 20s")).ok, true);
  assert.equal(run(m("animation:spin 21s")).ok, false);
  assert.equal(run(m("animation:spin 1s 3")).ok, true);
  assert.equal(run(m("animation:spin 1s 4")).ok, false);
  assert.equal(run(m("animation:spin 340ms infinite")).ok, true);
  assert.equal(run(m("animation:spin 300ms infinite")).ok, false);
  assert.equal(run(m("animation:spin var(--sk-duration) infinite")).ok, true, "durée non vérifiable : acceptée");
  assert.equal(run('[data-skin-part="card"]{transition:transform 600ms}').ok, true);
  assert.equal(run('[data-skin-part="card"]{transition:transform 601ms}').ok, false);
  assert.equal(run('[data-skin-part="card"]{scroll-behavior:smooth}').ok, false);
  assert.equal(run('@media (prefers-reduced-motion: no-preference){[data-skin-part="card"]{scroll-behavior:smooth}}').ok, true);
  // animation protégée en imbrication
  assert.equal(run('@media (prefers-reduced-motion: no-preference){@media (min-width: 40rem){@keyframes k{from{opacity:1}}[data-skin-part="card"]{animation:k 1s}}}').ok, true);
});

test("focus : outline:none exige un remplacement visible", () => {
  assert.equal(run('[data-skin-part="button"]{outline:none}\n[data-skin-part="button"]:focus-visible{outline:2px solid var(--v-accent)}').ok, true);
  assert.equal(run('[data-skin-part="button"]{outline:0}\n[data-skin-part="button"]:focus-visible{box-shadow:0 0 0 3px var(--v-accent)}').ok, true);
  assert.equal(run('[data-skin-part="button"]{outline:none}').ok, false);
  assert.equal(run('[data-skin-part="button"]:focus-visible{outline:none;border-color:red}').ok, true);
});

test("variables : redéfinition locale, chaînes, cycles évités", () => {
  const r = okOut('[data-skin-part="card"]{--sk-radius-card:0;--v-accent:#e11d48;--sk-a:var(--sk-b);--sk-b:1px;border-radius:var(--sk-radius-card)}');
  assert.ok(r.css.includes("--sk-a:var(--sk-b)"));
  const cyc = run('[data-skin-part="card"]{--sk-a:var(--sk-b);--sk-b:var(--sk-a);color:red}');
  assert.equal(cyc.ok, false);
  assert.ok(!cyc.css.includes("--sk-a") && !cyc.css.includes("--sk-b"), "les variables en cycle sont retirées");
  assert.ok(cyc.css.includes("color:red"));
});

test("erreurs partielles : la règle ou la déclaration fautive est retirée, le reste est conservé", () => {
  const r = run('[data-skin-part="card"]{color:red;display:none;margin:1rem}\n[data-skin-part="nope"]{color:red}\n.card{color:red}\n[data-skin-part="chip"]{padding:1rem}');
  assert.equal(r.ok, false);
  assert.equal(r.css, `${P}[data-skin-part="card"]{color:red;margin:1rem}\n${P}[data-skin-part="chip"]{padding:1rem}`);
  assert.deepEqual(codes(r), ["hide-forbidden", "unknown-part", "class-selector"]);
  assert.ok(r.issues.every((i) => i.line >= 1));
});

test("plafonds : valeurs par défaut du §5.3 et du §6.6", () => {
  assert.equal(DEFAULT_LIMITS.maxBytes, 60 * 1024);
  assert.equal(DEFAULT_LIMITS.maxRules, 600);
  assert.equal(DEFAULT_LIMITS.maxKeyframes, 12);
  assert.equal(DEFAULT_LIMITS.maxCustomValueLength, 300);
  const rules = Array.from({ length: 600 }, (_, i) => `[data-skin-part="card"]:nth-child(${i + 1}){color:red}`).join("\n");
  assert.equal(run(rules).ok, true, "600 règles passent");
  const over = run(rules + '\n[data-skin-part="chip"]{color:red}');
  assert.equal(over.ok, false);
  assert.equal(over.css, "", "au-delà d'un plafond, rien n'est appliqué (§6.6)");
  assert.deepEqual(codes(over), ["too-many-rules"]);
  const cap = run("/*" + "x".repeat(60 * 1024) + "*/");
  assert.deepEqual(codes(cap), ["sheet-too-large"], "60 Ko + le commentaire dépasse");
  assert.equal(run("/*" + "x".repeat(60 * 1024 - 4) + "*/").ok, true, "exactement 60 Ko");
  assert.equal(run('[data-skin-part="card"]{color:red}', { limits: { maxBytes: 10 } }).ok, false, "plafond réglable");
  assert.ok(run('[data-skin-part="card"]{--sk-x:' + "a".repeat(300) + "}").ok, "300 caractères exactement");
});

test("robustesse : entrées bizarres ne lèvent jamais d'exception", () => {
  for (const input of [undefined, null, 0, 1, {}, [], () => 1, Symbol("x"), "", "   ", "\n", "}", "{", "{}", "@", "@media", "/*", "a{", "a{b", "a{b:", ";;;", "\ufeff", "\ufeff[data-skin-part=\"card\"]{color:red}", "💥", "\u0000"]) {
    const r = run(input);
    assert.equal(typeof r.ok, "boolean");
    assert.equal(typeof r.css, "string");
    assert.ok(Array.isArray(r.issues));
    assertSafeOutput(assert, r.css, ID);
  }
  for (const id of [undefined, null, "", "A", "basic", "a", "-x", "x".repeat(60), "x y", "x\"]{}", 5]) {
    const r = sanitizeSkinCss('[data-skin-part="card"]{color:red}', { skinId: id });
    assert.equal(r.ok, false);
    assert.equal(r.css, "");
    assert.deepEqual(codes(r), ["bad-skin-id"]);
  }
  assert.doesNotThrow(() => sanitizeSkinCss("a", undefined));
  assert.doesNotThrow(() => sanitizeSkinCss("a", null));
});

test("BOM, fins de ligne Windows, commentaires et espaces", () => {
  const r = okOut('\ufeff/* en-tête */\r\n[data-skin-part="card"] /* c */ {\r\n  color : red ; /* x */\r\n  margin:0 auto\r\n}\r\n');
  assert.equal(r.css, `${P}[data-skin-part="card"]{color:red;margin:0 auto}`);
});

test("jetons : la valeur d'un jeton suit les mêmes règles que la feuille", () => {
  const ok = sanitizeTokenValue("--sk-radius-card", "0.5rem", { skinId: ID });
  assert.deepEqual([ok.ok, ok.value], [true, "0.5rem"]);
  assert.equal(sanitizeTokenValue("--v-font", '"Skin Body", Georgia, serif', { skinId: ID }).ok, true);
  assert.equal(sanitizeTokenValue("--sk-grid", "url(skin:images/grid.svg)", { skinId: ID }).ok, true);
  assert.equal(sanitizeTokenValue("--sk-grid", "url(skin:images/grid.svg)", { skinId: ID, assetBase: "/skins/plain-light/2.0.0/" }).value, 'url("/skins/plain-light/2.0.0/images/grid.svg")');
  for (const [name, value] of [["--sk-x", "url(http://evil.example/a.png)"], ["--sk-x", "expression(1)"], ["--sk-x", "a".repeat(301)], ["--sk-x", '"texte"'], ["--evil", "1"], ["--sk-x", 5], ["--sk-x", "var(--other)"], ["--sk-x", "1 !important"]]) {
    assert.equal(sanitizeTokenValue(name, value, { skinId: ID }).ok, false, `${name}: ${value}`);
  }
});

test("messages : chaque problème a un code, un message FR et EN, une aide", () => {
  const r = run('.card{color:red}\n[data-skin-part="card"]{display:none;background:url(https://x.example/a.png)}');
  assert.ok(r.issues.length >= 3);
  for (const i of r.issues) {
    assert.match(i.code, /^[a-z0-9-]+$/);
    assert.ok(i.message.fr.length > 10 && i.message.en.length > 10 && i.hint.fr.length > 3 && i.hint.en.length > 3);
    assert.ok(!/\{[a-z]+\}/i.test(i.message.fr + i.message.en + i.hint.fr + i.hint.en), "variable non remplacée");
    assert.ok(["error", "warning"].includes(i.severity));
  }
});

test("pannes internes : l'assainisseur échoue toujours du côté prudent (sortie vide, erreur)", () => {
  const css = '[data-skin-part="card"]{color:red}';
  const r = sanitizeSkinCss(css, { get skinId() { throw new Error("boom"); } });
  assert.deepEqual([r.ok, r.css, r.issues.map((i) => i.code)], [false, "", ["internal-error"]]);
  const t = sanitizeTokenValue("--sk-x", "1px", { get skinId() { throw new Error("boom"); } });
  assert.deepEqual([t.ok, t.issues.map((i) => i.code)], [false, ["internal-error"]]);
  assert.equal(sanitizeTokenValue("--sk-x", "1px", { skinId: ID, assetBase: "pas-valide" }).ok, true, "base invalide ignorée pour un jeton sans url");
});

test("@font-face : variantes d'écriture acceptées et refusées", () => {
  const face = (body) => `@font-face{${body}}`;
  const opts = { assets: ["fonts/a.woff2", "fonts/b.woff2"], fontFamilies: ["X"] };
  assert.equal(run(face('font-family:X;src:url(skin:fonts/a.woff2),url(skin:fonts/b.woff2) format(woff2);font-weight:bold;font-style:oblique;unicode-range:U+0000-00FF,U+0131'), opts).ok, true);
  assert.equal(run(face('font-family:"X";src:url(skin:fonts/a.woff2);font-weight:400 700 900'), opts).ok, false, "trois graisses");
  assert.equal(run(face('font-family:"X";src:url(skin:fonts/a.woff2);font-weight:2000'), opts).ok, false);
  assert.equal(run(face('font-family:"X";src:url(skin:fonts/a.woff2);font-style:fancy'), opts).ok, false);
  assert.equal(run(face('font-family:"X";src:url(skin:fonts/a.woff2) format("woff")'), opts).ok, false);
  assert.equal(run(face('font-family:"X" "Y";src:url(skin:fonts/a.woff2)'), opts).ok, false);
  assert.equal(run(face('font-family:"X<";src:url(skin:fonts/a.woff2)'), opts).ok, false);
  assert.equal(run(face('font-family:"X";src:url(skin:fonts/a.woff2'), opts).ok, false);
  assert.equal(run('@font-face;', opts).ok, false);
  assert.equal(run(face('font-family:"X";src:url(skin:fonts/a.woff2)\n/* c */'), opts).ok, true);
});

test("@keyframes : variantes", () => {
  const m = (inner) => `@media (prefers-reduced-motion: no-preference){${inner}}`;
  assert.equal(run(m("@keyframes a{from,to{opacity:1}}")).ok, true);
  assert.equal(run(m("@keyframes a{0%,50.5%{opacity:1}100%{opacity:.8}}")).ok, true);
  assert.equal(run(m("@keyframes a{from{opacity:1}to{opacity:1}}[data-skin-part=\"card\"]{animation:a 1s ease-in-out 2 alternate both paused}")).ok, true);
  assert.equal(run(m("@keyframes a;")).ok, false);
  assert.equal(run(m("@keyframes sk-plain-light-a{from{opacity:1}}")).ok, true, "déjà préfixé : conservé");
  assert.equal(run(m("@keyframes a{from{opacity:1}}@keyframes a{to{opacity:1}}")).ok, true, "deux blocs du même nom : acceptés");
  assert.equal(run(m("@keyframes a{from{}}")).ok, true, "image vide ignorée");
});

test("media : combinaisons et limites de grammaire", () => {
  const ok = (c) => assert.equal(run(`${c}{[data-skin-part="card"]{color:red}}`).ok, true, c);
  const ko = (c) => assert.equal(run(`${c}{[data-skin-part="card"]{color:red}}`).ok, false, c);
  ok("@media (max-width: 48rem)"); ok("@media (min-height: 30em) and (max-height: 90em)"); ok("@media (orientation: landscape)"); ok("@media (prefers-contrast: more)"); ok("@media (any-hover: none)");
  ok("@media (min-width: 640px)"); ok("@media (320px <= width < 40rem)"); ok("@media (width > 40rem) and (height < 60rem)"); ok("@media all"); ok("@media screen");
  ok("@container (inline-size > 30em)"); ok("@container side (min-width: 10rem) and (max-height: 50em)");
  ko("@media (min-width)"); ko("@media (min-width: 40)"); ko("@media (min-width: 40rem) or (max-width: 20rem)"); ko("@media only screen"); ko("@media (width >= )"); ko("@media ((min-width: 40rem))");
  ko("@media (min-width: 40rem) and"); ko("@media (min-width: 40rem) and (min-width: 41rem) and (min-width: 42rem) and (min-width: 43rem) and (min-width: 44rem)"); ko("@media (min-width: 40rem"); ko("@media min-width: 40rem)");
  ko("@container name"); ko("@container (min-width: 1px)"); ko("@container (min-width: 20rem) and (min-width: 21rem) and (min-width: 22rem) and (min-width: 23rem)");
  ko("@supports (color: red) or"); ko("@supports (color: red) (color: blue)"); ko("@supports color: red"); ko("@supports (color red)");
  ko("@supports (color: red) and (color: blue) and (color: green) and (color: pink) and (color: gold)");
});

test("sélecteurs : formes d'écriture acceptées et refusées", () => {
  const ok = (s) => assert.equal(run(`${s}{color:red}`).ok, true, s);
  const ko = (s) => assert.equal(run(`${s}{color:red}`).ok, false, s);
  ok('[data-skin-part=card]'); ok("[ data-skin-part = 'card' ]"); ok('[DATA-SKIN-PART="card"]'); ok('BUTTON[data-skin-part="button"]'); ok('[data-skin-part="card"] >[data-skin-part="chip"]');
  ok('[data-skin-part="card"]\n\t>\n\t[data-skin-part="chip"]'); ok('[data-skin-part="card"]:HOVER'); ok('[data-skin-part="card"]::BEFORE'); ok('[data-skin-part="list-item"]:nth-child( 2N + 1 )'); ok('[data-skin-part="list-item"]:nth-child(-n+3)');
  ok('[data-skin-part="card"]:has(+ [data-skin-part="chip"])'); ok('[data-skin-part="card"]:not(:hover, :focus)'); ok('[data-skin-part="card"]:is(a, button):hover');
  ko('[data-skin-part=card'); ko('[data-skin-part="card]'); ko('[data-skin-part="card"'); ko('[data-skin-part="card"]:'); ko('[data-skin-part="card"]::'); ko('[data-skin-part="card"]:hover(1)'); ko('[data-skin-part="card"]:not'); ko('[data-skin-part="card"]:not('); ko('[data-skin-part="card"]:not()');
  ko('[data-skin-part="card"]:nth-child()'); ko('[data-skin-part="card"]:nth-child(1000000)'); ko('[data-skin-part="card"]:hover:is(:hover:is(:hover:is(:hover)))'); ko('[data-skin-part="card"] , , a'); ko('[data-skin-part="card"]:has(a b c)');
  ko('[data-skin-part="card"]:has(:has(a))'); ko('[data-skin-part="card"]:not(a::before)'); ko('[=card]'); ko('[data-skin-part~="card"]'); ko('[data-skin-part="card"]:first-child::before:hover');
});

test("valeurs : unités, nombres et jetons limites", () => {
  const ok = (p, v) => assert.equal(run(`[data-skin-part="card"]{${p}:${v}}`).ok, true, `${p}:${v}`);
  const ko = (p, v) => assert.equal(run(`[data-skin-part="card"]{${p}:${v}}`).ok, false, `${p}:${v}`);
  ok("margin", "-1.5rem"); ok("margin", "+.5rem"); ok("margin", "1e1px"); ok("width", "100svh"); ok("padding", "1ch 2ex"); ok("gap", "0"); ok("flex", "1 1 0%"); ok("font-size", "calc(1rem + 2px)"); ok("line-height", "1.5"); ok("width", "50%");
  ok("color", "#FfF"); ok("transform", "translate(-50%, -50%)"); ok("transform", "rotate(0.01turn)"); ok("transform", "scale(1.05) translateX(2rem)"); ok("transition", "all 1ms"); ok("grid-template-areas", '"a b" "c d"'); ok("font-feature-settings", '"liga" 1, "kern" 0');
  ok("top", "50%"); ok("inset", "0 0 auto 0"); ok("opacity", "60%"); ok("z-index", "30"); ok("order", "-10"); ok("text-indent", "-0.5em"); ok("letter-spacing", "-0.05em"); ok("height", "4px"); ok("margin", "-4rem");
  ko("margin", "1foo"); ko("margin", "1e"); ko("margin", "--1px"); ko("color", "#12"); ko("width", "3px 4px (5"); ko("transform", "scale(1.2)"); ko("transform", "rotate(0.02turn)"); ko("font-size", "10.9px"); ko("height", "3px"); ko("text-indent", "-0.6em"); ko("top", "-17px");
  ko("grid-template-areas", '"a;b"'); ko("font-feature-settings", '"ligature"'); ko("margin", "-4.1rem"); ko("opacity", "59%"); ko("line-height", "0.79"); ko("line-height", "7px");
});
