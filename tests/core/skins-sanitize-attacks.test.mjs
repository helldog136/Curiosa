// Assainisseur de feuilles de style de skins (docs/SKINS.md §6) : corpus d'attaques et de contournements classiques.
// Chaque cas doit être REFUSÉ (ok === false) avec le code attendu, et la sortie ne doit rien contenir d'interdit.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const { NON_HIDEABLE } = await import("@/core/skins/allowlist");

const ID = "attack-test";
const run = (css, options = {}) => sanitizeSkinCss(css, { skinId: ID, ...options });
const codes = (r) => r.issues.map((i) => i.code);

/** Une règle valide autour d'une déclaration ou d'un sélecteur. */
const decl = (d, sel = '[data-skin-part="card"]') => `${sel}{${d}}`;
const bg = (v) => decl(`background:${v}`);

/** [nom, css, codes attendus (au moins un doit apparaître)] */
const cases = [];
const add = (name, css, expected) => cases.push({ name, css, expected: Array.isArray(expected) ? expected : [expected] });

// ---------- url() : échappements CSS, commentaires, unicode, espaces, guillemets
for (const [name, v] of [
  ["url absolue http", "url(http://evil.example/x.png)"],
  ["url absolue https", "url(https://evil.example/x.png)"],
  ["url protocole relatif", "url(//evil.example/x.png)"],
  ["url entre guillemets doubles", 'url("http://evil.example/x.png")'],
  ["url entre guillemets simples", "url('http://evil.example/x.png')"],
  ["url avec espaces dedans", "url(  'http://evil.example/x.png'  )"],
  ["url avec tabulations", "url(\t'http://evil.example/x.png'\t)"],
  ["URL en majuscules", "URL(http://evil.example/x.png)"],
  ["Url mixte", "UrL(http://evil.example/x.png)"],
  ["url data: png", "url(data:image/png;base64,AAAA)"],
  ["url data: svg", 'url("data:image/svg+xml;utf8,<svg onload=alert(1)>")'],
  ["url javascript:", "url(javascript:alert(1))"],
  ["url vbscript:", "url(vbscript:msgbox(1))"],
  ["url relative sans skin:", "url(images/a.png)"],
  ["url relative au site", "url(/admin/logo.png)"],
  ["url blob:", "url(blob:https://x/1)"],
  ["url file:", "url(file:///etc/passwd)"],
  ["url skin: hors images", "url(skin:../secret.png)"],
  ["url skin: avec ..", "url(skin:images/../../a.png)"],
  ["url skin: chemin absolu", "url(skin:/images/a.png)"],
  ["url skin: majuscules", "url(skin:images/A.PNG)"],
  ["url skin: extension .html", "url(skin:images/a.html)"],
  ["url skin: extension .js", "url(skin:images/a.js)"],
  ["url skin: dossier fonts pour une image", "url(skin:fonts/a.woff2)"],
  ["url skin: fragment", "url(skin:images/a.svg#x)"],
  ["url skin: requête", "url(skin:images/a.png?x=1)"],
  ["url vide", "url()"],
  ["url non fermée", "url(skin:images/a.png"],
  ["url avec parenthèse dedans", "url(skin:images/a(1).png)"],
  ["url avec guillemet dedans", 'url(skin:images/a".png)'],
  ["url avec espace au milieu", "url(skin:images/a b.png)"],
  ["url avec antislash", "url(skin:images/a\\b.png)"],
  ["url avec échappement du u", "\\75 rl(http://evil.example/x.png)"],
  ["url avec échappement long du u", "\\000075rl(http://evil.example/x.png)"],
  ["url avec échappement du r", "u\\72 l(http://evil.example/x.png)"],
  ["url avec échappement du l", "ur\\6c (http://evil.example/x.png)"],
  ["url avec échappement de la parenthèse", "url\\28 http://evil.example/x.png)"],
  ["url avec échappement majuscule", "\\55 \\52 \\4c (http://evil.example/x.png)"],
  ["url coupée par un commentaire", "ur/**/l(http://evil.example/x.png)"],
  ["url coupée par un commentaire avant la parenthèse", "url/**/(http://evil.example/x.png)"],
  ["url avec commentaire et espace", "ur/* x */l (http://evil.example/x.png)"],
  ["url en pleine largeur unicode", "ＵＲＬ(http://evil.example/x.png)"],
  ["url avec lettre cyrillique", "uгl(http://evil.example/x.png)"],
  ["url avec caractère de largeur nulle", "ur\u200bl(http://evil.example/x.png)"],
  ["url avec octet nul", "url(http://evil.example/x.png\u0000)"],
  ["image-set", 'image-set("a.png" 1x)'],
  ["image-set avec url", "image-set(url(http://evil.example/x.png) 1x)"],
  ["-webkit-image-set", '-webkit-image-set(url(http://evil.example/x.png) 1x)'],
  ["image()", 'image("http://evil.example/x.png")'],
  ["cross-fade", "cross-fade(url(skin:images/a.png), url(skin:images/b.png), 50%)"],
  ["element()", "element(#cible)"],
  ["paint()", "paint(worklet)"],
  ["src()", 'src("http://evil.example/x.png")'],
  ["attr() dans un fond", "attr(data-img)"],
  ["expression()", "expression(alert(1))"],
  ["EXPRESSION()", "EXPRESSION(alert(1))"],
  ["expression avec commentaire", "expr/**/ession(alert(1))"],
  ["expression échappée", "\\65 xpression(alert(1))"],
  ["var avec fallback url externe", "var(--sk-image, url(http://evil.example/x.png))"],
  ["var avec fallback image-set", "var(--sk-image, image-set(url(skin:images/a.png) 1x))"],
  ["dégradé avec url externe", "linear-gradient(red, url(http://evil.example/x.png))"],
  ["calc avec url", "calc(url(http://evil.example/x.png))"],
  ["fonction inconnue", "magic(1)"],
  ["fonction -moz-binding", "-moz-binding(url(x))"],
  ["fonction local()", "local(Arial)"],
  ["env() non sûr", "env(keyboard-inset-top)"],
  ["var avec nom hors jetons", "var(--tw-gradient-stops)"],
  ["var sans nom", "var()"],
  ["var avec nom en majuscules", "var(--SK-Image)"],
  ["counter()", "counter(item)"],
]) {
  add(`fond : ${name}`, bg(v), [
    "url-external", "url-path-bad", "image-function-forbidden", "attr-forbidden", "expression-forbidden", "function-not-allowed", "escape-sequence", "non-ascii-char",
    "char-forbidden", "url-bad", "value-syntax", "var-name-not-allowed", "env-not-allowed", "counter-forbidden", "local-font-forbidden", "color-bad", "asset-not-declared", "css-syntax", "invalid-character",
  ]);
}

// url() autorisée seulement dans les propriétés d'image ; ailleurs, même `skin:` est refusé
for (const prop of ["color", "cursor", "list-style", "list-style-type", "border-image", "border-image-source", "content", "quotes", "font-family", "filter", "clip-path", "width", "margin", "outline", "box-shadow", "text-shadow", "transition", "animation", "transform"]) {
  add(`url(skin:) refusée dans ${prop}`, decl(`${prop}:url(skin:images/a.png)`), ["url-not-allowed-here", "property-not-allowed", "content-not-allowed", "value-not-allowed", "content-selector", "filter-not-allowed", "clip-path-subject", "clip-path-bad", "animation-needs-motion-query", "transform-not-allowed"]);
}

// ---------- @-règles
for (const [name, css] of [
  ["@import url", '@import url("https://evil.example/x.css");'],
  ["@import chaîne", '@import "https://evil.example/x.css";'],
  ["@IMPORT majuscules", '@IMPORT "https://evil.example/x.css";'],
  ["@Import mixte", '@Import url(https://evil.example/x.css);'],
  ["@import avec media", '@import url(https://evil.example/x.css) screen;'],
  ["@import après une règle", '[data-skin-part="card"]{color:red}\n@import "https://evil.example/x.css";'],
  ["@import échappé", '@im\\70 ort "https://evil.example/x.css";'],
  ["@import avec commentaire", '@/**/import "https://evil.example/x.css";'],
  ["@import dans un media", '@media (min-width: 40rem){@import "https://evil.example/x.css";}'],
]) add(name, css, ["import-forbidden", "at-rule-forbidden", "css-syntax", "at-rule-syntax"]);
for (const [name, css] of [
  ["@charset", '@charset "utf-8";'],
  ["@namespace", '@namespace url(http://www.w3.org/1999/xhtml);'],
  ["@layer", "@layer base{[data-skin-part=\"card\"]{color:red}}"],
  ["@layer déclaratif", "@layer a, b;"],
  ["@property", '@property --sk-x{syntax:"<length>";inherits:false;initial-value:0px}'],
  ["@page", "@page{margin:0}"],
  ["@font-feature-values", "@font-feature-values Foo{@styleset{a:1}}"],
  ["@counter-style", '@counter-style x{system:cyclic;symbols:"a"}'],
  ["@view-transition", "@view-transition{navigation:auto}"],
  ["@starting-style", '@starting-style{[data-skin-part="card"]{opacity:0}}'],
  ["@document", "@document url-prefix(){a{color:red}}"],
  ["@-moz-document", "@-moz-document url-prefix(){a{color:red}}"],
  ["@-webkit-keyframes", "@-webkit-keyframes x{from{opacity:1}}"],
  ["@scope", '@scope ([data-skin-part="card"]){a{color:red}}'],
  ["@container style", "@container style(--x:1){a{color:red}}"],
  ["@tailwind", "@tailwind base;"],
  ["@apply", '[data-skin-part="card"]{@apply p-4;}'],
  ["@theme", "@theme{--color-x:red}"],
  ["@source", '@source "../x";'],
  ["@utility", "@utility foo{color:red}"],
  ["@custom-media", "@custom-media --x (min-width:40rem);"],
  ["@position-try", "@position-try --a{top:0}"],
  ["@page majuscules", "@PAGE{margin:0}"],
  ["@échappé @m\\65 dia", "@m\\65 dia (min-width: 40rem){[data-skin-part=\"card\"]{color:red}}"],
]) add(name, css, ["at-rule-forbidden", "css-syntax", "at-rule-syntax", "declaration-outside-rule", "nested-rule-forbidden", "media-feature-not-allowed", "selector-syntax", "media-syntax"]);

// ---------- sélecteurs hors portée
for (const sel of [
  "*", "html", "body", ":root", "html body", "body *", "html, body", ":root[data-skin]", ":root[data-skin=\"other\"]", "[data-skin=\"other\"]", ":root[data-skin=\"other\"] [data-skin-part=\"card\"]",
  "[data-skin]", "a", "p", "div", "span", "main", "header", "nav", "footer", "section", "form", "script", "style", "iframe", "svg", "img", "button", "input", "head", "title", "link", "meta", "template",
  ".card", ".sk-card", ".bg-accent", ".prose", "#content", "#main", "#__next", ".a.b", "a.b", "[data-skin-part=\"card\"].extra", "[data-skin-part=\"card\"]#x",
  "[class]", "[class=\"x\"]", "[class*=\"x\"]", "[id]", "[id=\"content\"]", "[href]", "[href^=\"http\"]", "[href$=\".pdf\"]", "[style]", "[onclick]", "[data-testid=\"panel\"]", "[data-card]",
  "[data-skin-part]", "[data-skin-region]", "[data-skin-part^=\"c\"]", "[data-skin-part*=\"a\"]", "[data-skin-part$=\"d\"]", "[data-skin-part~=\"card\"]", "[data-skin-part|=\"card\"]",
  "[data-skin-part=\"nope\"]", "[data-skin-part=\"Card\"]", "[data-skin-part=\"\"]", "[data-skin-region=\"aside\"]", "[data-skin-region=\"body\"]", "[data-skin-part=\"admin\"]",
  "[data-skin-part=\"card\"] > *", "[data-skin-part=\"card\"] *", "[data-skin-part=\"card\"] div", "[data-skin-part=\"card\"] span", "[data-skin-part=\"card\"] .x", "[data-skin-part=\"card\"] #x",
  "[data-skin-part=\"card\"] [class]", "[data-skin-part=\"card\"] script", "[data-skin-part=\"card\"] style", "[data-skin-part=\"card\"] iframe", "[data-skin-part=\"card\"] object", "[data-skin-part=\"card\"] embed",
  "a [data-skin-part=\"card\"]", "div [data-skin-part=\"card\"]", ":hover [data-skin-part=\"card\"]", "[aria-current] [data-skin-part=\"card\"]", ":not(a) [data-skin-part=\"card\"]",
  "[data-skin-part=\"card\"], a", "a, [data-skin-part=\"card\"]", "[data-skin-part=\"card\"], *", "[data-skin-part=\"card\"],body", "[data-skin-part=\"card\"] , html", "[data-skin-part=\"card\"],\n.card",
  "[data-skin-part=\"card\"]:is(*)", "[data-skin-part=\"card\"]:is(body)", "[data-skin-part=\"card\"]:is(.x)", "[data-skin-part=\"card\"]:where(html)", "[data-skin-part=\"card\"]:not(.x)",
  "[data-skin-part=\"card\"]:has(body)", "[data-skin-part=\"card\"]:has(.x)", "[data-skin-part=\"card\"]:has(:root)", "[data-skin-part=\"card\"]:has(> *)",
  ":is(*) [data-skin-part=\"card\"]", ":is(body) [data-skin-part=\"card\"]", ":where(html) [data-skin-part=\"card\"]", ":has([data-skin-part=\"card\"])", ":not([data-skin-part=\"card\"])",
  ":is([data-skin-part=\"card\"], body)", ":is([data-skin-part=\"card\"], .x)", ":where([data-skin-part=\"card\"], a)", ":is([data-skin-part=\"card\"]) , body",
  "[data-skin-part=\"card\"]:is(:is(:is(a)))", "[data-skin-part=\"card\"]:not(:not(:not(a)))", "[data-skin-part=\"card\"]:has(:has(a))", "[data-skin-part=\"card\"]:has(a b c)",
  "[data-skin-part=\"card\"]:visited", "[data-skin-part=\"card\"]:link", "[data-skin-part=\"card\"]:target", "[data-skin-part=\"card\"]:host", "[data-skin-part=\"card\"]:host(x)",
  "[data-skin-part=\"card\"]:nth-child(2 of .x)", "[data-skin-part=\"card\"]:nth-child(x)", "[data-skin-part=\"card\"]:nth-last-child(1)", "[data-skin-part=\"card\"]:lang(fr)", "[data-skin-part=\"card\"]:dir(rtl)",
  "[data-skin-part=\"card\"]:fullscreen", "[data-skin-part=\"card\"]:modal", "[data-skin-part=\"card\"]:state(x)", "[data-skin-part=\"card\"]:scope", "[data-skin-part=\"card\"]:defined", "[data-skin-part=\"card\"]:autofill",
  "[data-skin-part=\"card\"]::part(x)", "[data-skin-part=\"card\"]::slotted(x)", "[data-skin-part=\"card\"]::backdrop", "[data-skin-part=\"card\"]::cue", "[data-skin-part=\"card\"]::file-selector-button", "[data-skin-part=\"card\"]::-webkit-scrollbar",
  "[data-skin-part=\"card\"]::before::after", "[data-skin-part=\"card\"]::before:hover", "[data-skin-part=\"card\"]::before a", "[data-skin-part=\"card\"]::before > a", "[data-skin-part=\"card\"]:not(::before)",
  "[data-skin-part=\"card\"]\\.x", "[data-skin-part=\"card\"] \\2e x", "\\5b data-skin-part=\"card\"]", "[data\\2d skin-part=\"card\"]", "[data-skin-part=\"c\\61 rd\"]",
  "[data-skin-part=\"card\"]&", "& [data-skin-part=\"card\"]", "&", "[data-skin-part=\"card\"] & a",
  "svg|a", "*|a", "|a", "[data-skin-part=\"card\"] || a", "[data-skin-part=\"card\"] >> a", "[data-skin-part=\"card\"] /deep/ a", "[data-skin-part=\"card\"] >>> a",
  "[data-skin-part=\"card\"] > > a", ">[data-skin-part=\"card\"]", "+ [data-skin-part=\"card\"]", "~ [data-skin-part=\"card\"]", "[data-skin-part=\"card\"] >", "[data-skin-part=\"card\"],", ",[data-skin-part=\"card\"]", ",",
  "[data-skin-part=\"card\"] /* x */ . x", "[data-skin-part=\"card\"]<a", "[data-skin-part=\"card\"]{}", "[data-skin-part=\"card\"]\u00e9", "é", "[data-skin-part=\"café\"]", "[data-skin-part=\"card\"] ｂｏｄｙ",
  "[data-skin-region=\"shell\"] ~ body", "[data-skin-region=\"shell\"]:not(html)", "[data-skin-region=\"shell\"]:is(html, body)",
  "[aria-current]", "[aria-current=\"page\"]", "[role=\"button\"]", "[data-open=\"true\"]", ":hover", ":focus-visible", "::before", "::selection", ":empty", ":first-child", ":checked",
  "[data-skin-region=\"header\"][data-skin=\"x\"]", "[data-skin-region=\"header\"]:root", ":root[data-skin-region=\"header\"]",
  "[data-skin-part=\"card\"][data-x]", "[data-skin-part=\"card\"][onclick]", "[data-skin-part=\"card\"][style]", "[data-skin-part=\"card\"][href^=\"javascript:\"]", "[data-skin-part=\"card\"][data-kind=\"a b\"]",
  "[data-skin-part=\"card\"][data-kind=\"a\\\"]", "[data-skin-part=\"card\"][data-kind=\"é\"]", "[data-skin-part=\"card\"][data-kind='x'", "[data-skin-part=\"card\"][data-kind i]", "[data-skin-part=\"card\"][data-kind=x i]",
  "[data-skin-part=\"card\"][data-level=\"9\"]", "[data-skin-part=\"card\"][aria-expanded=\"maybe\"]", "[data-skin-part=\"card\"][lang=\"x!\"]", "[data-skin-part=\"card\"][rel=\"external\"]", "[data-skin-part=\"card\"][target~=\"_blank\"]",
]) {
  add(`sélecteur : ${JSON.stringify(sel)}`, `${sel}{color:red}`, [
    "universal-selector", "global-selector", "root-selector", "wrong-scope", "element-not-allowed", "element-needs-module-html", "class-selector", "id-selector", "attribute-not-allowed", "attribute-operator", "attribute-value",
    "unknown-part", "unknown-region", "selector-needs-anchor", "selector-syntax", "pseudo-class-not-allowed", "pseudo-element-not-allowed", "pseudo-element-position", "escape-sequence", "non-ascii-char",
    "nth-bad", "nesting-selector", "namespace-selector", "selector-too-nested", "has-too-deep", "css-syntax", "declaration-outside-rule", "media-syntax",
  ]);
}

// ---------- propriétés hors liste blanche
for (const prop of [
  "behavior", "-moz-binding", "-ms-behavior", "zoom", "all", "visibility", "clip", "content-visibility", "will-change", "contain", "container", "perspective", "transform-style", "backface-visibility",
  "direction", "unicode-bidi", "writing-mode", "text-orientation", "text-overflow", "line-clamp", "-webkit-line-clamp", "-webkit-text-fill-color", "-webkit-text-stroke", "text-stroke", "-webkit-box-orient",
  "src", "unicode-range", "font-display", "size-adjust", "speak", "speak-as", "pause", "cue", "voice-family", "orphans", "widows", "page", "page-break-before", "break-before", "break-inside",
  "counter-reset", "counter-increment", "counter-set", "marker", "marker-start", "list-style-image", "cursor-image", "pointer", "touch-action", "scroll-snap-type", "scroll-snap-align", "overscroll-behavior",
  "interpolate-size", "view-transition-name", "anchor-name", "position-anchor", "position-area", "animation-timeline", "animation-range", "offset-path", "offset", "shape-outside", "mask", "mask-border", "-webkit-mask",
  "mask-image-url", "image-rendering", "image-resolution", "forced-color-adjust", "print-color-adjust", "color-adjust", "resize-observer", "field-sizing", "ruby-position", "hanging-punctuation",
  "-webkit-appearance", "-moz-appearance", "-webkit-font-smoothing", "-moz-osx-font-smoothing", "-webkit-tap-highlight-color", "-webkit-overflow-scrolling", "-ms-filter", "filter-url", "background-url", "behaviour",
  "*zoom", "_height", "color\\9", "colo\\72", "c/**/olor", "--other-var", "--TW-ring", "--sk_underscore", "--sk-", "--", "--v-UPPER", "--sk-" + "a".repeat(80),
]) {
  add(`propriété : ${prop}`, decl(`${prop}:1`), ["property-not-allowed", "hiding-property", "custom-property-name", "css-syntax", "declaration-outside-rule", "escape-sequence", "value-syntax"]);
}

// ---------- masquer / sortir de l'écran, sur chaque pièce du §9.3
const HIDERS = [
  ["display none", "display:none", "hide-forbidden"],
  ["display none majuscules", "DISPLAY:NONE", "hide-forbidden"],
  ["display none avec commentaire", "display:/**/none", "hide-forbidden"],
  ["display none !important", "display:none!important", "important-forbidden"],
  ["display via var", "--sk-gone:none;display:var(--sk-gone)", "hide-forbidden"],
  ["display via var en chaîne", "--sk-a:var(--sk-b);--sk-b:none;display:var(--sk-a)", "hide-forbidden"],
  ["visibility hidden", "visibility:hidden", "hiding-property"],
  ["visibility collapse", "visibility:collapse", "hiding-property"],
  ["clip rect", "clip:rect(0,0,0,0)", "hiding-property"],
  ["content-visibility hidden", "content-visibility:hidden", "hiding-property"],
  ["opacity 0", "opacity:0", "opacity-too-low"],
  ["opacity 0.59", "opacity:0.59", "opacity-too-low"],
  ["opacity 0%", "opacity:0%", "opacity-too-low"],
  ["opacity .1", "opacity:.1", "opacity-too-low"],
  ["opacity via var", "--sk-o:0;opacity:var(--sk-o)", "opacity-too-low"],
  ["filter opacity 0", "filter:opacity(0)", "opacity-too-low"],
  ["filter blur énorme", "filter:blur(50px)", "filter-too-strong"],
  ["filter brightness 0", "filter:brightness(0)", "filter-too-strong"],
  ["filter contrast 0", "filter:contrast(0)", "filter-too-strong"],
  ["font-size 0", "font-size:0", "font-size-too-small"],
  ["font-size 0px", "font-size:0px", "font-size-too-small"],
  ["font-size 1px", "font-size:1px", "font-size-too-small"],
  ["font-size 10px", "font-size:10px", "font-size-too-small"],
  ["font-size 0.5rem", "font-size:0.5rem", "font-size-too-small"],
  ["font-size 50%", "font-size:50%", "font-size-too-small"],
  ["font-size xx-small", "font-size:xx-small", "font-size-too-small"],
  ["font-size via var", "--sk-s:0;font-size:var(--sk-s)", "font-size-too-small"],
  ["font-size calc zéro", "font-size:calc(0px)", "font-size-too-small"],
  ["font-size calc soustraction", "font-size:calc(2rem - 2rem)", "font-size-too-small"],
  ["font-size calc multiplication", "font-size:calc(1rem * 0)", "font-size-too-small"],
  ["font-size min", "font-size:min(1rem, 5px)", "font-size-too-small"],
  ["font-size clamp", "font-size:clamp(0px, 1px, 2px)", "font-size-too-small"],
  ["width calc zéro", "width:calc(1px - 1px)", "box-collapsed"],
  ["opacity calc zéro", "opacity:calc(0)", "opacity-too-low"],
  ["opacity calc petit", "opacity:calc(1 / 10)", "opacity-too-low"],
  ["margin calc énorme", "margin-left:calc(-100px * 100)", "margin-too-negative"],
  ["left calc énorme", "position:relative;left:calc(-9999px)", "offset-out-of-range"],
  ["left min énorme", "position:relative;left:max(-9999px, -8000px)", "offset-out-of-range"],
  ["text-indent calc", "text-indent:calc(-100px)", "text-indent-bad"],
  ["line-height calc zéro", "line-height:calc(0)", "line-height-too-small"],
  ["font shorthand 0/0", "font:0/0 serif", ["font-size-too-small", "line-height-too-small"]],
  ["font shorthand 1px", "font:1px/1 serif", "font-size-too-small"],
  ["line-height 0", "line-height:0", "line-height-too-small"],
  ["width 0", "width:0", "box-collapsed"],
  ["width 0px", "width:0px", "box-collapsed"],
  ["width 1px", "width:1px", "box-collapsed"],
  ["height 0", "height:0", "box-collapsed"],
  ["height 1px", "height:1px", "box-collapsed"],
  ["max-height 0", "max-height:0", "box-collapsed"],
  ["max-width 0", "max-width:0", "box-collapsed"],
  ["height 0%", "height:0%", "box-collapsed"],
  ["position absolute left -9999px", "position:absolute;left:-9999px", "offset-out-of-range"],
  ["position absolute top -100vh", "position:absolute;top:-100vh", "offset-out-of-range"],
  ["left -2rem", "position:relative;left:-2rem", "offset-out-of-range"],
  ["left 9999px", "position:relative;left:9999px", "offset-out-of-range"],
  ["top 200%", "position:relative;top:200%", "offset-out-of-range"],
  ["inset énorme", "position:absolute;inset:-5000px", "offset-out-of-range"],
  ["inset-inline-start énorme", "inset-inline-start:-5000px", "offset-out-of-range"],
  ["right 100vw", "position:relative;right:200vw", "offset-out-of-range"],
  ["text-indent -9999px", "text-indent:-9999px", "text-indent-bad"],
  ["text-indent 9999px", "text-indent:9999px", "text-indent-bad"],
  ["margin-left -9999px", "margin-left:-9999px", "margin-too-negative"],
  ["margin -100rem", "margin:-100rem", "margin-too-negative"],
  ["transform scale 0", "transform:scale(0)", "transform-too-large"],
  ["transform scale .5", "transform:scale(.5)", "transform-too-large"],
  ["transform translate énorme", "transform:translateX(-9999px)", "transform-too-large"],
  ["transform translate 200%", "transform:translateY(200%)", "transform-too-large"],
  ["transform translate vw", "transform:translateX(100vw)", "transform-too-large"],
  ["transform rotate 90deg", "transform:rotate(90deg)", "transform-too-large"],
  ["transform rotate 180deg", "transform:rotate(180deg)", "transform-too-large"],
  ["transform matrix", "transform:matrix(0,0,0,0,0,0)", ["function-not-allowed", "transform-not-allowed"]],
  ["transform skew", "transform:skew(80deg)", ["function-not-allowed", "transform-not-allowed"]],
  ["transform perspective", "transform:perspective(1px)", ["function-not-allowed", "transform-not-allowed"]],
  ["transform rotate3d", "transform:rotate3d(1,1,1,90deg)", ["function-not-allowed", "transform-not-allowed"]],
  ["transform avec un filtre", "transform:blur(1px)", "transform-not-allowed"],
  ["transform mot-clé inconnu", "transform:flip", "value-not-allowed"],
  ["color transparent", "color:transparent", "text-transparent"],
  ["color rgba 0", "color:rgba(0,0,0,0)", "text-transparent"],
  ["color alpha 0 moderne", "color:rgb(0 0 0 / 0)", "text-transparent"],
  ["color hex alpha 0", "color:#00000000", "text-transparent"],
  ["color hsl alpha 0", "color:hsl(0 0% 0% / 0%)", "text-transparent"],
  ["mix-blend-mode difference", "mix-blend-mode:difference", "blend-mode-content"],
  ["mix-blend-mode multiply", "mix-blend-mode:multiply", "blend-mode-content"],
  ["pointer-events none", "pointer-events:none", "pointer-events-content"],
  ["user-select none", "user-select:none", "pointer-events-content"],
  ["mask-image dégradé", "mask-image:linear-gradient(transparent,transparent)", "mask-needs-decor"],
  ["overflow scroll", "overflow:scroll", "value-not-allowed"],
  ["overflow clip", "overflow:clip", "value-not-allowed"],
  ["float left", "float:left", "float-not-none"],
  ["float right", "float:right", "float-not-none"],
  ["position fixed", "position:fixed", "position-fixed-forbidden"],
  ["z-index énorme", "z-index:99999", "z-index-range"],
  ["z-index négatif", "z-index:-1", "z-index-range"],
  ["z-index max du cœur", "z-index:40", "z-index-range"],
  ["order énorme", "order:999", "order-range"],
  ["cursor url", "cursor:url(skin:images/a.png),auto", "url-not-allowed-here"],
  ["cursor none", "cursor:none", "value-not-allowed"],
  ["clip-path polygon", "clip-path:polygon(0 0,0 0,0 0)", ["function-not-allowed", "clip-path-subject"]],
  ["clip-path inset non nul", "clip-path:inset(50%)", ["clip-path-bad", "clip-path-subject"]],
  ["letter-spacing énorme", "letter-spacing:100px", "spacing-too-large"],
  ["letter-spacing négatif énorme", "letter-spacing:-1em", "spacing-too-large"],
  ["word-spacing énorme", "word-spacing:50px", "spacing-too-large"],
  ["content texte", 'content:"Promo"', ["content-selector", "content-too-long"]],
  ["scroll-behavior smooth", "scroll-behavior:smooth", "smooth-scroll-needs-motion-query"],
  ["transition longue", "transition:opacity 5s", "transition-too-long"],
  ["transition délai long", "transition:opacity 1ms 5s", "transition-too-long"],
  ["transition-duration longue", "transition-duration:2s", "transition-too-long"],
  ["animation hors media", "animation:x 1s", "animation-needs-motion-query"],
  ["animation-name hors media", "animation-name:x", "animation-needs-motion-query"],
];
// sur chaque pièce de contenu ou d'action (§9.3) et sur les régions porteuses de contenu
const REGION_TARGETS = ["tray", "shell", "banner", "header", "nav", "tools", "main", "content", "footer"];
const TARGETS = [...NON_HIDEABLE.filter((p) => !REGION_TARGETS.includes(p)).map((p) => `[data-skin-part="${p}"]`), ...REGION_TARGETS.map((r) => `[data-skin-region="${r}"]`)];
for (const target of TARGETS) {
  for (const [name, body, code] of HIDERS) {
    // `position: fixed` est permis sur l'en-tête et le menu, et un `nav-list`/`submenu` fermé peut se masquer (cas traités plus bas)
    if (name === "position fixed" && /"(header|nav)"/.test(target)) continue;
    if (name === "float left" && false) continue;
    add(`masquer ${target} : ${name}`, `${target}{${body}}`, code);
  }
}
// … et sur des descendants (éléments de contenu sous une pièce)
for (const sub of ["a", "img", "button", "li", "p", "h1", "svg"]) {
  for (const [name, body, code] of HIDERS.slice(0, 12)) add(`masquer ${sub} dans card : ${name}`, `[data-skin-part="card"] ${sub}{${body}}`, code);
}

// ---------- texte injecté (content)
for (const [name, v] of [
  ["lettres", '"Promo"'], ["un chiffre", '"1"'], ["une lettre", '"a"'], ["ponctuation + lettre", '"· a"'], ["quatre signes", '"····"'], ["emoji suivi de lettre", '"✓ ok"'],
  ["échappement d'une lettre", '"\\61"'], ["échappement d'un chiffre", '"\\31 "'], ["échappement long d'une lettre", '"\\000061"'], ["chiffre arabe", '"٣"'], ["lettre grecque", '"α"'],
  ["attr()", "attr(data-label)"], ["attr() dans une chaîne", '"x" attr(title)'], ["counter()", "counter(c)"], ["counters()", 'counters(c,".")'], ["open-quote", "open-quote"], ["close-quote", "close-quote"],
  ["url image", "url(skin:images/a.png)"], ["url externe", "url(http://evil.example/a.png)"], ["image-set", 'image-set("a.png" 1x)'], ["var", "var(--sk-label)"], ["var avec fallback texte", 'var(--sk-label, "Promo")'],
  ["texte alternatif", '"" / "Texte caché"'], ["deux chaînes", '"·" "·"'], ["chaîne puis attr", '"·" attr(x)'], ["nombre", "12"], ["mot-clé", "hello"], ["chaîne non fermée", '"abc'],
  ["caractère de largeur nulle", '"​"'], ["inverseur bidi", '"‮"'], ["espace insécable", '" a"'], ["retour à la ligne", '"\\a"'], ["octet nul", '"\\0"'],
]) {
  add(`content : ${name}`, decl(`content:${v}`, '[data-skin-part="card"]::before'), ["content-not-allowed", "content-too-long", "value-syntax", "function-not-allowed", "attr-forbidden", "counter-forbidden", "url-external", "url-not-allowed-here", "image-function-forbidden", "invalid-character", "non-ascii-char", "css-syntax"]);
}
add("content sur le composé lui-même", decl('content:"·"'), "content-selector");
add("content sur ::marker", decl('content:"·"', '[data-skin-part="list-item"]::marker'), "content-selector");
add("content sur ::first-letter", decl('content:"·"', '[data-skin-part="prose"]::first-letter'), "content-selector");
add("content sur ::placeholder", decl('content:"·"', '[data-skin-part="input"]::placeholder'), "content-selector");
add("content sur un descendant", decl('content:"·"', '[data-skin-part="card"] a'), "content-selector");
add("quotes avec lettres", decl('quotes:"ab" "cd"'), "content-not-allowed");
add("quotes avec chiffres", decl('quotes:"1" "2"'), "content-not-allowed");

// ---------- chaînes ailleurs
add("chaîne dans color", decl('color:"red"'), "string-not-allowed");
add("chaîne dans width", decl('width:"10px"'), "string-not-allowed");
add("chaîne dans animation-name", decl('animation-name:"x"'), "string-not-allowed");
add("chaîne dans variable de couleur", decl('--sk-x:"Promo"'), "string-not-allowed");
add("chaîne dans variable de police avec caractères spéciaux", decl('--v-font:"A<b>"'), "font-name-bad");
add("police avec accolade", decl('font-family:"A{b"'), "font-name-bad");
add("police avec antislash", decl('font-family:"A\\\\b"'), "font-name-bad");

// ---------- valeurs : caractères et syntaxe
for (const [name, v] of [
  ["accolade ouvrante", "red{"], ["accolade fermante", "red}"], ["chevron <", "red<"], ["</style>", "red</style><script>alert(1)</script>"], ["<!--", "red<!--"], ["-->", "red-->"], ["point-virgule dans chaîne non fermée", '"a;b'],
  ["arobase", "@import"], ["deux-points", "a:b"], ["point d'exclamation", "red!"], ["!important collé", "red!important"], ["! important", "red ! important"], ["!IMPORTANT", "red!IMPORTANT"], ["!ie", "red!ie"],
  ["backslash seul", "red\\"], ["backslash retour à la ligne", "red\\\n"], ["unicode", "réd"], ["emoji", "😀"], ["NUL", "re\u0000d"], ["caractère de contrôle", "re\u0001d"], ["BOM au milieu", "re﻿d"],
  ["séparateur de ligne Unicode", "red blue"], ["parenthèse non fermée", "rgb(0,0,0"], ["parenthèse en trop", "red)"], ["crochets", "[a]"], ["égal", "a=b"], ["tilde", "~a"], ["pipe", "a|b"], ["dollar", "$a"],
  ["backtick", "`a`"], ["pourcentage seul", "%"], ["unité inconnue", "10foo"], ["unité piégée", "10expression"], ["nombre énorme", "1e999999px"], ["hexadécimal invalide", "#ggg"], ["hexadécimal de 5 chiffres", "#12345"], ["hexadécimal de 9 chiffres", "#123456789"],
  ["valeur vide", ""], ["valeur d'espaces", "   "], ["valeur de commentaires", "/* rien */"], ["commentaire non fermé", "red /* abc"],
  ["imbrication profonde", "(".repeat(40) + "1" + ")".repeat(40)], ["fonctions profondes", "calc(".repeat(30) + "1" + ")".repeat(30)],
  ["valeur très longue", "1px ".repeat(200)], ["beaucoup de jetons", "1 ".repeat(400)],
]) {
  add(`valeur : ${name}`, decl(`color:${v}`), ["char-forbidden", "value-syntax", "escape-sequence", "non-ascii-char", "color-bad", "unit-unknown", "value-empty", "value-too-long", "value-too-nested", "important-forbidden", "css-syntax", "invalid-character", "function-not-allowed", "declaration-outside-rule", "string-not-allowed"]);
}

// ---------- variables
add("variable hors jetons", decl("--evil:1px"), "custom-property-name");
add("variable --tw", decl("--tw-ring:1px"), "custom-property-name");
add("variable en majuscules", decl("--SK-x:1px"), "custom-property-name");
add("variable avec accolades", decl("--sk-x:{a:b}"), "char-forbidden");
add("variable avec url externe", decl("--sk-x:url(http://evil.example/a.png)"), "url-external");
add("variable avec @import", decl("--sk-x:@import 'a'"), "char-forbidden");
add("variable avec </style>", decl("--sk-x:</style><script>"), "char-forbidden");
add("variable de 301 caractères", decl("--sk-x:" + "a".repeat(301)), "value-too-long");
add("variable de 5000 caractères", decl("--sk-x:" + "a".repeat(5000)), "value-too-long");
add("variable vide", decl("--sk-x:"), ["value-empty", "css-syntax"]);
add("cycle direct", `[data-skin-part="card"]{--sk-a:var(--sk-a)}`, "var-cycle");
add("cycle à deux", `[data-skin-part="card"]{--sk-a:var(--sk-b);--sk-b:var(--sk-a)}`, "var-cycle");
add("cycle à trois entre règles", `[data-skin-part="card"]{--sk-a:var(--sk-b)}[data-skin-part="button"]{--sk-b:var(--sk-c)}[data-skin-part="chip"]{--sk-c:var(--sk-a)}`, "var-cycle");
add("cycle avec fallback", `[data-skin-part="card"]{--sk-a:var(--sk-b, 1px);--sk-b:var(--sk-a, 2px)}`, "var-cycle");
add("cycle dans une fonction", `[data-skin-part="card"]{--sk-a:calc(var(--sk-b) + 1px);--sk-b:calc(var(--sk-a) * 2)}`, "var-cycle");
{
  // explosion combinatoire : chaque variable référence la précédente dix fois
  let css = '[data-skin-part="card"]{--sk-v0:aaaaaaaaaaaaaaaaaaaa;';
  for (let i = 1; i <= 25; i++) css += `--sk-v${i}:${Array.from({ length: 10 }, () => `var(--sk-v${i - 1})`).join(" ")};`;
  add("explosion de variables (milliards de rires)", css + "}", "var-expansion-too-large");
}
add("var dans width piégée par une variable à zéro", `[data-skin-part="card"]{--sk-w:0;width:var(--sk-w)}`, "box-collapsed");
add("var avec nom piégé", decl("color:var(--sk-a b)"), ["value-syntax", "var-name-not-allowed", "function-not-allowed"]);
add("var avec crochets", decl("color:var(--sk-a[0])"), ["char-forbidden", "var-name-not-allowed", "value-syntax"]);

// ---------- at-règles : conditions et corps
add("media avec requête inconnue", "@media (min-resolution: 2dppx){[data-skin-part=\"card\"]{color:red}}", "media-feature-not-allowed");
add("media avec largeur géante", "@media (min-width: 9999px){[data-skin-part=\"card\"]{color:red}}", "media-length-range");
add("media avec largeur minuscule", "@media (max-width: 1px){[data-skin-part=\"card\"]{color:red}}", "media-length-range");
add("media avec unité inconnue", "@media (min-width: 40vw){[data-skin-part=\"card\"]{color:red}}", "media-length-bad");
add("media avec url", "@media url(x){[data-skin-part=\"card\"]{color:red}}", ["media-syntax", "css-syntax"]);
add("media not", "@media not all and (min-width: 40rem){[data-skin-part=\"card\"]{color:red}}", ["media-syntax", "media-feature-not-allowed"]);
add("media vide", "@media {[data-skin-part=\"card\"]{color:red}}", "media-syntax");
add("media trop de requêtes", "@media print, screen, all, (hover: hover), (hover: none){[data-skin-part=\"card\"]{color:red}}", "media-too-many");
add("media avec échappement", "@media (min-width: 4\\30 rem){[data-skin-part=\"card\"]{color:red}}", "media-syntax");
add("media avec injection", "@media (min-width: 40rem){}a{color:red}/*", ["css-syntax", "selector-needs-anchor", "media-syntax"]);
add("supports selector()", "@supports selector(:has(a)){[data-skin-part=\"card\"]{color:red}}", "supports-syntax");
add("supports avec propriété interdite", "@supports (behavior: url(x)){[data-skin-part=\"card\"]{color:red}}", "supports-property");
add("supports avec url externe", "@supports (background: url(http://evil.example/a.png)){[data-skin-part=\"card\"]{color:red}}", "supports-value");
add("supports vide", "@supports {[data-skin-part=\"card\"]{color:red}}", "supports-syntax");
add("supports and pendant", "@supports (color: red) and {[data-skin-part=\"card\"]{color:red}}", "supports-syntax");
add("supports mélange and/or", "@supports (color: red) and (color: blue) or (color: green){[data-skin-part=\"card\"]{color:red}}", "supports-syntax");
add("container non permis", "@container (min-width: 99999em){[data-skin-part=\"card\"]{color:red}}", "media-length-range");
add("container style()", "@container style(--x: 1){[data-skin-part=\"card\"]{color:red}}", "media-syntax");
add("container avec requête inconnue", "@container (orientation: portrait){[data-skin-part=\"card\"]{color:red}}", "media-feature-not-allowed");
add("media imbriqué trop profond", "@media print{@media print{@media print{@media print{[data-skin-part=\"card\"]{color:red}}}}}", "at-rule-too-deep");
add("media sans bloc", "@media print;", "at-rule-syntax");
add("règle imbriquée (nesting CSS)", `[data-skin-part="card"]{color:red; a{color:blue}}`, "nested-rule-forbidden");
add("règle imbriquée avec &", `[data-skin-part="card"]{& a{color:blue}}`, "nested-rule-forbidden");
add("at-règle imbriquée dans une règle", `[data-skin-part="card"]{@media print{color:red}}`, "nested-rule-forbidden");
add("déclaration hors règle", "color:red;", "declaration-outside-rule");
add("déclaration dans media", "@media print{color:red}", "declaration-outside-rule");

// ---------- @keyframes
add("keyframes hors media de mouvement", "@keyframes x{from{opacity:1}to{opacity:1}}", "keyframes-needs-motion-query");
add("keyframes dans media reduce", "@media (prefers-reduced-motion: reduce){@keyframes x{from{opacity:1}}}", "keyframes-needs-motion-query");
add("keyframes sans nom", "@media (prefers-reduced-motion: no-preference){@keyframes {from{opacity:1}}}", "keyframes-name-bad");
add("keyframes nom réservé", "@media (prefers-reduced-motion: no-preference){@keyframes none{from{opacity:1}}}", "keyframes-name-bad");
add("keyframes nom en majuscules", "@media (prefers-reduced-motion: no-preference){@keyframes Pulse{from{opacity:1}}}", "keyframes-name-bad");
add("keyframes nom avec injection", "@media (prefers-reduced-motion: no-preference){@keyframes a{b}c{from{opacity:1}}}", ["keyframes-name-bad", "css-syntax", "keyframes-content"]);
add("keyframes avec display", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{display:none}to{display:block}}}", "keyframe-property");
add("keyframes avec width", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{width:0}to{width:100%}}}", "keyframe-property");
add("keyframes avec position", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{left:-9999px}to{left:0}}}", "keyframe-property");
add("keyframes opacity 0", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:0}to{opacity:1}}}", "opacity-too-low");
add("keyframes avec animation", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{animation:x 1s}}}", "keyframe-property");
add("keyframes avec variable", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{--sk-a:1}}}", "custom-property-name");
add("keyframes avec transform énorme", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{transform:translateX(-500px)}}}", "transform-too-large");
add("keyframes étape invalide", "@media (prefers-reduced-motion: no-preference){@keyframes x{foo{opacity:1}}}", "keyframes-content");
add("keyframes étape hors 0-100", "@media (prefers-reduced-motion: no-preference){@keyframes x{150%{opacity:1}}}", "keyframes-content");
add("keyframes avec at-règle dedans", "@media (prefers-reduced-motion: no-preference){@keyframes x{@media print{from{opacity:1}}}}", "keyframes-content");
add("trop d'étapes", "@media (prefers-reduced-motion: no-preference){@keyframes x{" + Array.from({ length: 25 }, (_, i) => `${i * 4}%{opacity:1}`).join("") + "}}", "keyframes-too-long");
add("trop de keyframes", "@media (prefers-reduced-motion: no-preference){" + Array.from({ length: 13 }, (_, i) => `@keyframes k${i}{from{opacity:1}}`).join("") + "}", "too-many-keyframes");
add("animation inconnue", "@media (prefers-reduced-motion: no-preference){[data-skin-part=\"card\"]{animation:spin 1s}}", "animation-name-unknown");
add("animation qui vise un keyframes du cœur (Tailwind)", "@media (prefers-reduced-motion: no-preference){[data-skin-part=\"card\"]{animation-name:pulse}}", "animation-name-unknown");
add("animation trop longue", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:1}}[data-skin-part=\"card\"]{animation:x 60s}}", "animation-too-long");
add("animation trop de fois", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:1}}[data-skin-part=\"card\"]{animation:x 1s 10}}", "animation-iterations");
add("animation count trop grand", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:1}}[data-skin-part=\"card\"]{animation:x 1s;animation-iteration-count:99}}", "animation-iterations");
add("animation stroboscopique", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:1}}[data-skin-part=\"card\"]{animation:x 50ms infinite}}", "animation-too-fast");
add("animation stroboscopique en propriétés séparées", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:1}}[data-skin-part=\"card\"]{animation-name:x;animation-duration:100ms;animation-iteration-count:infinite}}", "animation-too-fast");
add("animation avec délai géant", "@media (prefers-reduced-motion: no-preference){@keyframes x{from{opacity:1}}[data-skin-part=\"card\"]{animation:x 1s 99s}}", "animation-too-long");
add("animation dans media print", "@media print{@keyframes x{from{opacity:1}}}", "keyframes-needs-motion-query");

// ---------- @font-face
add("font-face src externe", '@font-face{font-family:"X";src:url(https://evil.example/f.woff2)}', "url-external");
add("font-face src data:", '@font-face{font-family:"X";src:url(data:font/woff2;base64,AAAA)}', ["url-external", "font-face-descriptor"]);
add("font-face src local()", '@font-face{font-family:"X";src:local("Arial")}', ["local-font-forbidden", "font-face-descriptor"]);
add("font-face src .ttf", '@font-face{font-family:"X";src:url(skin:fonts/a.ttf)}', "url-path-bad");
add("font-face src dans images", '@font-face{font-family:"X";src:url(skin:images/a.woff2)}', "url-path-bad");
add("font-face src non déclarée", '@font-face{font-family:"X";src:url(skin:fonts/a.woff2)}', "asset-not-declared");
add("font-face sans src", '@font-face{font-family:"X"}', "font-face-incomplete");
add("font-face sans famille", "@font-face{src:url(skin:fonts/a.woff2)}", "font-face-incomplete");
add("font-face descripteur inconnu", '@font-face{font-family:"X";src:url(skin:fonts/a.woff2);ascent-override:0%}', "font-face-descriptor");
add("font-face avec format piégé", '@font-face{font-family:"X";src:url(skin:fonts/a.woff2) format("truetype")}', "font-face-descriptor");
add("font-face unicode-range piégé", '@font-face{font-family:"X";src:url(skin:fonts/a.woff2);unicode-range:U+0-FF;unicode-range:foo}', "font-face-descriptor");
add("font-face !important", '@font-face{font-family:"X";src:url(skin:fonts/a.woff2)!important}', "important-forbidden");
add("font-face imbriqué", '@media print{@font-face{font-family:"X";src:url(skin:fonts/a.woff2)}}', "font-face-nested");
add("font-face famille non déclarée", '@font-face{font-family:"Y";src:url(skin:fonts/a.woff2)}', "font-family-undeclared");
add("trop de font-face", Array.from({ length: 5 }, () => '@font-face{font-family:"X";src:url(skin:fonts/a.woff2)}').join(""), "too-many-font-faces");
add("font-face avec règle dedans", '@font-face{font-family:"X";src:url(skin:fonts/a.woff2);a{color:red}}', "font-face-descriptor");

// ---------- focus
add("outline none sans remplacement", '[data-skin-part="button"]{outline:none}', "focus-indicator-missing");
add("outline 0 sans remplacement", '[data-skin-part="button"]{outline:0}', "focus-indicator-missing");
add("outline-style none sans remplacement", '[data-skin-part="button"]:focus-visible{outline-style:none}', "focus-indicator-missing");

// ---------- plafonds
add("feuille de plus de 60 Ko", "/*" + "x".repeat(61 * 1024) + "*/", "sheet-too-large");
add("feuille énorme (5 Mo)", "a".repeat(5 * 1024 * 1024), "sheet-too-large");
add("trop de règles", Array.from({ length: 601 }, (_, i) => `[data-skin-part="card"]:nth-child(${i}){color:red}`).join("\n"), ["too-many-rules", "nth-bad"]);
add("trop de déclarations", `[data-skin-part="card"]{${Array.from({ length: 130 }, () => "color:red").join(";")}}`, "too-many-declarations-rule");
add("sélecteur trop long", `[data-skin-part="card"]${' a'.repeat(200)}{color:red}`, ["selector-too-long", "selector-too-deep"]);
add("trop de sélecteurs dans une liste", Array.from({ length: 25 }, () => '[data-skin-part="chip"]').join(",") + "{color:red}", ["selector-list-too-long", "selector-too-long"]);
add("sélecteur trop profond", Array.from({ length: 8 }, () => '[data-skin-part="card"]').join(" ") + "{color:red}", "selector-too-deep");
add("trop d'imbrications fonctionnelles", '[data-skin-part="card"]:not(:not(:not(a))){color:red}', "selector-too-nested");
add("trop de fonds fixes", Array.from({ length: 3 }, (_, i) => `[data-skin-part="card"]:nth-child(${i + 1}){background-attachment:fixed}`).join(""), "fixed-background-limit");
add("feuille illisible", "[data-skin-part=\"card\"]{color:red", "css-syntax");
add("accolade fermante en trop", "}", "css-syntax");
add("caractère NUL", '[data-skin-part="card"]{color:red}\u0000', "invalid-character");
add("caractère de contrôle", '[data-skin-part="card"]{color:red}\u0007', "invalid-character");
add("</style> dans un commentaire", '/* </style><script>alert(1)</script> */[data-skin-part="card"]{color:red}', []);

// ---------------------------------------------------------------------------------------------------------------------

for (const c of cases) {
  test(`attaque : ${c.name}`, () => {
    const opts = c.name.startsWith("font-face") && !/famille non déclarée|src non déclarée/.test(c.name)
      ? { assets: ["fonts/a.woff2"], fontFamilies: ["X"] }
      : /famille non déclarée/.test(c.name) ? { assets: ["fonts/a.woff2"], fontFamilies: ["X"] } : /src non déclarée/.test(c.name) ? { assets: [] } : {};
    const r = run(c.css, opts);
    assertSafeOutput(assert, r.css, ID, c.name);
    if (c.expected.length === 0) return; // cas d'innocuité : seule la sortie compte
    assert.equal(r.ok, false, `devrait être refusé : ${JSON.stringify(c.css.slice(0, 200))} -> ${JSON.stringify(r.css.slice(0, 200))}`);
    assert.ok(r.issues.some((i) => c.expected.includes(i.code)), `codes obtenus ${JSON.stringify(codes(r))}, attendu l'un de ${JSON.stringify(c.expected)} pour ${JSON.stringify(c.css.slice(0, 160))}`);
  });
}

test("corpus d'attaques : taille du corpus", () => {
  assert.ok(cases.length >= 900, `${cases.length} cas`);
});
