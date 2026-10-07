import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const B = await import("@/core/background");
const { buildTheme } = await import("@/core/color");
const theme = buildTheme("#0b1416", "#1a9aa3", "sans");
const ok = (raw) => { const r = B.parseBackground(raw); assert.equal(r.ok, true, JSON.stringify(r)); return r.layers; };
const bad = (raw) => { const r = B.parseBackground(raw); assert.equal(r.ok, false, "devrait être refusé : " + JSON.stringify(raw)); return r.error; };

test("fond : un fond vide est valide (aucune couche) ; JSON ou liste ou { layers } acceptés", () => {
  assert.deepEqual(ok(""), []);
  assert.deepEqual(ok("   "), []);
  assert.deepEqual(ok(null), []);
  const layer = { type: "linear", angle: 90, stops: [{ color: "bg" }, { color: "accent" }] };
  assert.equal(ok([layer]).length, 1);
  assert.equal(ok({ layers: [layer] }).length, 1);
  assert.equal(ok(JSON.stringify([layer])).length, 1);
});

test("fond : chaque type de couche est validé et borné (valeurs hors limites ramenées, pas rejetées)", () => {
  const [lin, rad, dots, grid, spots, img] = ok([
    { type: "linear", angle: 999, stops: [{ color: "#112233", at: -5 }, { color: "accent", at: 500, a: 400 }] },
    { type: "radial", x: 500, y: -500, w: 1, h: 9999, stops: [{ color: "accent" }, { color: "bg" }] },
    { type: "dots", size: 99, gap: 1, opacity: 500, span: 0 },
    { type: "grid", gap: 1 },
    { type: "spots", count: 99, size: 1, seed: 0 },
    { type: "image", src: "/uploads/123e4567-e89b-12d3-a456-426614174000.png" },
  ]);
  assert.equal(lin.angle, 360);
  assert.deepEqual(lin.stops.map((s) => [s.at, s.a]), [[0, 100], [100, 100]]);
  assert.deepEqual([rad.x, rad.y, rad.w, rad.h], [120, -20, 10, 200]);
  assert.deepEqual([dots.size, dots.gap, dots.opacity, dots.span, dots.side], [12, 8, 100, 5, "full"]);
  assert.equal(grid.gap, 16);
  assert.deepEqual([spots.count, spots.size, spots.seed], [8, 30, 1]);
  assert.deepEqual([img.fit, img.position, img.opacity], ["cover", "center", 100]);
});

test("fond : les erreurs sont lisibles et précises", () => {
  assert.match(bad("pas du json"), /JSON invalide/);
  assert.match(bad({ foo: 1 }), /liste de couches/);
  assert.match(bad([{ type: "magie" }]), /couche 1\.type/);
  assert.match(bad([{ type: "linear", stops: [{ color: "accent" }] }]), /2 à 6 étapes/);
  assert.match(bad([{ type: "linear", stops: [{ color: "rouge" }, { color: "bg" }] }]), /couleur/);
  assert.match(bad([{ type: "dots", side: "diagonale" }]), /side/);
  assert.match(bad([{ type: "dots", size: "gros" }]), /nombre attendu/);
  assert.match(bad(Array.from({ length: 7 }, () => ({ type: "grid" }))), /6 couches au plus/);
  assert.match(bad("x".repeat(9000)), /trop longue/);
  assert.match(bad([42]), /objet attendu/);
});

test("fond : aucune injection — couleurs, images et champs inconnus ne peuvent pas introduire de CSS", () => {
  for (const src of ['/uploads/x.png"); background:url(//evil', "javascript:alert(1)", "http://non-securise.example/x.png", 'https://ok.example/a.png")', "https://ok.example/a b.png", "//evil.example/x.png", "/uploads/../../etc/passwd", "data:image/png;base64,AAAA"])
    assert.match(bad([{ type: "image", src }]), /src/, src);
  for (const color of ["red", "#12", "url(x)", "#ggg111", "accent; background:red", "rgb(1,2,3)", 5])
    bad([{ type: "dots", color }]);
  const css = B.backgroundCss(ok([{ type: "dots", color: "#ffffff", evil: "}body{display:none}", size: 2 }, { type: "image", src: "https://ok.example/a.png", position: "center" }]), theme);
  assert.ok(!css.includes("evil") && !css.includes("display:none"), css);
  assert.equal([...css.matchAll(/url\("([^"]*)"\)/g)].length, 1);
  assert.ok(!bad([{ type: "image", src: "https://ok.example/a.png", position: "10px 10px; x:y" }]).includes("undefined"));
});

test("fond : CSS produit — dégradé, points estompés sur un côté, grille, images, opacité, jetons du thème", () => {
  const css = B.backgroundCss(ok([
    { type: "linear", angle: 90, stops: [{ color: "bg", at: 20 }, { color: "accent", at: 100, a: 40 }] },
    { type: "dots", color: "#ffffff", size: 2, gap: 28, opacity: 85, side: "left", span: 40 },
    { type: "grid", color: "fg", gap: 48, side: "top", span: 80 },
    { type: "image", src: "/uploads/123e4567-e89b-12d3-a456-426614174000.webp", fit: "tile", opacity: 50 },
  ]), theme);
  assert.match(css, /^\.cbg\{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden\}/);
  assert.match(css, /\.cbg>i:nth-child\(1\)\{background-image:linear-gradient\(90deg,rgba\(11,20,22,1\) 20%,rgba\(26,154,163,0\.4\) 100%\);\}/);
  assert.match(css, /\.cbg>i:nth-child\(2\)\{opacity:0\.85;background-image:radial-gradient\(circle,rgba\(255,255,255,1\) 2px,transparent 2\.5px\);background-size:28px 28px;-webkit-mask-image:linear-gradient\(to right,#000 0%,transparent 40%\)/);
  assert.match(css, /nth-child\(3\).*linear-gradient\(rgba\(.*\) 1px,transparent 1px\),linear-gradient\(90deg.*mask-image:linear-gradient\(to bottom,#000 0%,transparent 80%\)/);
  assert.match(css, /nth-child\(4\)\{opacity:0\.5;background-image:url\("\/uploads\/[0-9a-f-]{36}\.webp"\);background-size:auto;background-position:center;background-repeat:repeat;\}/);
  assert.equal(B.backgroundCss([], theme), "");
});

test("fond : décalage de teinte sur une étape, et une couche « spots » réutilise le halo", () => {
  const plain = B.backgroundCss(ok([{ type: "radial", stops: [{ color: "#ff0000" }, { color: "#ff0000", hue: 120 }] }]), theme);
  assert.match(plain, /rgba\(255,0,0,1\) 0%,rgba\(0,255,0,1\) 100%/, "rouge décalé de 120° = vert");
  const spots = B.backgroundCss(ok([{ type: "spots", count: 3, seed: 5 }]), theme);
  assert.equal((spots.match(/radial-gradient/g) ?? []).length, 3);
  assert.equal(B.backgroundCss(ok([{ type: "spots", count: 3, seed: 5 }]), theme), spots, "déterministe");
});

test("fond : les préréglages sont valides, s'adaptent au thème, et l'image de fond passe sous les couches", () => {
  for (const [id, layers] of Object.entries(B.BACKGROUND_PRESETS)) {
    const again = B.parseBackground(layers);
    assert.equal(again.ok, true, id);
    assert.ok(B.backgroundCss(layers, theme).length > 40, id);
  }
  const other = buildTheme("#1c1020", "#d6336c", "sans");
  assert.notEqual(B.backgroundCss(B.BACKGROUND_PRESETS.dots, theme), B.backgroundCss(B.BACKGROUND_PRESETS.dots, other), "suit les couleurs du site");
  const img = "/uploads/123e4567-e89b-12d3-a456-426614174000.jpg";
  const layers = B.effectiveLayers("dots", "", img);
  assert.equal(layers[0].type, "image");
  assert.equal(layers.length, B.BACKGROUND_PRESETS.dots.length + 1);
  assert.deepEqual(B.effectiveLayers("none", "ignoré", null), []);
  assert.deepEqual(B.effectiveLayers("custom", "n'importe quoi", null), [], "description invalide : pas de fond plutôt qu'un fond cassé");
  assert.equal(B.effectiveLayers("custom", '[{"type":"grid"}]', null).length, 1);
  assert.equal(B.isPreset("custom") && B.isPreset("dots") && !B.isPreset("inconnu"), true);
});

test("fond : branché sur le site et l'admin (préréglage en tous modes, description et « personnalisé » en avancé, validation avant enregistrement)", () => {
  const layout = fs.readFileSync("src/app/(site)/layout.tsx", "utf8");
  assert.match(layout, /effectiveLayers\(localized\.bg\.preset, localized\.bg\.custom, localized\.bg\.image\)/);
  assert.match(layout, /className="cbg" aria-hidden="true"/);
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  for (const n of ["bgPreset", "bgImage", "bgCustom"]) assert.match(page, new RegExp(`name="${n}"`));
  assert.match(page, /advanced \? \[\{ value: "custom"/);
  assert.ok(/\{advanced && \(\s*<TextArea name="bgCustom"/.test(page), "la description JSON n'est offerte qu'en mode avancé");
  const actions = fs.readFileSync("src/app/admin/(panel)/settings/actions.ts", "utf8");
  assert.match(actions, /parseBackground\(bgCustom\)/);
  assert.match(actions, /isBackgroundImage\(bgImage\)/);
  assert.match(actions, /adv \|\| bgPreset !== "custom"/);
  assert.ok(fs.existsSync("docs/BACKGROUND.md"));
});
