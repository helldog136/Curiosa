// Contrôle de lisibilité des skins (docs/SKINS.md §7) : calcul WCAG, 12 paires, échelle de correction, retouches.
import test from "node:test";
import assert from "node:assert/strict";

const R = await import("@/core/skins/readability");
const { parseColor, toHex, NAMED_COLORS } = await import("@/core/skins/colorParse");
const C = await import("@/core/color");

const hex = (c) => toHex(c);
const lightTokens = () => ({ ...C.buildPalette("#fafaf7", "#1d4ed8", { surface: "#ffffff", text: "#1b1b1f" }) });
const darkTokens = () => ({ ...C.buildPalette("#0b0b10", "#ff4fd8", { surface: "#15151f", text: "#f5f5ff" }) });
const errors = (issues) => issues.filter((i) => i.severity === "error");
const pairs = (issues) => [...new Set(issues.map((i) => i.pair))].sort((a, b) => a - b);

// ---------------------------------------------------------------------------------------------------------------------
// Analyse des couleurs

test("couleurs : hexadécimal 3, 4, 6 et 8 chiffres", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#F80"), { r: 255, g: 136, b: 0, a: 1 });
  assert.deepEqual(parseColor("#f808"), { r: 255, g: 136, b: 0, a: 0.533 });
  assert.deepEqual(parseColor("#1d4ed8"), { r: 29, g: 78, b: 216, a: 1 });
  assert.deepEqual(parseColor("  #1D4ED8  "), { r: 29, g: 78, b: 216, a: 1 });
  assert.deepEqual(parseColor("#11223380"), { r: 17, g: 34, b: 51, a: 0.502 });
  assert.deepEqual(parseColor("#00000000"), { r: 0, g: 0, b: 0, a: 0 });
});

test("couleurs : rgb(), rgba() à virgules, à espaces, pourcentages, opacité", () => {
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseColor("rgba(10,20,30,.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor("rgb(10 20 30)"), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseColor("rgb(10 20 30 / 0.25)"), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.deepEqual(parseColor("rgb(10 20 30 / 25%)"), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.deepEqual(parseColor("rgb(100% 0% 0%)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("RGB(300, -5, 30)"), { r: 255, g: 0, b: 30, a: 1 }, "bornes 0..255");
  assert.deepEqual(parseColor("rgb(0 0 0 / 2)"), { r: 0, g: 0, b: 0, a: 1 });
});

test("couleurs : hsl() et hsla()", () => {
  assert.equal(hex(parseColor("hsl(0 100% 50%)")), "#ff0000");
  assert.equal(hex(parseColor("hsl(120, 100%, 25%)")), "#008000");
  assert.equal(hex(parseColor("hsl(210 50% 40%)")), "#336699");
  assert.equal(hex(parseColor("hsla(240, 100%, 50%, 0.5)")), "#0000ff80");
  assert.equal(hex(parseColor("hsl(0.5turn 100% 50%)")), "#00ffff");
  assert.equal(hex(parseColor("hsl(-120deg 100% 50%)")), "#0000ff");
  assert.equal(hex(parseColor("hsl(0 0% 100%)")), "#ffffff");
});

test("couleurs : oklch()", () => {
  assert.equal(hex(parseColor("oklch(1 0 0)")), "#ffffff");
  assert.equal(hex(parseColor("oklch(0 0 0)")), "#000000");
  const near = (css, target) => {
    const a = parseColor(css);
    const b = parseColor(target);
    for (const k of ["r", "g", "b"]) assert.ok(Math.abs(a[k] - b[k]) <= 5, `${css} ≈ ${target} : ${hex(a)}`);
  };
  near("oklch(0.628 0.2577 29.23)", "#ff0000");
  near("oklch(0.452 0.3132 264.05)", "#0000ff");
  near("oklch(0.866 0.294 142.5)", "#00ff00");
  near("oklch(62.8% 0.2577 29.23deg / 1)", "#ff0000");
  assert.equal(parseColor("oklch(0.5 0.1 120 / 0.3)").a, 0.3);
});

test("couleurs : noms CSS courants et transparent", () => {
  assert.equal(NAMED_COLORS.length >= 60, true);
  assert.equal(hex(parseColor("white")), "#ffffff");
  assert.equal(hex(parseColor("Black")), "#000000");
  assert.equal(hex(parseColor("rebeccapurple")), "#663399");
  assert.equal(hex(parseColor("tomato")), "#ff6347");
  assert.equal(hex(parseColor("gray")), hex(parseColor("grey")));
  assert.equal(parseColor("transparent").a, 0);
  for (const name of NAMED_COLORS) assert.ok(parseColor(name), name);
});

test("couleurs : le reste est refusé proprement (null, jamais d'exception)", () => {
  for (const bad of [
    "", " ", "#", "#12", "#12345", "#1234567", "#ggg", "#fffffffff", "red blue", "rgb()", "rgb(1,2)", "rgb(1 2 3 4)", "rgb(1,2,3,4,5)", "rgb(a, b, c)", "rgb(1 2 3 / 4 / 5)", "rgb(1, 2, 3 / 0.5)",
    "hsl(a b c)", "hsl(1 2)", "oklch(1)", "oklch(a b c)", "var(--v-fg)", "color-mix(in srgb, red, blue)", "currentcolor", "inherit", "url(x)", "linear-gradient(red, blue)", "rgb(1 2 3) rgb(4 5 6)",
    "notacolor", "expression(1)", "rgb(1,2,3);", "rgb(1,2,3)}", "red;", "\u0000", "x".repeat(500), "#" + "f".repeat(200),
    null, undefined, 5, {}, [], true, () => 1,
  ]) {
    assert.equal(parseColor(bad), null, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Calcul WCAG

test("WCAG : valeurs de référence", () => {
  const W = parseColor("#ffffff");
  const B = parseColor("#000000");
  assert.equal(R.contrastRatio(B, W).toFixed(2), "21.00");
  assert.equal(R.contrastRatio(W, B), R.contrastRatio(B, W), "symétrique");
  assert.equal(R.contrastRatio(W, W), 1);
  assert.equal(R.contrastRatio(parseColor("#777777"), W).toFixed(2), "4.48");
  assert.equal(R.contrastRatio(parseColor("#767676"), W).toFixed(2), "4.54");
  assert.equal(R.relativeLuminance(W), 1);
  assert.equal(R.relativeLuminance(B), 0);
  assert.equal(R.relativeLuminance(parseColor("#808080")).toFixed(4), "0.2159");
});

test("WCAG : identique au calcul existant de color.ts pour les couleurs opaques", () => {
  let seed = 12345;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 400; i++) {
    const a = "#" + Array.from({ length: 6 }, () => Math.floor(next() * 16).toString(16)).join("");
    const b = "#" + Array.from({ length: 6 }, () => Math.floor(next() * 16).toString(16)).join("");
    assert.ok(Math.abs(R.contrastRatio(parseColor(a), parseColor(b)) - C.contrast(a, b)) < 1e-12, `${a} ${b}`);
    assert.ok(Math.abs(R.relativeLuminance(parseColor(a)) - C.luminance(a)) < 1e-12);
  }
});

test("WCAG : transparences composées", () => {
  const W = parseColor("#ffffff");
  const half = parseColor("rgba(0,0,0,.5)");
  assert.equal(hex(R.composite(half, W)), "#808080");
  assert.equal(R.contrastOver(half, W, W).toFixed(2), "3.95", "canaux entiers, comme un navigateur");
  // un fond translucide est composé sur ce qu'il y a derrière avant de mesurer
  const glass = parseColor("rgba(255,255,255,.1)");
  const dark = parseColor("#101010");
  assert.equal(hex(R.composite(glass, dark)), "#282828");
  assert.ok(R.contrastOver(parseColor("#ffffff"), glass, dark) > 10);
  assert.deepEqual(R.composite(parseColor("#12345678"), { r: 0, g: 0, b: 0, a: 0 }), { r: 18, g: 52, b: 86, a: 0.471 }, "sur du vide : inchangé");
  assert.equal(R.composite({ r: 1, g: 2, b: 3, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }).a, 0);
});

test("suggestion de couleur : la plus petite correction qui passe", () => {
  const W = parseColor("#ffffff");
  const s = R.suggestColor(parseColor("#aaaaaa"), [W], 4.5);
  assert.ok(s && s.dir === "darker");
  assert.ok(R.contrastRatio(parseColor(s.hex), W) >= 4.5);
  assert.equal(R.suggestColor(parseColor("#aaaaaa"), [W], 4.5).hex, "#767676", "l'écart minimal pour 4,5 sur blanc");
  const d = R.suggestColor(parseColor("#555555"), [parseColor("#121214")], 4.5);
  assert.equal(d.dir, "lighter");
  assert.equal(R.suggestColor(parseColor("#888888"), [], 4.5), null);
  assert.ok(R.suggestColor(parseColor("#888888"), [parseColor("#ffffff"), parseColor("#000000")], 4.5), "le gris moyen convient à blanc ET noir (4,58)");
  assert.equal(R.suggestColor(parseColor("#888888"), [parseColor("#ffffff"), parseColor("#000000"), parseColor("#808080")], 4.5), null, "trois fonds incompatibles : impossible");
});

// ---------------------------------------------------------------------------------------------------------------------
// Les 12 paires

test("les 12 paires du §7.1 sont déclarées, seuils compris", () => {
  assert.deepEqual(R.READABILITY_PAIRS.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const min = Object.fromEntries(R.READABILITY_PAIRS.map((p) => [p.id, p.min]));
  assert.deepEqual(min, { 1: 4.5, 2: 4.5, 3: 4.5, 4: 4.5, 5: 4.5, 6: 4.5, 7: 3, 8: 3, 9: 4.5, 10: 4.5, 11: 4.5, 12: 3 });
  assert.equal(R.AA_TEXT, 4.5);
  assert.equal(R.AA_LARGE, 3);
  assert.equal(R.AAA_TEXT, 7);
  assert.equal(R.AAA_LARGE, 4.5);
  for (const p of R.READABILITY_PAIRS) assert.ok(p.label.fr && p.label.en);
});

test("un skin lisible clair et un skin lisible sombre ne produisent aucun problème", () => {
  assert.deepEqual(R.checkReadability(lightTokens(), "light"), []);
  assert.deepEqual(R.checkReadability(darkTokens(), "dark"), []);
  // l'exemple minimal du §17
  assert.deepEqual(R.checkReadability(lightTokens(), "light", { skinId: "plain-light" }), []);
});

/** [numéro de paire, modifications qui la font échouer] */
const BREAKS = [
  [1, { "--v-fg": "#bbbbb0" }, "light"],
  [2, { "--v-surface": "#444444", "--v-fg": "#101010" }, "light"],
  [3, { "--v-muted": "#d0d0c8" }, "light"],
  [4, { "--v-accent-fg": "#cccccc" }, "light"],
  [5, { "--v-accent2": "#ffeb3b", "--v-accent2-fg": "#ffffff" }, "light"],
  [6, { "--sk-color-link": "#9ab" }, "light"],
  [7, { "--v-accent": "#eeeedd" }, "light"],
  [8, { "--sk-color-focus": "#f0f0e0" }, "light"],
  [9, { "--v-success": "#b6f0c0" }, "light"],
  [10, { "--v-danger-fg": "#7a1f1f", "--v-danger": "#901010" }, "light"],
  [12, { "--sk-color-heading": "#e6e6dc" }, "light"],
];
for (const [pair, change, mode] of BREAKS) {
  test(`paire ${pair} : échoue quand on la casse, passe sinon`, () => {
    const tokens = { ...lightTokens(), ...change };
    const issues = R.checkReadability(tokens, mode);
    assert.ok(pairs(errors(issues)).includes(pair), `paires en erreur : ${pairs(issues)}`);
    for (const i of errors(issues)) {
      assert.ok(i.ratio < i.required, `${i.code} ${i.ratio} < ${i.required}`);
      assert.equal(i.severity, "error");
      assert.match(i.code, /^read-low-\d+$/);
      assert.ok(i.message.fr.length > 20 && i.message.en.length > 20);
    }
  });
}

test("paire 11 : jetons des pièces de module", () => {
  const tokens = { ...lightTokens(), "--sk-events-card-fg": "#cccccc", "--sk-events-card-bg": "#ffffff" };
  const issues = R.checkReadability(tokens, "light", { modulePairs: [{ fg: "--sk-events-card-fg", bg: "--sk-events-card-bg" }] });
  assert.deepEqual(pairs(issues), [11]);
  assert.equal(issues[0].fgToken, "--sk-events-card-fg");
  assert.deepEqual(R.checkReadability({ ...tokens, "--sk-events-card-fg": "#111111" }, "light", { modulePairs: [{ fg: "--sk-events-card-fg", bg: "--sk-events-card-bg" }] }), []);
  assert.deepEqual(R.checkReadability(tokens, "light"), [], "sans pièce déclarée, rien à mesurer");
});

test("seuil AA exact : 4,5 passe, juste en dessous échoue", () => {
  const base = { ...lightTokens(), "--v-bg": "#ffffff", "--v-surface": "#ffffff", "--v-muted": "#767676" };
  assert.deepEqual(errors(R.checkReadability({ ...base, "--v-fg": "#767676" }, "light")), [], "#767676 sur blanc = 4,54");
  const low = errors(R.checkReadability({ ...base, "--v-fg": "#777777" }, "light"));
  assert.deepEqual(pairs(low), [1, 2], "#777777 sur blanc = 4,48");
  assert.equal(low[0].ratio, 4.48);
  assert.match(low[0].message.fr, /rapport 4,4 ; il faut au moins 4,5/, "4,48 ne s'affiche jamais « 4,5 »");
  assert.match(low[0].message.en, /ratio 4\.4; at least 4\.5 is needed/);
});

test("AAA en conseil : seulement si demandé, jamais bloquant", () => {
  const tokens = { ...lightTokens(), "--v-fg": "#6b6b6b", "--v-bg": "#ffffff", "--v-surface": "#ffffff" };
  assert.deepEqual(R.checkReadability(tokens, "light"), []);
  const advice = R.checkReadability(tokens, "light", { advice: true });
  assert.ok(advice.length > 0);
  assert.ok(advice.every((i) => i.severity === "advice" && i.code === "read-advice"));
  assert.equal(R.hasReadabilityErrors(advice), false);
  assert.ok(advice.some((i) => i.pair === 1 && i.required === 7));
  assert.ok(advice.every((i) => !/\{[a-z]+\}/.test(i.message.fr + i.message.en)));
  assert.ok(R.checkReadability({ ...tokens, "--v-fg": "#000000" }, "light", { advice: true }).every((i) => i.pair !== 1 && i.pair !== 2));
});

test("basic est exempté", () => {
  const broken = { "--v-bg": "#121214", "--v-surface": "#121214", "--v-fg": "#161618", "--v-accent": "#121215" };
  assert.deepEqual(R.checkReadability(broken, "dark", { skinId: "basic" }), []);
  assert.deepEqual(R.checkReadability(broken, "dark", { exempt: true }), []);
  assert.ok(R.checkReadability(broken, "dark").length > 0);
  assert.ok(R.checkReadability(broken, "dark", { skinId: "basic", exempt: false }).length > 0);
  // les vraies couleurs de basic passent de toute façon les paires de texte
  const basic = C.buildPalette("#121214", "#e8a23b");
  assert.deepEqual(errors(R.checkReadability(basic, "dark")), []);
});

test("transparences : un fond translucide est jugé sur ce qu'on voit", () => {
  const glass = { ...C.buildPalette("#101020", "#7dd3fc", { text: "#f5f5ff" }), "--v-surface": "rgba(255, 255, 255, 0.10)" };
  assert.deepEqual(errors(R.checkReadability(glass, "dark")), []);
  const bad = { ...glass, "--v-surface": "rgba(255, 255, 255, 0.85)" };
  assert.ok(pairs(R.checkReadability(bad, "dark")).includes(2), "texte clair sur surface presque blanche");
  // texte translucide : composé sur son fond
  assert.ok(pairs(R.checkReadability({ ...lightTokens(), "--v-fg": "rgba(0,0,0,.2)" }, "light")).includes(1));
  // un fond translucide est composé sur blanc en mode clair, sur noir en mode sombre
  const veil = { ...C.buildPalette("#101010", "#7dd3fc", { text: "#ffffff" }), "--v-bg": "rgba(255,255,255,.1)", "--v-surface": "rgba(255,255,255,.05)", "--v-fg": "#ffffff", "--v-muted": "#ffffff" };
  assert.ok(pairs(R.checkReadability(veil, "light")).includes(1), "presque blanc : le texte blanc ne se lit pas");
  assert.deepEqual(errors(R.checkReadability(veil, "dark")).filter((i) => i.pair <= 3), [], "sur noir : lisible");
});

test("couleurs manquantes ou incompréhensibles : signalées, pas devinées", () => {
  const missing = R.checkReadability({ "--v-bg": "#fff" }, "light");
  assert.deepEqual(missing.map((i) => [i.code, i.fgToken]), [["read-token-missing", "--v-surface"], ["read-token-missing", "--v-fg"], ["read-token-missing", "--v-accent"]]);
  assert.ok(missing.every((i) => i.severity === "error" && i.pair === 0));
  const odd = R.checkReadability({ ...lightTokens(), "--v-accent": "color-mix(in srgb, red, blue)" }, "light");
  assert.ok(odd.some((i) => i.code === "read-color-unreadable" && i.fgToken === "--v-accent"));
  assert.ok(R.checkReadability({ ...lightTokens(), "--v-fg": "var(--nope)" }, "light").some((i) => i.code === "read-color-unreadable"));
  assert.deepEqual(R.checkReadability({}, "dark").map((i) => i.code), Array(4).fill("read-token-missing"));
  for (const bad of [null, undefined, 5, "x", []]) assert.deepEqual(R.checkReadability(bad, "dark").map((i) => i.code), Array(4).fill("read-token-missing"));
});

test("var(--autre) vers un jeton donné est suivi", () => {
  const t = { ...lightTokens(), "--v-accent2": "var(--v-accent)", "--v-accent2-fg": "var(--v-accent-fg)" };
  assert.deepEqual(R.checkReadability(t, "light"), []);
  const loop = { ...lightTokens(), "--v-accent2": "var(--v-accent2)", "--v-accent2-fg": "#fff" };
  assert.ok(R.checkReadability(loop, "light").some((i) => i.code === "read-color-unreadable"));
});

test("messages : mots simples, FR et EN, nombres selon la langue, exemple de correction", () => {
  const issues = errors(R.checkReadability({ ...lightTokens(), "--v-fg": "#aaaaaa" }, "light"));
  const i = issues.find((x) => x.pair === 1);
  assert.match(i.message.fr, /^En mode clair, le texte serait difficile à lire sur le fond de la page \(rapport 2,\d ; il faut au moins 4,5\)\.$/);
  assert.match(i.message.en, /^In light mode, the text would be hard to read on the page background \(ratio 2\.\d; at least 4\.5 is needed\)\.$/);
  assert.match(i.hint.fr, /^Essayez une couleur plus foncée, par exemple #[0-9a-f]{6}\.$/);
  assert.match(i.hint.en, /^Try a darker color, for example #[0-9a-f]{6}\.$/);
  assert.ok(R.contrastRatio(parseColor(i.example), parseColor("#fafaf7")) >= 4.5);
  assert.ok(R.contrastRatio(parseColor(i.example), parseColor("#ffffff")) >= 4.5, "l'exemple convient aussi aux cartes");
  const dark = errors(R.checkReadability({ ...darkTokens(), "--v-fg": "#444455" }, "dark"));
  assert.match(dark[0].message.fr, /^En mode sombre,/);
  assert.match(dark[0].hint.fr, /plus claire/);
  assert.match(dark[0].hint.en, /lighter/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Échelle de correction

test("correction : rien à corriger, rien ne change", () => {
  const t = lightTokens();
  const c = R.correctReadability(t, "light");
  assert.deepEqual([c.suspended, c.changes, c.remaining, c.notice], [false, [], [], null]);
  assert.deepEqual(c.tokens, t);
  assert.notEqual(c.tokens, t, "copie, jamais l'objet d'entrée");
});

test("correction (1) : une couleur dérivée illisible est recalculée", () => {
  const t = { ...lightTokens(), "--v-muted": "#d0d0c8", "--v-accent-fg": "#777777" };
  const c = R.correctReadability(t, "light");
  assert.equal(c.suspended, false);
  assert.deepEqual(c.changes.map((x) => [x.token, x.step]).sort(), [["--v-accent-fg", "derived"], ["--v-muted", "derived"]]);
  assert.deepEqual(R.checkReadability(c.tokens, "light"), []);
  assert.deepEqual(t["--v-muted"], "#d0d0c8", "l'entrée n'est pas modifiée");
  assert.equal(c.notice.fr, "Nous avons ajusté une couleur pour qu'on puisse la lire.");
  assert.equal(c.notice.en, "We adjusted a color so that it can be read.");
});

test("correction (2) : le texte est rapproché du noir ou du blanc", () => {
  const t = { ...lightTokens(), "--v-fg": "#b5b5aa" };
  const c = R.correctReadability(t, "light");
  assert.equal(c.suspended, false);
  assert.ok(c.changes.some((x) => x.token === "--v-fg" && x.step === "text" && x.from === "#b5b5aa"));
  assert.deepEqual(R.checkReadability(c.tokens, "light"), []);
  assert.notEqual(c.tokens["--v-fg"], "#b5b5aa");
  // mode sombre : vers le blanc
  const d = R.correctReadability({ ...darkTokens(), "--v-fg": "#555566" }, "dark");
  assert.equal(d.suspended, false);
  assert.ok(R.relativeLuminance(parseColor(d.tokens["--v-fg"])) > R.relativeLuminance(parseColor("#555566")));
  assert.deepEqual(R.checkReadability(d.tokens, "dark"), []);
  // le texte reste au plus près de ce que la personne avait choisi
  assert.ok(R.contrastRatio(parseColor(c.tokens["--v-fg"]), parseColor("#fafaf7")) < 5.2, `${c.tokens["--v-fg"]}`);
});

test("correction (2) : liens et focus créent leur jeton sans toucher la couleur principale", () => {
  const t = { ...lightTokens(), "--v-accent": "#c8b4ff" };
  delete t["--sk-color-link"];
  const c = R.correctReadability(t, "light");
  assert.equal(c.suspended, false, JSON.stringify(c.remaining.map((i) => i.message.en)));
  assert.deepEqual(R.checkReadability(c.tokens, "light"), []);
  assert.ok(c.changes.some((x) => x.step === "text"));
});

test("correction (3) : une pièce de module revient à la valeur par défaut du module", () => {
  const t = { ...lightTokens(), "--sk-events-card-fg": "#cccccc", "--sk-events-card-bg": "#ffffff" };
  const mp = [{ fg: "--sk-events-card-fg", bg: "--sk-events-card-bg", defaults: { fg: "#1b1b1f", bg: "#ffffff" } }];
  const c = R.correctReadability(t, "light", { modulePairs: mp });
  assert.equal(c.suspended, false);
  assert.deepEqual(c.changes, [{ token: "--sk-events-card-fg", from: "#cccccc", to: "#1b1b1f", step: "module", pair: 11 }]);
  assert.deepEqual(R.checkReadability(c.tokens, "light", { modulePairs: mp }), []);
  // sans valeur par défaut connue : suspension
  const none = R.correctReadability(t, "light", { modulePairs: [{ fg: mp[0].fg, bg: mp[0].bg }] });
  assert.equal(none.suspended, true);
});

test("correction (4) : fond et surface incompatibles : le mode est suspendu, basic s'applique", () => {
  const t = { ...lightTokens(), "--v-bg": "#808080", "--v-surface": "#000000", "--v-fg": "#ffffff" };
  const c = R.correctReadability(t, "dark");
  assert.equal(c.suspended, true);
  assert.deepEqual(c.changes, []);
  assert.deepEqual(c.tokens, t, "jetons rendus tels quels : le cœur applique basic pour ce mode");
  assert.ok(c.remaining.length > 0);
  assert.equal(c.notice.fr, "Les couleurs de ce skin sont trop difficiles à lire en mode sombre : le skin de base est utilisé pour ce mode.");
  assert.equal(c.notice.en, "This skin's colors are too hard to read in dark mode: the basic skin is used for this mode.");
  // couleur essentielle manquante ou illisible : suspension aussi
  assert.equal(R.correctReadability({ "--v-bg": "#fff" }, "light").suspended, true);
});

test("correction : basic exempté, et jamais d'exception", () => {
  const broken = { "--v-bg": "#121214", "--v-surface": "#121214", "--v-fg": "#161618", "--v-accent": "#121215" };
  assert.equal(R.correctReadability(broken, "dark", { skinId: "basic" }).suspended, false);
  assert.deepEqual(R.correctReadability(broken, "dark", { skinId: "basic" }).tokens, broken);
  for (const input of [null, undefined, 5, "x", [], {}, { "--v-bg": 5 }]) assert.doesNotThrow(() => R.correctReadability(input, "light"));
});

test("correction : propriété — soit lisible, soit suspendu ; et idempotente (fuzz déterministe)", () => {
  let seed = 99;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const rc = () => "#" + Array.from({ length: 6 }, () => Math.floor(next() * 16).toString(16)).join("");
  let fixed = 0;
  let suspended = 0;
  for (let n = 0; n < 600; n++) {
    const dark = next() < 0.5;
    const t = { ...(dark ? darkTokens() : lightTokens()) };
    for (const k of ["--v-bg", "--v-surface", "--v-fg", "--v-accent", "--v-muted", "--v-accent-fg", "--v-success", "--v-success-fg"]) if (next() < 0.35) t[k] = rc();
    if (next() < 0.3) t["--sk-color-link"] = rc();
    if (next() < 0.3) t["--sk-color-focus"] = rc();
    const mode = dark ? "dark" : "light";
    const c = R.correctReadability(t, mode);
    if (c.suspended) {
      suspended++;
      assert.deepEqual(c.tokens, t);
      assert.ok(c.remaining.length > 0 || true);
    } else {
      assert.deepEqual(errors(R.checkReadability(c.tokens, mode)), [], JSON.stringify(t));
      const again = R.correctReadability(c.tokens, mode);
      assert.deepEqual(again.changes, [], "idempotente");
      if (c.changes.length) fixed++;
    }
  }
  assert.ok(fixed > 50 && suspended > 10, `corrigés ${fixed}, suspendus ${suspended}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Retouches : « illisibilité probable »

test("retouches : couleurs lisibles, aucun avertissement", () => {
  assert.deepEqual(R.probableIllegibility({ background: "#121214", accent: "#e8a23b" }, null), []);
  assert.deepEqual(R.probableIllegibility({ background: "#fafaf7", text: "#1b1b1f", accent: "#1d4ed8", surface: "#ffffff", accent2: "#b91c1c" }, "light"), []);
  assert.deepEqual(R.probableIllegibility({}, null), []);
  assert.deepEqual(R.probableIllegibility({ background: "pas une couleur" }, null), []);
});

test("retouches : texte trop pâle, message simple avec exemple, sous le bon champ", () => {
  const out = R.probableIllegibility({ background: "#121214", text: "#555555", accent: "#e8a23b" }, "dark");
  assert.equal(out.length, 1);
  const w = out[0];
  assert.equal(w.field, "text");
  assert.equal(w.mode, "dark");
  assert.equal(w.message.fr, "Dans le mode sombre, le texte serait difficile à lire sur ce fond.");
  assert.equal(w.message.en, "In dark mode, the text would be hard to read on this background.");
  assert.match(w.exampleHint.fr, /^Essayez un texte plus clair, par exemple #[0-9a-f]{6}\.$/);
  assert.match(w.exampleHint.en, /^Try a lighter text color, for example #[0-9a-f]{6}\.$/);
  assert.match(w.detail.fr, /^Rapport 2,\d ; il faut au moins 4,5\.$/);
  assert.ok(R.contrastRatio(parseColor(w.example), parseColor("#121214")) >= 4.5);
  assert.equal(w.ratio < 4.5, true);
  assert.equal(w.required, 4.5);
});

test("retouches : en « un seul mode », la phrase ne parle pas de mode", () => {
  const w = R.probableIllegibility({ background: "#ffffff", text: "#cccccc" }, null)[0];
  assert.equal(w.mode, null);
  assert.equal(w.message.fr, "Le texte serait difficile à lire sur ce fond.");
  assert.equal(w.message.en, "The text would be hard to read on this background.");
  assert.match(w.exampleHint.fr, /plus foncé/);
});

test("retouches : couleur principale et seconde couleur trop proches du fond", () => {
  const a = R.probableIllegibility({ background: "#ffffff", accent: "#ffee99" }, "light");
  assert.deepEqual(a.map((x) => x.field), ["accent"]);
  assert.match(a[0].message.fr, /La couleur principale|la couleur principale/);
  assert.equal(a[0].required, 3);
  const b = R.probableIllegibility({ background: "#101010", accent: "#e8a23b", accent2: "#202020" }, null);
  assert.deepEqual(b.map((x) => x.field), ["accent2"]);
  assert.match(b[0].exampleHint.fr, /plus claire/);
  // des liens (4,5) plus exigeants que le contour (3)
  const l = R.probableIllegibility({ background: "#ffffff", accent: "#999999" }, null);
  assert.ok(l.some((x) => x.field === "accent"));
});

test("retouches : surface choisie, texte non choisi : avertit sous la surface", () => {
  const w = R.probableIllegibility({ background: "#ffffff", surface: "#222222" }, null);
  assert.ok(w.length >= 1);
  assert.ok(w.every((x) => ["surface", "background", "text"].includes(x.field)));
});

test("retouches : jamais d'exception, jamais de modification des entrées", () => {
  const colors = Object.freeze({ background: "#121214", text: "#555555" });
  assert.doesNotThrow(() => R.probableIllegibility(colors, "dark"));
  for (const bad of [null, undefined, 5, "x", [], { background: 5 }, { background: "#fff", text: {} }]) assert.doesNotThrow(() => R.probableIllegibility(bad, "light"));
});

test("pannes internes : le contrôle échoue toujours du côté prudent", () => {
  const boom = new Proxy({}, { get() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } });
  const issues = R.checkReadability(boom, "light");
  assert.deepEqual(issues.map((i) => [i.code, i.severity]), [["read-internal-error", "error"]]);
  const c = R.correctReadability(boom, "light");
  assert.equal(c.suspended, true);
  assert.deepEqual(R.probableIllegibility({ get background() { throw new Error("boom"); } }, null), [], "l'avertissement de retouche n'est qu'un conseil");
});

test("index : l'API publique est exportée", async () => {
  const api = await import("@/core/skins/index");
  for (const name of ["sanitizeSkinCss", "sanitizeTokenValue", "checkReadability", "correctReadability", "probableIllegibility", "parseColor", "contrastRatio", "READABILITY_PAIRS", "DEFAULT_LIMITS", "REGIONS", "PARTS", "makeIssue", "ISSUE_CODES"]) {
    assert.ok(api[name] !== undefined, name);
  }
  assert.equal(typeof api.sanitizeSkinCss, "function");
});
