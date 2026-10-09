import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const C = await import("@/core/color");
const { THEME_PRESETS } = await import("@/core/palettes");

const src = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MIN = 4.5;

test("contraste WCAG : valeurs de référence", () => {
  assert.equal(C.contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(C.contrast("#ffffff", "#000000"), C.contrast("#000000", "#ffffff"), "symétrique");
  assert.equal(C.contrast("#777777", "#777777"), 1);
  assert.equal(C.contrast("#ffffff", "#e8a23b").toFixed(2), "2.17", "le blanc sur l'ambre de Nuit était illisible");
});

test("texte sur accent : le meilleur contraste, pour les 7 accents des palettes actuelles", () => {
  const accents = { Nuit: "#e8a23b", Océan: "#38bdf8", Forêt: "#4ade80", Rose: "#f472b6", Violet: "#a78bfa", Jour: "#2563eb", Papier: "#c2410c" };
  for (const [name, accent] of Object.entries(accents)) {
    const fg = C.textOn(accent);
    assert.ok(C.contrast(fg, accent) >= MIN, `${name} : ${fg} sur ${accent} = ${C.contrast(fg, accent).toFixed(2)}`);
    const other = fg === "#111111" ? "#ffffff" : "#111111";
    assert.ok(C.contrast(fg, accent) >= C.contrast(other, accent), `${name} : l'autre couleur n'est pas meilleure`);
  }
  // pas de changement surprenant pour les accents déjà bien gérés
  assert.equal(C.textOn("#4ade80"), "#111111");
  assert.equal(C.textOn("#2563eb"), "#ffffff");
  assert.equal(C.textOn("#c2410c"), "#ffffff");
  assert.equal(C.textOn("#ffffff"), "#111111");
  assert.equal(C.textOn("#000000"), "#ffffff");
});

test("texte sur accent : pur, déterministe, et le point d'équilibre est vers 0,18 de luminance", () => {
  for (const c of ["#e8a23b", "#808080", "#123456"]) assert.equal(C.textOn(c), C.textOn(c));
  assert.equal(C.textOn("#757575"), "#ffffff", "gris moyen sombre (luminance ~0,18) : blanc");
  assert.equal(C.textOn("#808080"), "#111111", "gris un peu plus clair : noir");
  for (let v = 0; v <= 255; v += 5) {
    const hex = "#" + v.toString(16).padStart(2, "0").repeat(3);
    // noir quasi pur ou blanc : au pire (gris moyen) ~4,3:1, jamais en dessous
    assert.ok(C.contrast(C.textOn(hex), hex) >= 4.3, `gris ${hex}`);
  }
});

test("chaque palette actuelle : texte, texte secondaire et texte sur accent sont lisibles", () => {
  for (const p of THEME_PRESETS.slice(0, 7)) {
    const t = C.buildTheme(p.background, p.accent, "sans");
    const ratio = (a, b) => C.contrast(a, b);
    assert.ok(ratio(t.fg, t.bg) >= 7, `${p.id} texte/fond`);
    assert.ok(ratio(t.fg, t.surface) >= 7, `${p.id} texte/surface`);
    assert.ok(ratio(t.muted, t.bg) >= MIN, `${p.id} muted/fond ${ratio(t.muted, t.bg).toFixed(2)}`);
    assert.ok(ratio(t.muted, t.surface) >= MIN, `${p.id} muted/surface ${ratio(t.muted, t.surface).toFixed(2)}`);
    assert.ok(ratio(t.accentFg, t.accent) >= MIN, `${p.id} texte sur accent`);
  }
});

test("texte secondaire : les palettes qui passaient déjà gardent le mélange d'origine (62 %), les autres sont éclaircies/assombries juste ce qu'il faut", () => {
  assert.equal(C.buildTheme("#121214", "#e8a23b", "sans").muted, C.mix("#121214", "#f4f4f5", 0.62));
  assert.equal(C.buildTheme("#0b1220", "#38bdf8", "sans").muted, C.mix("#0b1220", "#f4f4f5", 0.62));
  const jour = C.buildTheme("#fafafa", "#2563eb", "sans");
  assert.notEqual(jour.muted, C.mix("#fafafa", "#18181b", 0.62), "Jour échouait à 4,31 : ajusté");
  assert.ok(C.contrast(jour.muted, jour.bg) < 7, "reste un texte secondaire, pas du texte plein");
});

test("texte secondaire et états : lisibles sur n'importe quel fond choisi", () => {
  for (let v = 0; v <= 255; v += 15) {
    for (const hue of ["", "20", "0"]) {
      const h = (n) => Math.min(255, v + (n ? Number(n) : 0)).toString(16).padStart(2, "0");
      const bg = `#${h(hue)}${h("")}${h("")}`;
      const t = C.buildTheme(bg, "#ff0066", "sans");
      // sur un fond de luminosité moyenne, même le texte principal n'atteint pas 4,5 : rien à garantir
      if (C.contrast(t.fg, t.bg) < 5.5 || C.contrast(t.fg, t.surface) < 5.5) continue;
      for (const k of ["muted", "success", "warning", "danger"]) {
        for (const against of ["bg", "surface"]) {
          assert.ok(C.contrast(t[k], t[against]) >= MIN, `${k}/${against} sur ${bg} : ${C.contrast(t[k], t[against]).toFixed(2)}`);
        }
      }
    }
  }
});

test("couleurs d'état : jetons ajoutés à la fin, adaptés au mode, lisibles, texte dessus lisible, documentés", () => {
  const tokens = [...C.THEME_TOKENS];
  assert.deepEqual(tokens.slice(0, 7), ["accent", "accentFg", "bg", "surface", "fg", "muted", "line"], "l'existant ne bouge pas");
  assert.deepEqual(tokens.slice(7, 13), ["success", "successFg", "warning", "warningFg", "danger", "dangerFg"]);
  const docs = src("docs/MODULES.md");
  for (const t of tokens.slice(7, 13)) assert.ok(docs.includes(`\`${t}\``), `${t} documenté`);
  for (const v of ["--v-success", "--v-warning", "--v-danger"]) assert.ok(docs.includes(v), `${v} documenté`);

  const dark = C.buildTheme("#121214", "#e8a23b", "sans");
  const light = C.buildTheme("#fafafa", "#2563eb", "sans");
  assert.notEqual(dark.success, light.success, "adapté au mode");
  assert.ok(C.luminance(dark.danger) > C.luminance(light.danger), "plus clair sur fond sombre");
  for (const [name, th] of [["sombre", dark], ["clair", light], ["papier", C.buildTheme("#f5f0e6", "#c2410c", "sans")]]) {
    for (const k of ["success", "warning", "danger"]) {
      assert.match(th[k], /^#[0-9a-f]{6}$/);
      assert.ok(C.contrast(th[k], th.bg) >= MIN, `${name} ${k}/fond`);
      assert.ok(C.contrast(th[k], th.surface) >= MIN, `${name} ${k}/surface`);
      assert.ok(C.contrast(th[`${k}Fg`], th[k]) >= MIN, `${name} texte sur ${k}`);
    }
  }
  const css = C.themeCss(dark);
  for (const v of ["--v-success", "--v-success-fg", "--v-warning", "--v-warning-fg", "--v-danger", "--v-danger-fg"]) assert.ok(css.includes(v + ":"), v);
  assert.equal(C.themeRef("theme:danger"), "danger");
});

test("structure : plus de texte blanc ni de couleur d'état codée en dur sur le site", () => {
  const panel = src("src/components/site/Panel.tsx");
  const accentStyle = panel.match(/accent: "([^"]*)"/)[1];
  assert.ok(!/white|black/.test(accentStyle), "bouton sur fond d'accent : pas de blanc forcé");
  assert.match(accentStyle, /text-accent-fg/);
  assert.ok(!/light=\{/.test(panel), "plus de bouton « light » forcé par le ton accent");
  assert.match(panel, /tone === "accent" \? \(on === "veil" \? "bg-accent" : "bg-accent text-accent-fg"\)/, "texte du panneau = accent-fg");
  const blocks = src("src/components/site/Blocks.tsx");
  assert.ok(!/emerald|amber|text-white|text-black/.test(blocks.slice(blocks.indexOf("const TONES"), blocks.indexOf("};", blocks.indexOf("const TONES")))), "TONES : jetons du thème");
  assert.match(blocks, /success: "bg-success text-success-fg"/);
  assert.ok(!/red-500/.test(src("src/components/site/ModuleForm.tsx")));
  const css = src("src/app/globals.css");
  for (const k of ["success", "warning", "danger"]) assert.ok(css.includes(`--color-${k}-fg: var(--v-${k}-fg)`));
});
