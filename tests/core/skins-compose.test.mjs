// Composition des couches (docs/SKINS.md §1, §3, §4.3) : basic identique à l'ancien rendu, priorités, repli valeur par valeur, retouches, modes, feuille.
import test from "node:test";
import assert from "node:assert/strict";

const { composeSkin } = await import("@/core/skins/compose");
const { renderSheet } = await import("@/core/skins/sheet");
const { retouchesFrom, RETOUCH_KEYS } = await import("@/core/skins/retouch");
const { BASIC } = await import("@/core/skins/basic");
const { NO_RETOUCHES } = await import("@/core/skins/types");
const C = await import("@/core/color");
const { backgroundCss, backgroundRules, BACKGROUND_BASE_CSS, effectiveLayers } = await import("@/core/background");
const { glowCss } = await import("@/core/glow");

const skin = (over = {}) => ({
  id: "test-duo", version: "1.0.0", name: { fr: "Test", en: "Test" }, modes: ["light", "dark"], css: "", defaults: {}, options: [], deriveFromBackground: false, colorScheme: true,
  tokens: {
    light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" },
    dark: { "--v-bg": "#0b0b10", "--v-surface": "#15151f", "--v-fg": "#f5f5ff", "--v-accent": "#ff4fd8" },
    common: { "--sk-radius-card": "0.5rem", "--sk-page-width": "46rem", "--v-font": 'Georgia, "Times New Roman", serif' },
  },
  ...over,
});
const retouch = (single = {}, extra = {}) => ({ ...NO_RETOUCHES, single, ...extra });
const decls = (block) => Object.fromEntries(block.split(";").filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]));
const rule = (css, selector) => {
  const i = css.indexOf(`${selector}{`);
  assert.ok(i >= 0, `règle ${selector} absente de : ${css.slice(0, 300)}`);
  return css.slice(i + selector.length + 1, css.indexOf("}", i));
};

// ── basic : EXACTEMENT l'ancien rendu ─────────────────────────────────────────────────────────────────────────────────
function lcg(seed) { let a = seed; return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296); }
const HEXES = ["#121214", "#e8a23b", "#fafaf7", "#ffffff", "#000000", "#808080", "#1d4ed8", "#ff4fd8", "#102a43", "#5fd3cc", "#E8A23B", "#f4f4f5", "#7f7f7f", "#0b3d2e", "#fff3d1"];

test("basic : pour 400 combinaisons de retouches, la palette, le thème et la feuille sont ceux d'avant les skins", () => {
  const rnd = lcg(42);
  const pick = () => HEXES[Math.floor(rnd() * HEXES.length)];
  for (let n = 0; n < 400; n++) {
    const r = {};
    for (const f of ["background", "accent", "accent2", "surface", "text"]) if (rnd() < 0.5) r[f] = f === "background" || f === "accent" ? pick() : pick().toLowerCase();
    const font = rnd() < 0.4 ? ["sans", "serif", "mono"][Math.floor(rnd() * 3)] : undefined;
    const composed = composeSkin({ retouches: { ...retouch(r), ...(font ? { font } : {}) } });
    // l'ancien calcul de la mise en page : buildTheme(fond, accent, police, choix facultatifs) avec les défauts de settings.ts
    const old = C.buildTheme(r.background ?? "#121214", r.accent ?? "#e8a23b", font ?? "sans", { accent2: r.accent2 ?? "", surface: r.surface ?? "", text: r.text ?? "" });
    assert.equal(composed.modes.length, 1);
    const m = composed.modes[0];
    assert.deepEqual(m.theme, old, JSON.stringify([r, font]));
    // la feuille : mêmes déclarations que themeCss, et le dégradé en deux temps
    const sheet = renderSheet(composed);
    const oldCss = C.themeCss(old);
    const oldRoot = decls(oldCss.slice(oldCss.indexOf(":root{") + 6, oldCss.indexOf("}")));
    const newRoot = decls(rule(sheet, ':root[data-skin="basic"]'));
    for (const [k, v] of Object.entries(oldRoot)) assert.equal(newRoot[k], v, `${k} ${JSON.stringify(r)}`);
    const up = oldCss.includes("@supports");
    assert.equal(sheet.includes("@supports (background-image:linear-gradient(in oklch,#000,#fff)){:root[data-skin=\"basic\"]{--v-gradient:"), up);
    if (up) assert.ok(sheet.includes(`--v-gradient:${old.gradient}}`));
    // accent secondaire / cartes choisies : les attributs d'avant (hasAccent2, hasChosenSurface)
    assert.equal(composed.hasAccent2, C.hasAccent2({ accent: r.accent ?? "#e8a23b", accent2: r.accent2 ?? "" }), JSON.stringify(r));
    assert.equal(composed.hasChosenSurface, C.hasChosenSurface({ surface: r.surface ?? "" }));
    // texte sur le dégradé : l'ancienne règle `[data-accent2]{--c-grad-fg:…}`
    if (composed.hasAccent2) assert.equal(newRoot["--c-grad-fg"], C.gradientTextOn(r.accent ?? "#e8a23b", r.accent2), "texte sur dégradé");
    else assert.equal(newRoot["--c-grad-fg"], undefined);
    assert.equal(composed.switchAvailable, false, "basic n'a qu'un mode : pas de bascule");
    assert.ok(!sheet.includes("color-scheme"), "basic ne pose pas color-scheme");
    assert.deepEqual(composed.issues, []);
    assert.equal(composed.skinId, "basic");
  }
});

test("basic sans aucune retouche : les valeurs de tokens.json sont ce que la feuille écrit", () => {
  const sheet = renderSheet(composeSkin({}));
  const root = decls(rule(sheet, ':root[data-skin="basic"]'));
  const expected = { ...BASIC.tokens.dark, ...BASIC.tokens.common };
  for (const [k, v] of Object.entries(expected)) {
    if (k === "--v-gradient") continue;
    // accent2 : la feuille écrit la couleur effective, pas la référence
    assert.equal(root[k], k === "--v-accent2" ? "#e8a23b" : v, k);
  }
  assert.equal(root["--v-gradient"], "linear-gradient(120deg, #e8a23b, #e8a23b)");
  assert.ok(!sheet.includes("@supports"), "accent = accent2 : pas de dégradé OKLCH");
});

test("basic : le halo et le fond sont exactement ceux d'avant (même texte)", () => {
  const layers = effectiveLayers("dusk", "", null, undefined);
  const composed = composeSkin({ retouches: retouch({ background: "#102a43", accent: "#5fd3cc" }) });
  const theme = composed.modes[0].theme;
  const glow = { level: "strong", custom: { count: 2, size: 60, variance: 20, hue: 0, intensity: 14, seed: 7, color: "" } };
  const sheet = renderSheet(composed, {
    glow: (t, scope) => glowCss("strong", glow.custom, t.accent, scope),
    background: (t, scope) => backgroundRules(layers, t, scope), backgroundBase: BACKGROUND_BASE_CSS,
  });
  assert.ok(sheet.includes(glowCss("strong", glow.custom, "#5fd3cc")), "halo identique");
  assert.ok(sheet.includes(backgroundCss(layers, theme)), "fond identique");
  assert.equal(backgroundCss(layers, theme), BACKGROUND_BASE_CSS + backgroundRules(layers, theme));
});

// ── skin actif ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("skin à deux modes : les deux modes, la bascule, les jetons de chaque mode, color-scheme", () => {
  const c = composeSkin({ skin: skin() });
  assert.equal(c.skinId, "test-duo");
  assert.equal(c.switchAvailable, true);
  assert.deepEqual(c.modes.map((m) => m.mode), ["light", "dark"]);
  const [light, dark] = c.modes;
  assert.equal(light.tokens["--v-bg"], "#fafaf7");
  assert.equal(dark.tokens["--v-bg"], "#0b0b10");
  assert.equal(light.tokens["--sk-radius-card"], "0.5rem");
  assert.equal(dark.tokens["--sk-radius-card"], "0.5rem");
  assert.equal(light.tokens["--sk-radius-xl"], ".75rem", "repli sur basic pour tout ce que le skin ne définit pas");
  assert.equal(light.darkBackground, false);
  assert.equal(dark.darkBackground, true);
  assert.equal(light.tokens["--v-muted"] !== undefined, true, "couleurs dérivées calculées");
  assert.equal(c.colorScheme, true);
});

test("feuille à deux modes : clair par défaut, sombre sur demande de l'appareil (sauf choix « clair ») et sur choix « sombre »", () => {
  const sheet = renderSheet(composeSkin({ skin: skin() }));
  const sel = ':root[data-skin="test-duo"]';
  const light = decls(rule(sheet, sel));
  assert.equal(light["--v-bg"], "#fafaf7");
  assert.equal(light["color-scheme"], "light");
  assert.equal(light["--sk-radius-card"], "0.5rem", "valeur commune écrite une fois");
  const auto = rule(sheet, `@media (prefers-color-scheme:dark){${sel}:not([data-mode="light"])`);
  assert.equal(decls(auto)["--v-bg"], "#0b0b10");
  assert.equal(decls(auto)["color-scheme"], "dark");
  assert.equal(decls(auto)["--sk-radius-card"], undefined, "seul ce qui change est répété");
  const manual = decls(rule(sheet, `${sel}[data-mode="dark"]`));
  assert.equal(manual["--v-bg"], "#0b0b10");
  assert.equal(manual["color-scheme"], "dark");
  assert.ok(sheet.indexOf(sel + "{") < sheet.indexOf("@media (prefers-color-scheme:dark)"));
  // jamais d'URL, de script ni d'import dans la feuille de jetons
  assert.ok(!/url\(|@import|<|javascript:/i.test(sheet));
});

test("skin à un seul mode : il est imposé (color-scheme du mode), aucune bascule", () => {
  const c = composeSkin({ skin: skin({ modes: ["light"], tokens: { light: skin().tokens.light, common: {} } }) });
  assert.equal(c.switchAvailable, false);
  assert.deepEqual(c.modes.map((m) => m.mode), ["light"]);
  const sheet = renderSheet(c);
  assert.equal(decls(rule(sheet, ':root[data-skin="test-duo"]'))["color-scheme"], "light");
  assert.ok(!sheet.includes("prefers-color-scheme"), "pas de mode automatique");
});

test("repli valeur par valeur : jeton refusé, inconnu ou absent = valeur de basic ; couleurs de base manquantes = basic", () => {
  const c = composeSkin({ skin: skin({ tokens: { dark: {}, light: {}, common: { "--sk-text-sm": "0.4rem", "--sk-radius-card": "red", "--sk-inconnu": "1px", "--sk-duration": "9s", "--sk-radius-lg": "0.2rem" } } }), retouches: NO_RETOUCHES });
  const t = c.modes[0].tokens;
  assert.equal(t["--sk-text-sm"], ".875rem", "taille de texte trop petite : refusée, valeur de basic");
  assert.equal(t["--sk-radius-card"], "var(--sk-radius-xl)", "valeur invalide : basic");
  assert.equal(t["--sk-duration"], "150ms");
  assert.equal(t["--sk-radius-lg"], "0.2rem", "valeur valable : appliquée");
  assert.equal(t["--sk-inconnu"], undefined, "jeton inconnu ignoré");
  assert.ok(c.issues.some((i) => i.severity === "warning"), "un refus est signalé");
  assert.equal(c.issues.filter((i) => i.severity === "error").length, 0, "jamais d'erreur bloquante au rendu");
});

test("une référence var() dont la valeur finale est trop petite retombe sur basic", () => {
  const c = composeSkin({ skin: skin({ tokens: { common: { "--sk-text-xs": "var(--sk-text-tiny)", "--sk-text-sm": "var(--sk-radius-sm)" } } }) });
  // --sk-radius-sm vaut .25rem : une taille de texte de .25rem est refusée ; basic reprend
  assert.equal(c.modes[0].tokens["--sk-text-sm"], ".875rem");
  assert.equal(c.modes[0].tokens["--sk-text-xs"], ".75rem", "référence vers un jeton inconnu : valeur de basic");
});

test("pièces de modules (couche 2) : valeurs par défaut sous le skin, jetons du skin pour un module absent ignorés", () => {
  const moduleTokens = [{ name: "--sk-events-card-radius", type: "length", default: "var(--sk-radius-card)" }, { name: "--sk-events-card-bg", type: "color", default: "var(--v-surface)" }];
  const plain = composeSkin({ skin: skin(), moduleTokens });
  assert.equal(plain.modes[0].tokens["--sk-events-card-radius"], "var(--sk-radius-card)", "défaut du module (couche 2)");
  const styled = composeSkin({ skin: skin({ tokens: { ...skin().tokens, modules: { events: { "--sk-events-card-radius": "0", "--sk-events-inconnu": "1px" }, absent: { "--sk-absent-x-y": "1px" } } } }), moduleTokens });
  assert.equal(styled.modes[0].tokens["--sk-events-card-radius"], "0", "le skin surcharge le module");
  assert.equal(styled.modes[0].tokens["--sk-events-inconnu"], undefined);
  assert.equal(styled.modes[0].tokens["--sk-absent-x-y"], undefined, "module non installé : ignoré");
  const noModule = composeSkin({ skin: skin() });
  assert.equal(noModule.modes[0].tokens["--sk-events-card-radius"], undefined, "couche vide : rien");
});

test("options de skin : seulement des listes de jetons ; valeur par défaut, valeur choisie, valeur inconnue", () => {
  const options = [{ id: "density", label: { fr: "D", en: "D" }, default: "normal", values: [
    { id: "compact", label: { fr: "a", en: "a" }, tokens: { "--sk-space": "0.1875rem" } },
    { id: "normal", label: { fr: "b", en: "b" }, tokens: {} },
    { id: "airy", label: { fr: "c", en: "c" }, tokens: { "--sk-space": "0.3125rem", "--sk-text-sm": "0.1rem" } },
  ] }];
  assert.equal(composeSkin({ skin: skin({ options }) }).modes[0].tokens["--sk-space"], ".25rem");
  assert.equal(composeSkin({ skin: skin({ options }), options: { density: "airy" } }).modes[0].tokens["--sk-space"], "0.3125rem");
  assert.equal(composeSkin({ skin: skin({ options }), options: { density: "airy" } }).modes[0].tokens["--sk-text-sm"], ".875rem", "un jeton refusé dans une option reste refusé");
  assert.equal(composeSkin({ skin: skin({ options }), options: { density: "n-importe-quoi" } }).modes[0].tokens["--sk-space"], ".25rem", "valeur inconnue : défaut du skin");
});

// ── retouches ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("retouches : elles l'emportent sur le skin ; les couleurs dérivées qui en dépendent sont recalculées, les autres restent celles du skin", () => {
  const s = skin({ tokens: { ...skin().tokens, light: { ...skin().tokens.light, "--v-muted": "#4a4a52", "--v-line": "#d8d8d0" } } });
  const base = composeSkin({ skin: s }).modes[0].tokens;
  assert.equal(base["--v-muted"], "#4a4a52", "dérivée fixée par le skin : gardée");
  assert.equal(base["--v-line"], "#d8d8d0");
  const accentOnly = composeSkin({ skin: s, retouches: retouch({ accent: "#b91c1c" }) });
  // retouche d'un seul mode : le fond n'est pas retouché, donc les deux modes subsistent et l'accent va aux deux
  assert.equal(accentOnly.modes.length, 2);
  const light = accentOnly.modes[0].tokens;
  assert.equal(light["--v-accent"], "#b91c1c");
  assert.equal(light["--v-accent-fg"], C.textOn("#b91c1c"), "texte sur l'accent recalculé");
  assert.equal(light["--v-muted"], "#4a4a52", "le texte secondaire ne dépend pas de l'accent : celui du skin");
  const bgRetouched = composeSkin({ skin: s, retouches: retouch({ background: "#f0e6d2" }) });
  assert.deepEqual(bgRetouched.modes.map((m) => m.mode), ["light"], "un fond retouché rend le site mono-mode, celui que dit sa luminance");
  assert.equal(bgRetouched.switchAvailable, false);
  assert.equal(bgRetouched.modes[0].tokens["--v-bg"], "#f0e6d2");
  assert.equal(bgRetouched.modes[0].tokens["--v-line"], C.buildPalette("#f0e6d2", "#1d4ed8", { surface: "#ffffff", text: "#1b1b1f" })["--v-line"], "filet recalculé à partir du nouveau fond");
  assert.equal(bgRetouched.modes[0].tokens["--v-surface"], "#ffffff", "les couleurs non retouchées gardent la valeur du skin");
  const dark = composeSkin({ skin: s, retouches: retouch({ background: "#10101a" }) });
  assert.deepEqual(dark.modes.map((m) => m.mode), ["dark"], "fond sombre : mode sombre");
});

test("retouches « clair et sombre » : un jeu par mode ; une clé absente prend la valeur du skin pour ce mode", () => {
  const r = { ...NO_RETOUCHES, palette: "both", light: { accent: "#7c3aed" }, dark: { background: "#000000", text: "#ffffff" }, single: { background: "#ff0000", accent: "#00ff00" } };
  const c = composeSkin({ skin: skin(), retouches: r });
  assert.equal(c.switchAvailable, true);
  const [light, dark] = c.modes;
  assert.equal(light.tokens["--v-accent"], "#7c3aed");
  assert.equal(light.tokens["--v-bg"], "#fafaf7", "absent : valeur du skin");
  assert.equal(dark.tokens["--v-bg"], "#000000");
  assert.equal(dark.tokens["--v-fg"], "#ffffff");
  assert.equal(dark.tokens["--v-accent"], "#ff4fd8", "absent : valeur du skin pour le mode sombre");
  // les anciennes clés theme.* sont ignorées tant que « both » est actif
  assert.notEqual(light.tokens["--v-bg"], "#ff0000");
  // « both » sur basic ou sur un skin à un mode : sans effet (non proposé)
  assert.equal(composeSkin({ retouches: r }).skinId, "basic");
  assert.equal(composeSkin({ retouches: r }).modes.length, 1);
});

test("lisibilité : un skin illisible est corrigé au rendu (jamais bloquant) ; irrécupérable = basic pour ce mode ; basic et retouches de basic jamais touchés", () => {
  const pale = skin({ tokens: { light: { "--v-bg": "#ffffff", "--v-surface": "#ffffff", "--v-fg": "#cccccc", "--v-accent": "#1d4ed8" }, dark: skin().tokens.dark, common: {} } });
  const c = composeSkin({ skin: pale });
  const light = c.modes[0];
  assert.equal(light.suspended, false);
  assert.ok(light.changes.length > 0, "corrections consignées");
  assert.ok(C.contrast(light.tokens["--v-fg"], "#ffffff") >= 4.5, "texte rapproché du noir jusqu'au seuil");
  assert.ok(light.notice && light.notice.fr.length > 10 && light.notice.en.length > 10, "encadré pour la page Apparence");
  const hopeless = composeSkin({ skin: skin({ tokens: { light: { "--v-bg": "#808080", "--v-surface": "#808080", "--v-fg": "#808080", "--v-accent": "#808080" }, dark: skin().tokens.dark, common: {} } }) });
  assert.equal(hopeless.modes[0].suspended, true, "mode suspendu");
  assert.equal(hopeless.modes[0].tokens["--v-bg"], "#121214", "basic s'applique pour ce mode");
  assert.equal(hopeless.modes[1].suspended, false);
  // basic : exempté, même avec une retouche illisible (comme aujourd'hui)
  const ugly = composeSkin({ retouches: retouch({ background: "#ffffff", text: "#eeeeee" }) });
  assert.equal(ugly.modes[0].tokens["--v-fg"], "#eeeeee");
  assert.equal(ugly.modes[0].suspended, false);
  assert.equal(ugly.notices.length, 0);
});

test("skin à couleurs rgb()/oklch()/translucides : la composition ne casse pas et le thème est en « #rrggbb »", () => {
  const glass = skin({ modes: ["dark"], tokens: { dark: { "--v-bg": "oklch(0.2 0.02 270)", "--v-surface": "rgb(255 255 255 / 0.08)", "--v-fg": "rgb(245 245 255)", "--v-accent": "hsl(300 90% 70%)" }, common: {} } });
  const c = composeSkin({ skin: glass });
  const m = c.modes[0];
  assert.match(m.theme.bg, /^#[0-9a-f]{6}$/);
  assert.match(m.theme.surface, /^#[0-9a-f]{6}$/);
  assert.equal(m.tokens["--v-surface"], "rgb(255 255 255 / 0.08)", "la valeur du skin est gardée telle quelle dans la feuille");
  assert.equal(m.suspended, false);
});

test("accent secondaire d'un skin : attribut data-accent2 seulement s'il diffère de l'accent", () => {
  assert.equal(composeSkin({ skin: skin() }).hasAccent2, false);
  const s = skin({ tokens: { ...skin().tokens, light: { ...skin().tokens.light, "--v-accent2": "#d97706" } } });
  assert.equal(composeSkin({ skin: s }).hasAccent2, true);
  assert.equal(composeSkin({ skin: s }).modes[0].tokens["--c-grad-fg"] !== undefined, true);
});

test("la composition ne lève jamais : entrée absurde = basic", () => {
  assert.equal(composeSkin(undefined).skinId, "basic");
  assert.equal(composeSkin({ skin: { id: "x" } }).skinId, "basic");
  assert.equal(composeSkin({ skin: null, retouches: { palette: "both" } }).skinId, "basic");
});

test("la feuille du skin (déjà assainie) vient après les jetons ; le mode « sombre » du visiteur est ciblé par [data-mode]", () => {
  const css = ':root[data-skin="test-duo"] [data-skin-part="card"]{border-radius:0}';
  const sheet = renderSheet(composeSkin({ skin: skin({ css }) }));
  assert.ok(sheet.endsWith(css));
  assert.ok(sheet.indexOf('[data-mode="dark"]') < sheet.indexOf(css));
});

test("retouches : lecture des réglages (clés, casse, invalides ignorés), aucune migration", () => {
  const store = { "theme.background": "#102A43", "theme.accent": "#E8A23B", "theme.accent2": "#5FD3CC", "theme.surface": "nope", "theme.text": "", "theme.font": "serif", "theme.palette": "both", "theme.light.accent": "#7C3AED", "theme.dark.background": "#000000" };
  const r = retouchesFrom((k) => store[k]);
  assert.deepEqual(r.single, { background: "#102A43", accent: "#E8A23B", accent2: "#5fd3cc" }, "fond et accent gardent leur casse (comme avant) ; invalide/vide = pas de retouche");
  assert.equal(r.font, "serif");
  assert.equal(r.palette, "both");
  assert.deepEqual(r.light, { accent: "#7C3AED" }, "l'accent garde sa casse");
  assert.deepEqual(r.dark, { background: "#000000" });
  assert.deepEqual(retouchesFrom(() => undefined), { palette: "single", single: {}, light: {}, dark: {} }, "site existant sans aucune clé = aucune retouche");
  assert.ok(RETOUCH_KEYS.includes("theme.light.text") && RETOUCH_KEYS.includes("theme.palette") && RETOUCH_KEYS.includes("theme.font"));
});

test("--sk-gradient: flat : dégradé et texte du panneau unis, même avec un second accent et après une retouche ; absent, rien ne change", () => {
  const withGrad = (g) => skin({ tokens: { ...skin().tokens, common: { ...skin().tokens.common, "--sk-gradient": g }, dark: { ...skin().tokens.dark, "--v-accent2": "#ffd54a" } }, modes: ["dark"] });
  const flat = composeSkin({ skin: withGrad("flat") }).modes[0];
  assert.equal(flat.tokens["--v-gradient"], "linear-gradient(120deg, var(--v-accent), var(--v-accent))");
  assert.equal(flat.tokens["--c-grad-fg"], "var(--v-accent-fg)");
  const retouched = composeSkin({ skin: withGrad("flat"), retouches: retouch({ accent: "#d6336c", accent2: "#00a86b" }) }).modes[0];
  assert.equal(retouched.tokens["--v-gradient"], "linear-gradient(120deg, var(--v-accent), var(--v-accent))");
  const blend = composeSkin({ skin: withGrad("blend") }).modes[0];
  assert.match(blend.tokens["--v-gradient"], /#ffd54a/i);
  assert.notEqual(blend.tokens["--c-grad-fg"], "var(--v-accent-fg)");
  assert.equal(composeSkin({}).modes[0].tokens["--sk-gradient"], undefined);
  // deux couleurs dont aucun texte ne se lit sur tout le dégradé : le cœur passe seul au dégradé uni (la lisibilité d'abord)
  const clash = composeSkin({ skin: withGrad("blend"), retouches: retouch({ accent: "#ff00aa", accent2: "#00a86b" }) }).modes[0];
  assert.equal(clash.tokens["--v-gradient"], "linear-gradient(120deg, var(--v-accent), var(--v-accent))");
});
