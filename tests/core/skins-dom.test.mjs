// DOM stable du site public (docs/SKINS.md §9, lot S2) : les régions et pièces que le cœur émet sont EXACTEMENT celles que l'assainisseur sait cibler, la coquille
// garde l'ordre de lecture, le menu responsive vit dans la feuille du cœur (pas dans des classes), aucune structure ne dépend d'autre chose que ces attributs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const { PARTS, REGIONS } = await import("@/core/skins/allowlist");
const read = (p) => fs.readFileSync(p, "utf8");

/** Tous les fichiers du site public (composants + pages), hors administration. */
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx$/.test(e.name) ? [p] : [];
  });
}
const SITE = [...files("src/components/site"), ...files("src/app/(site)")];
const source = SITE.map((f) => [f, read(f)]);
const all = source.map(([, s]) => s).join("\n");

const emitted = (attr) => new Set([...all.matchAll(new RegExp(`${attr}="([a-z][a-z0-9.-]*)"`, "g"))].map((m) => m[1]));
// Les composants qui reçoivent le nom d'une pièce en propriété (`part="footer-link"`).
const partProps = new Set([...all.matchAll(/\bpart="([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));
const regions = emitted("data-skin-region");
const parts = new Set([...emitted("data-skin-part"), ...partProps]);

test("chaque région émise par le cœur est connue de l'allowlist, et chaque région de l'allowlist est émise", () => {
  for (const r of regions) assert.ok(REGIONS.includes(r), `région émise mais inconnue de l'assainisseur : ${r}`);
  for (const r of REGIONS) assert.ok(regions.has(r), `région de l'allowlist jamais émise : ${r}`);
});

test("chaque pièce émise par le cœur est connue de l'allowlist, et chaque pièce de l'allowlist est émise", () => {
  for (const p of parts) assert.ok(PARTS.includes(p), `pièce émise mais inconnue de l'assainisseur : ${p}`);
  for (const p of PARTS) assert.ok(parts.has(p), `pièce de l'allowlist jamais émise : ${p}`);
});

test("l'assainisseur accepte un sélecteur sur chaque région et chaque pièce du DOM (et refuse un nom inventé)", () => {
  const css = [...REGIONS.map((r) => `[data-skin-region="${r}"]{color:red}`), ...PARTS.map((p) => `[data-skin-part="${p}"]{color:red}`)].join("\n");
  const r = sanitizeSkinCss(css, { skinId: "dom-test" });
  assert.equal(r.ok, true, JSON.stringify(r.issues.map((i) => i.message.en)));
  assert.equal(sanitizeSkinCss('[data-skin-part="inconnue"]{color:red}', { skinId: "dom-test" }).ok, false);
  assert.equal(sanitizeSkinCss('[data-skin-region="aside"]{color:red}', { skinId: "dom-test" }).ok, false);
});

test("les états posés par le cœur sont des attributs que la liste blanche connaît", () => {
  const value = { "data-open": "true", "data-level": "2" };
  for (const a of ["data-open", "data-kind", "data-level", "data-tone", "data-size", "data-variant", "data-header-layout", "data-btn", "data-on"]) {
    const r = sanitizeSkinCss(`[data-skin-part="card"][${a}="${value[a] ?? "x1"}"]{color:red}`, { skinId: "dom-test" });
    assert.equal(r.ok, true, `${a} : ${JSON.stringify(r.issues.map((i) => i.message.en))}`);
  }
});

test("la coquille : bannière, en-tête, contenu, pied, dans cet ordre (ordre de lecture et de tabulation), tous dans `shell`", () => {
  const layout = read("src/app/(site)/layout.tsx");
  const at = (s) => { const i = layout.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('data-skin-region="shell"') < at('data-skin-region="banner"'));
  assert.ok(at('data-skin-region="banner"') < at("<Header "));
  assert.ok(at("<Header ") < at('data-skin-region="main"'));
  assert.ok(at('data-skin-region="main"') < at('data-skin-region="content"'));
  assert.ok(at('data-skin-region="content"') < at("<Footer "));
  assert.ok(at("<Footer ") < at("</div>\n        {config.statsEnabled"), "le pied est dans la coquille, le compteur de visites après");
  assert.ok(at('data-skin-part="skip-link"') < at('data-skin-region="shell"'), "le lien d'évitement est le premier élément focalisable");
  assert.match(layout, /<body[^>]*data-skin-root/);
  // le lien d'évitement mène bien à la région principale
  assert.match(layout, /href="#content"/);
  assert.match(layout, /<main id="content" data-skin-region="main">/);
});

test("l'en-tête : marque, menu, outils dans l'ordre du DOM pour chacune des quatre variantes", () => {
  const header = read("src/components/site/Header.tsx");
  for (const variant of ["twoRows", "centered", "minimal"]) assert.ok(header.includes(`case "${variant}"`), variant);
  // classic : la marque, puis le groupe {menu, outils}
  const classic = header.slice(header.indexOf("default:"));
  assert.ok(classic.indexOf("{brand}") < classic.indexOf("{menu}") && classic.indexOf("{menu}") < classic.indexOf('data-skin-region="tools"'));
  // centered : marque, menu, outils
  const centered = header.slice(header.indexOf('case "centered"'), header.indexOf('case "minimal"'));
  assert.ok(centered.indexOf("{brand}") < centered.indexOf("{menu}") && centered.indexOf("{menu}") < centered.indexOf('data-skin-region="tools"'));
  // la région, les pièces et l'attribut de variante sont sur <header>
  assert.match(header, /<header data-skin-region="header"/);
  assert.match(header, /data-header-layout=\{config\.header\.layout\}/);
  // la bascule clair/sombre est dans les outils (région `tools`), jamais en dehors
  for (const m of header.matchAll(/[^\n]*\{modeEl\}[^\n]*/g)) assert.match(m[0], /tools|langTools/, m[0]);
});

test("le menu responsive est dans la feuille du cœur : plus aucune classe `sm:` / `max-sm:` dans SiteNav, MenuToggle ni BrandLogos", () => {
  for (const f of ["SiteNav", "MenuToggle", "BrandLogos"]) {
    const s = read(`src/components/site/${f}.tsx`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.ok(!/["'`\s](max-)?sm:[a-z]/.test(s), `${f} contient encore une classe responsive`);
  }
  const nav = read("src/components/site/SiteNav.tsx");
  assert.match(nav, /data-open=\{panel \? "true" : "false"\}/);
  assert.match(nav, /data-open=\{isOpen \? "true" : "false"\}/);
  const css = read("src/app/globals.css");
  for (const needle of ['[data-skin-part="nav-list"]', '[data-skin-part="menu-toggle"]', '[data-skin-part="submenu"]', "@media (width < 40rem)", "@media (width >= 40rem)", '[data-open="false"]']) assert.ok(css.includes(needle), needle);
});

test("coquille de basic : display:block, largeurs et marges lues dans les jetons avec la valeur d'avant en repli", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\[data-skin-region="shell"\] \{ display: block;/);
  assert.match(css, /var\(--sk-shell-columns, minmax\(0, 1fr\)\)/);
  assert.match(css, /var\(--sk-page-width, 64rem\)/);
  assert.match(css, /var\(--sk-page-pad-x, 1rem\)/);
  assert.match(css, /var\(--sk-page-pad-y, 2\.5rem\)/);
  for (const f of ["layout.tsx"]) assert.ok(!/max-w-5xl/.test(read(`src/app/(site)/${f}`)), "plus de largeur en dur dans la mise en page");
  assert.ok(!/max-w-5xl/.test(read("src/components/site/Header.tsx")) && !/max-w-5xl/.test(read("src/components/site/Footer.tsx")));
});

test("aucune classe de skin : le DOM ne porte ni identifiant de skin ni attribut propre à un skin", () => {
  assert.ok(!/data-skin-id|data-skin-name|data-skin-variant/.test(all));
  // le seul endroit qui nomme le skin actif est <html data-skin=…>
  const named = [...all.matchAll(/data-skin=/g)];
  assert.equal(named.length, 1);
});

test("le texte et la structure ne dépendent jamais du skin : aucun composant du site public ne lit le skin actif", () => {
  for (const [f, s] of source) {
    if (f.endsWith("layout.tsx") || f.endsWith("privacy/page.tsx")) continue;
    assert.ok(!/resolveLook|activeSkin|skin\.active/.test(s), f);
  }
});
