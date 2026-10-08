import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { sanitizeSvg, MAX_SVG_BYTES } = await import("@/core/svg");
const B = await import("@/core/background");
const { buildTheme } = await import("@/core/color");
const theme = buildTheme("#0b1416", "#1a9aa3", "sans");

const wrap = (inner, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const ok = (svg, fit) => { const r = sanitizeSvg(svg, undefined, fit); assert.equal(r.ok, true, JSON.stringify(r)); return r.svg; };
const bad = (svg) => { const r = sanitizeSvg(svg); assert.equal(r.ok, false, "devrait être refusé : " + String(svg).slice(0, 80)); return r.error; };

test("svg : un dessin ordinaire (dégradé, motif de points, masque, silhouette) est accepté et ré-écrit proprement", () => {
  const out = ok(`<?xml version="1.0"?><!-- commentaire -->
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1920" height="1080" viewBox="0 0 1920 1080" style="background:red">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#031a1c"/><stop offset="100%" stop-color="#117d83"/></linearGradient>
        <pattern id="p" width="27" height="54" patternUnits="userSpaceOnUse"><circle cx="13.5" cy="13.5" r="3" fill="#ffffff"/><circle cx="0" cy="40.5" r="3" fill="#fff"/><circle cx="27" cy="40.5" r="3" fill="#fff"/></pattern>
        <mask id="m"><path d="M0 0H420L380 540L410 1080H0Z" fill="#fff"/></mask>
        <filter id="b"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <rect width="1920" height="1080" fill="url(#g)"/>
      <rect width="1920" height="1080" fill="url(#p)" mask="url(#m)" opacity=".9" transform="translate(0 0)"/>
    </svg>`);
  assert.match(out, /^<svg [^>]*viewBox="0 0 1920 1080"/);
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"') && out.includes('preserveAspectRatio="xMidYMid slice"'));
  assert.ok(!out.includes("width=\"1920\" height=\"1080\" viewBox") && !/<svg[^>]* width=/.test(out), "dimensions fixes retirées : le dessin remplit la page");
  assert.ok(!/<!--|<\?xml|style=|xlink/.test(out), out);
  assert.ok(out.includes('fill="url(#g)"') && out.includes('mask="url(#m)"'));
});

test("svg : l'aspect est fixé par le framework — remplir (slice), contenir (meet), motif (meet + taille)", () => {
  assert.match(ok(wrap("<rect width='1' height='1'/>"), "cover"), /preserveAspectRatio="xMidYMid slice"/);
  assert.match(ok(wrap("<rect width='1' height='1'/>"), "contain"), /preserveAspectRatio="xMidYMid meet"/);
  assert.match(ok(wrap("<rect width='1' height='1'/>"), "tile"), /preserveAspectRatio="xMidYMid meet"/);
  assert.match(bad('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'), /viewBox/);
  assert.match(bad(wrap("<rect/>", 'viewBox="a b c d"')), /viewBox invalide/);
});

test("svg : la mise en forme `style=\"…\"` d'Inkscape/Figma est convertie en attributs, propriété par propriété", () => {
  const out = ok(wrap('<rect width="10" height="10" style="fill:#ff0000;stroke:none;opacity:0.5"/>'));
  assert.match(out, /<rect [^>]*fill="#ff0000"[^>]*stroke="none"[^>]*opacity="0\.5"/);
  const dropped = ok(wrap('<rect width="1" height="1" style="background:url(http://evil.example/x);font:x"/>'));
  assert.ok(!dropped.includes("evil") && !dropped.includes("background"), "propriété inconnue : écartée, jamais recopiée");
  assert.match(bad(wrap('<rect style="fill:url(https://evil.example/x.svg)"/>')), /url\(#identifiant\)/);
});

test("svg : tout ce qui s'exécute ou sort du dessin est refusé, avec un message précis", () => {
  const cases = [
    [wrap('<script>alert(1)</script>'), /<script>/],
    [wrap('<style>@import url(http://evil.example/x.css)</style>'), /<style>/],
    [wrap('<foreignObject><div/></foreignObject>'), /foreignObject/],
    [wrap('<image href="http://evil.example/x.png"/>'), /<image>/],
    [wrap('<a href="javascript:alert(1)"><rect/></a>'), /<a>/],
    [wrap('<text x="0" y="0">bonjour</text>'), /<text>/],
    [wrap('<animate attributeName="x"/>'), /animate/],
    [wrap('<rect onload="alert(1)"/>'), /événement/],
    [wrap('<rect onclick="x()"/>'), /événement/],
    [wrap('<use href="http://evil.example/x.svg#a"/>'), /#identifiant|caractères spéciaux/],
    [wrap('<use xlink:href="data:image/svg+xml;base64,AAAA"/>'), /#identifiant|caractères spéciaux|non accept/],
    [wrap('<rect fill="url(http://evil.example/x)"/>'), /url\(#identifiant\)/],
    [wrap('<rect width="url(#a)"/>'), /url\(#identifiant\)/],
    [wrap('<rect fill="javascript:alert(1)"/>'), /non accept|couleur/],
    [wrap('<rect x="&#106;avascript:"/>'), /caractères spéciaux/],
    [wrap('<rect x="&amp;"/>'), /caractères spéciaux/],
    [wrap('<rect x=1/>'), /illisible/],
    [wrap('<rect bidule="1"/>'), /« bidule »/],
    [wrap('<unknown/>'), /inconnu/],
    ['<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap("<rect/>"), /DOCTYPE/],
    [wrap("<![CDATA[x]]>"), /CDATA|DOCTYPE/],
    [wrap("du texte libre"), /texte/],
    ['<svg viewBox="0 0 1 1"><svg viewBox="0 0 1 1"/></svg>', /imbriqué/],
    [wrap("<g><rect/></rect></g>"), /mal placée/],
    [wrap("<g><rect/>"), /mal placée|jamais fermée/],
    ["<rect/>", /commencer par <svg>/],
    ["", /vide/],
    ["pas du svg", /svg|balise|texte/],
    [wrap('<rect fill="expression(alert(1))"/>'), /non accept|couleur/],
    [wrap('<rect filter="url(#a) url(#b)"/>'), /url\(#identifiant\)/],
    [wrap('<rect stroke-width="1;background:url(x)"/>'), /caractères spéciaux/],
  ];
  for (const [svg, re] of cases) assert.match(bad(svg), re, svg.slice(0, 80));
});

test("svg : taille bornée (24 Ko, 1500 éléments) et sortie jamais issue d'un contenu non reconnu", () => {
  assert.match(bad(wrap(" ".repeat(MAX_SVG_BYTES))), /trop lourd/);
  assert.match(bad(wrap("<rect/>".repeat(1600))), /trop d'éléments/);
  const out = ok(wrap('<rect width="1" height="1" class="x" id="r1"/>'));
  assert.ok(!out.includes("class"), "classe ignorée");
  // ré-écriture : la sortie ne contient que des balises et attributs de la liste blanche
  assert.ok(/^(<\/?[A-Za-z][^<>]*>)+$/.test(out) && !/[<>]/.test(out.replace(/<[^<>]*>/g, "")));
});

test("svg : les jetons du thème {accent}, {bg}… suivent les couleurs du site", () => {
  const template = wrap('<rect width="1" height="1" fill="{accent}"/><circle r="1" fill="{bg}" stroke="{fg}"/>');
  const a = sanitizeSvg(template, { accent: "#1a9aa3", bg: "#0b1416", fg: "#ededee" });
  assert.equal(a.ok, true);
  assert.ok(a.svg.includes('fill="#1a9aa3"') && a.svg.includes('fill="#0b1416"') && a.svg.includes('stroke="#ededee"'));
  const b = sanitizeSvg(template, { accent: "#d6336c", bg: "#1c1020", fg: "#fafafa" });
  assert.ok(b.svg.includes('fill="#d6336c"') && !b.svg.includes("#1a9aa3"));
  assert.equal(sanitizeSvg(template).ok, true, "à la validation, un gris neutre remplace les jetons");
  assert.match(bad(wrap('<rect fill="{inconnu}"/>')), /caractères spéciaux|couleur/);
});

test("fond : une couche « svg » devient une image de fond (data URI), remplit, contient ou se répète, avec estompage facultatif", () => {
  const svg = wrap('<rect width="100" height="100" fill="{accent}"/>');
  const layers = (o) => { const r = B.parseBackground([{ type: "svg", svg, ...o }]); assert.equal(r.ok, true, JSON.stringify(r)); return r.layers; };
  const css = (o) => B.backgroundCss(layers(o), theme);
  const cover = css({});
  assert.match(cover, /background-image:url\("data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"\);background-size:100% 100%;background-position:center;background-repeat:no-repeat;/);
  const decoded = Buffer.from(/base64,([A-Za-z0-9+/=]+)"/.exec(cover)[1], "base64").toString();
  assert.ok(decoded.includes('fill="#1a9aa3"') && decoded.includes("slice"), decoded);
  assert.match(css({ fit: "tile", tile: 120 }), /background-size:120px auto;background-position:center;background-repeat:repeat;/);
  assert.match(css({ fit: "contain" }), /meet/.source ? /background-size:100% 100%/ : /x/);
  assert.match(css({ side: "left", span: 30, edge: "hard" }), /mask-image:linear-gradient\(to right,#000 30%,transparent 30%\)/);
  assert.match(B.parseBackground([{ type: "svg", svg: "<svg viewBox='0 0 1 1'><script/></svg>" }]).error, /couche 1\.svg : l'élément <script>/);
  assert.match(B.parseBackground([{ type: "svg", svg, fit: "zoom" }]).error, /fit/);
});

test("fond : préréglage « svg » — le dessin enregistré est utilisé, un dessin invalide donne simplement aucun fond", () => {
  const svg = wrap('<rect width="100" height="100" fill="{bg}"/>');
  assert.equal(B.isPreset("svg"), true);
  const layers = B.effectiveLayers("svg", "", null, { markup: svg, fit: "tile", tile: 80 });
  assert.deepEqual(layers.map((l) => [l.type, l.fit, l.tile]), [["svg", "tile", 80]]);
  assert.deepEqual(B.effectiveLayers("svg", "", null, { markup: "<svg><script/></svg>", fit: "cover", tile: 200 }), []);
  assert.deepEqual(B.effectiveLayers("svg", "", null), []);
  assert.equal(B.effectiveLayers("svg", "", "/uploads/123e4567-e89b-12d3-a456-426614174000.png", { markup: svg, fit: "cover", tile: 200 }).length, 2, "l'image de fond passe dessous");
});

test("admin : le dessin SVG se colle en mode avancé, est validé avant enregistrement, et n'apparaît que si « Dessin SVG » est choisi", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  assert.match(page, /<ShowWhen field="bgPreset" equals="svg" initial=\{config\.bg\.preset\}>/);
  assert.match(page, /name="bgSvg"/);
  assert.match(page, /name="bgSvgFit"/);
  const actions = fs.readFileSync("src/app/admin/(panel)/settings/actions.ts", "utf8");
  assert.match(actions, /sanitizeSvg\(bgSvg/);
  assert.match(actions, /bgPreset !== "svg"/, "le mode simple ne peut pas activer le préréglage svg");
});

test("svg : alignement du dessin quand la fenêtre n'a pas ses proportions (gauche, centre, droite)", () => {
  const d = wrap("<rect width='1' height='1'/>");
  const par = (align, fit = "cover") => /preserveAspectRatio="([^"]+)"/.exec(sanitizeSvg(d, undefined, fit, align).svg)[1];
  assert.equal(par("left"), "xMinYMid slice");
  assert.equal(par("center"), "xMidYMid slice");
  assert.equal(par("right"), "xMaxYMid slice");
  assert.equal(par("left", "contain"), "xMinYMid meet");
  assert.equal(B.parseBackground([{ type: "svg", svg: d, align: "left" }]).layers[0].align, "left");
  assert.match(B.parseBackground([{ type: "svg", svg: d, align: "haut" }]).error, /align/);
  const css = B.backgroundCss(B.parseBackground([{ type: "svg", svg: d, align: "left" }]).layers, theme);
  assert.ok(Buffer.from(/base64,([A-Za-z0-9+/=]+)"/.exec(css)[1], "base64").toString().includes("xMinYMid slice"));
});
