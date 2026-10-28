// Skins de test du kit (docs/SKINS.md §13) : un skin VALIDE et, pour chaque défaut que le kit doit attraper, une variante qui contient ce défaut et seulement lui.
// `build(dir)` écrit le dossier du skin ; `static` : codes que le niveau statique doit donner ; `visual` : codes que le niveau navigateur doit donner ; `unsafeCss` :
// feuille ajoutée APRÈS l'assainissement (ce que l'assainisseur refuse, pour prouver que le navigateur l'attraperait aussi : défense en profondeur).
import fs from "node:fs";
import path from "node:path";
import { copySkin, fakeFont } from "./skins.mjs";

const BASE = "plain-light";
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");

/** Le skin valide de référence : copie de `plain-light` sous le nom `id`. */
export function goodSkin(parent, id = "kit-good") {
  const dir = path.join(parent, id);
  copySkin(BASE, dir, { id, patch: (m) => { m.minCore = "0.4.0"; } });
  return dir;
}

/** Un skin à deux modes (clair et sombre), valide : sert à la bascule. */
export function dualSkin(parent, id = "kit-dual") {
  const dir = path.join(parent, id);
  copySkin(BASE, dir, {
    id,
    patch: (m) => { m.modes = ["light", "dark"]; m.tags = ["light", "dark", "sans"]; },
    files: { "tokens.json": JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, dark: { "--v-bg": "#16161a", "--v-surface": "#202026", "--v-fg": "#f2f2f5", "--v-accent": "#8ab4ff" }, common: { "--sk-radius-card": "0.5rem" }, modules: {} }, null, 2) },
  });
  return dir;
}

const withCss = (css) => (dir, id) => copySkin(BASE, dir, { id, files: { "skin.css": css } });

export const DEFECTS = [
  {
    id: "unreadable", what: "texte illisible (gris très pâle sur fond clair)",
    build: (dir, id) => copySkin(BASE, dir, { id, files: { "tokens.json": JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#c9c9c4", "--v-accent": "#1d4ed8" }, dark: {}, common: {}, modules: {} }) } }),
    static: ["read-low-1"],
  },
  {
    id: "hides-link", what: "masque les liens du menu",
    build: withCss('[data-skin-part="nav-link"] { display: none; }\n'),
    static: ["hide-forbidden"],
    unsafeCss: ':root[data-skin="kit-hides-link"] [data-skin-part="nav-link"]{display:none}',
    visual: ["kit-hidden"],
  },
  {
    id: "covers-link", what: "recouvre les liens du menu par un décor opaque (passe l'assainisseur)",
    build: withCss('[data-skin-part="nav-link"] { position: relative; }\n[data-skin-part="nav-link"]::after { content: ""; position: absolute; inset: 0; background: var(--v-bg); }\n'),
    static: [],
    visual: ["kit-covered"],
  },
  {
    id: "injects-text", what: "ajoute du texte avec content",
    build: withCss('[data-skin-part="heading"]::before { content: "Promo "; }\n'),
    static: ["content-not-allowed"],
    unsafeCss: ':root[data-skin="kit-injects-text"] [data-skin-part="heading"]::before{content:"Promo "}',
    visual: ["kit-injected-text"],
  },
  {
    id: "chaotic-tab-order", what: "ordre de tabulation chaotique (cartes et menu réordonnés)",
    build: withCss('[data-skin-part="nav-list"] { flex-direction: row-reverse; }\n[data-skin-part="list"][data-kind="cards"] > li:nth-child(3n) { order: -3; }\n[data-skin-part="list"][data-kind="cards"] > li:nth-child(2n) { order: 5; }\n[data-skin-part="list"][data-kind="cards"] { grid-auto-flow: row dense; }\n'),
    static: [],
    visual: ["kit-tab-order"],
  },
  {
    id: "tiny-targets", what: "cibles trop petites (menu et boutons à 1 rem)",
    build: withCss('[data-skin-part="nav-link"], [data-skin-part="button"], [data-skin-part="chip"] { min-height: 1rem; height: 1rem; padding-block: 0; line-height: 1rem; font-size: 0.8125rem; }\n'),
    static: [],
    visual: ["kit-target-size"],
  },
  {
    id: "no-focus", what: "indicateur de focus rendu invisible",
    build: withCss('[data-skin-part="nav-link"]:focus-visible, [data-skin-part="link"]:focus-visible, [data-skin-part="button"]:focus-visible, [data-skin-part="chip"]:focus-visible, [data-skin-part="brand"]:focus-visible, [data-skin-part="input"]:focus-visible, [data-skin-part="textarea"]:focus-visible { outline-color: transparent; box-shadow: none; }\n'),
    static: [],
    visual: ["kit-focus-missing"],
  },
  {
    id: "external-request", what: "appelle une adresse extérieure",
    build: withCss('[data-skin-region="main"] { background-image: url(https://example.invalid/fond.png); }\n'),
    static: ["url-external"],
    unsafeCss: 'body{background-image:url(https://example.invalid/fond.png)}',
    visual: ["kit-external-request"],
  },
  {
    id: "missing-font", what: "police déclarée dont le fichier n'est pas une police",
    build: (dir, id) => copySkin(BASE, dir, {
      id,
      patch: (m) => { m.assets = [{ file: "fonts/body.woff2", kind: "font", license: "OFL-1.1", licenseFile: "LICENSES/body-OFL.txt", author: "Auteur", source: "https://example.org/font", family: "Skin Body", weight: "400", style: "normal" }]; },
      files: {
        "fonts/body.woff2": fakeFont(400), "LICENSES/body-OFL.txt": "SIL Open Font License 1.1 (texte de démonstration)\n",
        "skin.css": '@font-face { font-family: "Skin Body"; src: url(skin:fonts/body.woff2) format("woff2"); font-weight: 400; font-style: normal; }\n',
        "tokens.json": JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, dark: {}, common: { "--v-font": '"Skin Body", Georgia, serif' }, modules: {} }),
      },
    }),
    static: [],
    visual: ["kit-font-not-loaded"],
  },
  {
    id: "horizontal-scroll", what: "la page déborde sur le côté",
    build: withCss('[data-skin-region="content"] { min-width: 44rem; }\n'),
    static: [],
    visual: ["kit-scroll-x"],
  },
  {
    id: "rendered-contrast", what: "texte lisible d'après les jetons mais posé sur un dégradé sombre (invisible aux jetons)",
    build: withCss('[data-skin-part="card"] { background-image: linear-gradient(120deg, #111, #333); }\n'),
    static: [],
    visual: ["kit-contrast-rendered"],
  },
];
