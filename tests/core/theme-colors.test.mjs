import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const C = await import("@/core/color");
const { THEME_PRESETS } = await import("@/core/palettes");
const { getSiteConfig, setSetting, themeExtraOf } = await import("@/core/settings");
const { adminThemeCss } = await import("@/core/adminTheme");
const { parseManifest } = await import("@/core/modules/manifest");

beforeEach(() => db.reset());
after(() => db.close());

const src = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// ─── Non-régression : sans surcharge, le thème est celui d'avant (réimplémenté ici de façon indépendante) ───

function legacyPalette(background, accent) {
  const bg = C.isHexColor(background) ? background : "#121214";
  const ac = C.isHexColor(accent) ? accent : "#e8a23b";
  const light = C.luminance(bg) > 0.4;
  const fg = light ? "#18181b" : "#f4f4f5";
  const surface = C.mix(bg, fg, 0.06);
  const muted = (() => { for (let p = 62; p <= 100; p++) { const c = C.mix(bg, fg, p / 100); if (C.contrast(c, bg) >= 4.5 && C.contrast(c, surface) >= 4.5) return c; } return fg; })();
  const reach = (color, against) => { for (let s = 0; s <= 100; s++) { const c = s === 0 ? color : C.mix(color, fg, s / 100); if (against.every((o) => C.contrast(c, o) >= 4.5)) return c; } return fg; };
  const states = light ? { success: "#15803d", warning: "#b45309", danger: "#b91c1c" } : { success: "#4ade80", warning: "#fbbf24", danger: "#f87171" };
  const out = { "--v-bg": bg, "--v-fg": fg, "--v-muted": muted, "--v-surface": surface, "--v-line": C.mix(bg, fg, 0.16), "--v-accent": ac, "--v-accent-fg": C.textOn(ac) };
  for (const [n, base] of Object.entries(states)) { const c = reach(base, [bg, surface]); out[`--v-${n}`] = c; out[`--v-${n}-fg`] = C.textOn(c); }
  return out;
}

function seeded(n) {
  let x = 123456789;
  const next = () => (x = (x * 1103515245 + 12345) & 0x7fffffff);
  const hex = () => "#" + [0, 1, 2].map(() => (next() >> 8 & 255).toString(16).padStart(2, "0")).join("");
  return Array.from({ length: n }, () => [hex(), hex()]);
}

const COUPLES = [...THEME_PRESETS.slice(0, 7).map((p) => [p.background, p.accent]), ["#ffffff", "#000000"], ["#000000", "#ffffff"], ["#808080", "#808080"], ...seeded(12)];

test("sans surcharge : mêmes variables qu'avant pour les 7 palettes d'origine et une douzaine de couples quelconques", () => {
  for (const [bg, ac] of COUPLES) {
    const legacy = legacyPalette(bg, ac);
    for (const palette of [C.buildPalette(bg, ac), C.buildPalette(bg, ac, {}), C.buildPalette(bg, ac, { accent2: "", surface: "", text: "" }), C.buildPalette(bg, ac, { accent2: null, surface: undefined, text: "pas une couleur" })]) {
      for (const [k, v] of Object.entries(legacy)) assert.equal(palette[k], v, `${bg}/${ac} ${k}`);
      assert.deepEqual(Object.keys(palette).slice(0, Object.keys(legacy).length), Object.keys(legacy), "l'ordre d'avant ne bouge pas");
      assert.equal(palette["--v-accent2"], palette["--v-accent"], "accent 2 = accent");
      assert.equal(palette["--v-accent2-fg"], palette["--v-accent-fg"]);
    }
  }
});

test("sans surcharge : le CSS commence exactement comme avant et le dégradé est une couleur unie", () => {
  for (const [bg, ac] of COUPLES) {
    const legacy = legacyPalette(bg, ac);
    const old = [["accent", "--v-accent"], ["accentFg", "--v-accent-fg"], ["bg", "--v-bg"], ["surface", "--v-surface"], ["fg", "--v-fg"], ["muted", "--v-muted"], ["line", "--v-line"],
      ["success", "--v-success"], ["successFg", "--v-success-fg"], ["warning", "--v-warning"], ["warningFg", "--v-warning-fg"], ["danger", "--v-danger"], ["dangerFg", "--v-danger-fg"]]
      .map(([, v]) => `${v}:${legacy[v]}`).join(";");
    const theme = C.buildTheme(bg, ac, "serif");
    const css = C.themeCss(theme);
    assert.ok(css.startsWith(`:root{${old};`), `${bg}/${ac}`);
    assert.ok(css.includes(`--v-gradient:linear-gradient(120deg, ${ac}, ${ac});`), "couleur unie");
    assert.ok(!css.includes("@supports") && !css.includes("oklch"), "rien à améliorer tant qu'il n'y a pas d'accent 2");
    assert.ok(css.endsWith(`--v-font:${C.FONT_STACKS.serif}}`));
  }
});

// ─── Nouveaux jetons ───

test("jetons ajoutés EN FIN de THEME_TOKENS, existants inchangés ; gradient n'est pas une couleur", () => {
  const t = [...C.THEME_TOKENS];
  assert.deepEqual(t.slice(0, 13), ["accent", "accentFg", "bg", "surface", "fg", "muted", "line", "success", "successFg", "warning", "warningFg", "danger", "dangerFg"]);
  assert.deepEqual(t.slice(13), ["accent2", "accent2Fg", "gradient"]);
  assert.deepEqual([...C.COLOR_TOKENS], t.slice(0, 15));
  assert.equal(C.themeRef("theme:accent2"), "accent2");
  assert.equal(C.themeRef("theme:accent2Fg"), "accent2Fg");
  assert.equal(C.themeRef("theme:gradient"), null, "un dégradé n'est pas une couleur de réglage");
  const field = (d) => ({ apiVersion: 2, version: "1.0.0", id: "demo", name: "Demo", settings: [{ key: "c", label: "C", type: "color", default: d }] });
  assert.ok(parseManifest(field("theme:accent2")).ok);
  assert.equal(parseManifest(field("theme:gradient")).ok, false);
});

test("accent2 choisi : accent2Fg lisible, dégradé OKLCH avec repli sRGB, surface et texte surchargés", () => {
  const theme = C.buildTheme("#121214", "#e8a23b", "sans", { accent2: "#7aa2ff", surface: "#1d1d21", text: "#f4f4f5" });
  assert.equal(theme.accent2, "#7aa2ff");
  assert.equal(theme.accent2Fg, C.textOn("#7aa2ff"));
  assert.ok(C.contrast(theme.accent2Fg, theme.accent2) >= 4.5);
  assert.equal(theme.gradient, "linear-gradient(120deg in oklch, #e8a23b, #7aa2ff)");
  assert.equal(theme.surface, "#1d1d21");
  assert.equal(theme.fg, "#f4f4f5");
  assert.equal(theme.muted, C.buildTheme("#121214", "#e8a23b", "sans", { surface: "#1d1d21" }).muted, "muted dérive du texte et de la surface choisis");
  const css = C.themeCss(theme);
  assert.ok(css.includes("--v-gradient:linear-gradient(120deg, #e8a23b, #7aa2ff);"), "repli sRGB sur :root");
  assert.ok(css.includes("@supports (background-image:linear-gradient(in oklch,#000,#fff)){:root{--v-gradient:linear-gradient(120deg in oklch, #e8a23b, #7aa2ff)}}"), "OKLCH pour les navigateurs qui le savent");
  assert.ok(css.includes("--v-accent2:#7aa2ff;--v-accent2-fg:"));
  assert.ok(!/[<>]/.test(css.replace(/@supports[^{]*\{/, "")), "rien d'injectable");
  const other = C.buildTheme("#fafafa", "#2563eb", "sans", { text: "#0b1b33" });
  assert.equal(other.fg, "#0b1b33");
  assert.equal(other.surface, C.mix("#fafafa", "#0b1b33", 0.06), "surface dérivée du texte choisi");
});

test("surcharges invalides ignorées, jamais injectées", () => {
  const bad = C.buildTheme("#121214", "#e8a23b", "sans", { accent2: "red;}", surface: "<x>", text: "#12" });
  const base = C.buildTheme("#121214", "#e8a23b", "sans");
  assert.deepEqual(bad, base);
});

test("avertissements de contraste : texte/fond 4,5, accents/fond 3, calcul pur", () => {
  assert.deepEqual(C.contrastIssues("#121214", "#e8a23b"), []);
  const text = C.contrastIssues("#121214", "#e8a23b", { text: "#2a2a30" });
  assert.deepEqual(text.map((i) => i.kind), ["text"]);
  assert.equal(text[0].min, 4.5);
  assert.ok(text[0].ratio < 4.5);
  assert.deepEqual(C.contrastIssues("#fafafa", "#fde68a").map((i) => i.kind), ["accent"]);
  assert.deepEqual(C.contrastIssues("#121214", "#e8a23b", { accent2: "#1a1a1e" }).map((i) => i.kind), ["accent2"]);
  assert.deepEqual(C.contrastIssues("#121214", "#e8a23b", { accent2: "pas une couleur" }), [], "accent 2 invalide : ignoré");
  for (const p of THEME_PRESETS) assert.deepEqual(C.contrastIssues(p.background, p.accent, { accent2: p.accent2, surface: p.surface, text: p.text }), [], p.id);
});

test("thème de l'admin : définit les nouveaux jetons avec ses propres valeurs", () => {
  const css = adminThemeCss();
  for (const v of ["--v-accent2:", "--v-accent2-fg:", "--v-gradient:"]) assert.ok(css.split(v).length >= 4, `${v} défini en clair et en sombre`);
});

test("globals.css : classes Tailwind et valeurs par défaut des nouveaux jetons", () => {
  const css = src("src/app/globals.css");
  for (const m of ["--color-accent2: var(--v-accent2)", "--color-accent2-fg: var(--v-accent2-fg)", "--v-accent2: var(--v-accent)", "--v-accent2-fg: var(--v-accent-fg)", "--v-gradient: linear-gradient("]) assert.ok(css.includes(m), m);
});

// ─── Contrastes WCAG de chaque palette ───

test("chaque palette (15) : texte, texte secondaire, accents, boutons et dégradé lisibles", () => {
  for (const p of THEME_PRESETS) {
    const t = C.buildTheme(p.background, p.accent, "sans", { accent2: p.accent2, surface: p.surface, text: p.text });
    const r = (a, b) => C.contrast(a, b);
    const at = (n, min, a, b) => assert.ok(r(a, b) >= min, `${p.id} ${n} : ${r(a, b).toFixed(2)} < ${min}`);
    assert.equal(t.surface, p.surface);
    assert.equal(t.fg, p.text);
    at("texte/fond", 7, t.fg, t.bg);
    at("texte/surface", 7, t.fg, t.surface);
    at("muted/fond", 4.5, t.muted, t.bg);
    at("muted/surface", 4.5, t.muted, t.surface);
    at("accent/fond", 3, t.accent, t.bg);
    at("accent2/fond", 3, t.accent2, t.bg);
    at("accent/surface", 3, t.accent, t.surface);
    at("accent2/surface", 3, t.accent2, t.surface);
    at("texte sur bouton", 4.5, t.accentFg, t.accent);
    at("texte sur accent 2", 4.5, t.accent2Fg, t.accent2);
    for (const k of ["success", "warning", "danger"]) { at(`${k}/fond`, 4.5, t[k], t.bg); at(`${k}/surface`, 4.5, t[k], t.surface); at(`texte sur ${k}`, 4.5, t[`${k}Fg`], t[k]); }
    assert.equal((C.luminance(p.background) > 0.4) ? "light" : "dark", p.mode, `${p.id} : mode annoncé = mode calculé`);
  }
});

// ─── Réglages ───

test("réglages : theme.accent2 / theme.surface / theme.text lus, vides si absents ou invalides", async () => {
  let c = await getSiteConfig();
  assert.deepEqual([c.accent2, c.surface, c.textColor], ["", "", ""]);
  assert.deepEqual(themeExtraOf(c), { accent2: "", surface: "", text: "" });
  await setSetting("theme.accent2", "#7AA2FF");
  await setSetting("theme.surface", "javascript:1");
  await setSetting("theme.text", 12);
  c = await getSiteConfig();
  assert.deepEqual([c.accent2, c.surface, c.textColor], ["#7aa2ff", "", ""]);
});

test("réglages : validation stricte, vide = dérivé (champ absent = on n'y touche pas)", () => {
  const form = (o) => ({ has: (k) => k in o, get: (k) => o[k] });
  assert.deepEqual(C.parseOptionalColors(form({})), {});
  assert.deepEqual(C.parseOptionalColors(form({ accent2: "", surface: "  ", text: "" })), { "theme.accent2": "", "theme.surface": "", "theme.text": "" });
  assert.deepEqual(C.parseOptionalColors(form({ accent2: " #7AA2FF ", surface: "#ffffff", text: "#000000" })), { "theme.accent2": "#7aa2ff", "theme.surface": "#ffffff", "theme.text": "#000000" });
  assert.deepEqual(C.parseOptionalColors(form({ text: "#000" })), null, "forme courte refusée");
  for (const bad of ["red", "#12345g", "#1234567", "rgb(0,0,0)", "#fff;}", "<x>", "javascript:1"]) {
    for (const f of ["accent2", "surface", "text"]) assert.equal(C.parseOptionalColors(form({ [f]: bad })), null, `${f}=${bad}`);
  }
  const actions = src("src/app/admin/(panel)/settings/actions.ts");
  assert.match(actions, /parseOptionalColors\(formData\)/);
  assert.match(actions, /if \(!optionalColors\) return \{ error/);
  assert.match(actions, /else await deleteSetting\(key\)/, "vide = réglage supprimé");
});

test("sauvegarde : les réglages de thème sont des lignes ordinaires de Setting, donc emportés tels quels", () => {
  const exp = src("src/core/backup/export.ts");
  assert.match(exp, /setting\.findMany\(/i);
});

// ─── i18n et documentation ───

test("i18n : mêmes clés en français et en anglais, nouvelles clés groupées à la fin", () => {
  const fr = JSON.parse(src("src/locales/fr.json"));
  const en = JSON.parse(src("src/locales/en.json"));
  assert.deepEqual(Object.keys(fr), Object.keys(en), "mêmes clés, même ordre");
  const wanted = [...THEME_PRESETS.slice(7).map((p) => `theme.${p.id}`), "settings.accent2", "settings.accent2.add", "settings.accent2.remove", "settings.surface", "settings.text",
    "settings.colorOptionalHint", "settings.colorInvalid", "settings.contrast.text", "settings.contrast.accent", "settings.contrast.accent2"];
  for (const d of [fr, en]) {
    for (const k of wanted) assert.ok(typeof d[k] === "string" && d[k], k);
    assert.deepEqual(Object.keys(d).slice(-wanted.length), wanted, "regroupées à la fin");
    for (const k of ["settings.contrast.text", "settings.contrast.accent", "settings.contrast.accent2"]) assert.ok(d[k].includes("{ratio}"), k);
  }
});

test("documentation : chaque jeton et chaque variable CSS du thème", () => {
  const docs = src("docs/MODULES.md");
  for (const t of C.THEME_TOKENS) assert.ok(docs.includes(`\`${t}\``), `jeton ${t}`);
  for (const v of ["--v-accent2", "--v-accent2-fg", "--v-gradient"]) assert.ok(docs.includes(v), v);
  assert.ok(docs.includes("OKLCH") && docs.includes("theme:accent2"));
});
