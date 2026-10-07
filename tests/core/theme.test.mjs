import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { fakeCtx } from "../helpers/fakeCtx.mjs";

const db = await useTestDb();
const C = await import("@/core/color");
const { parseManifest } = await import("@/core/modules/manifest");
const { installModule, setModuleEnabled } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { buildContext } = await import("@/core/modules/context");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { instanceSettingKey } = await import("@/core/modules/context");
const { BUILTIN_MODULES } = await import("@/modules-builtin");
const ticker = await import("../../modules-community/sponsor-ticker/index.mjs");
const maze = await import("../../modules-community/maze-overlay/index.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const base = (over) => ({ apiVersion: 2, version: "1.0.0", id: "demo", name: "Demo", ...over });

test("thème : jetons dérivés des deux réglages de l'admin, identiques à la palette du site", () => {
  const theme = C.buildTheme("#101010", "#ff0066", "serif");
  const palette = C.buildPalette("#101010", "#ff0066");
  assert.equal(theme.bg, palette["--v-bg"]);
  assert.equal(theme.accent, "#ff0066");
  assert.equal(theme.fg, palette["--v-fg"]);
  assert.equal(theme.surface, palette["--v-surface"]);
  assert.deepEqual([theme.fontKey, theme.font], ["serif", C.FONT_STACKS.serif]);
  assert.deepEqual(C.THEME_TOKENS.map((t) => typeof theme[t]), C.THEME_TOKENS.map(() => "string"));
  assert.equal(C.buildTheme("#101010", "#ff0066", "comic-sans").fontKey, "sans", "police inconnue → sans");
  const bad = C.buildTheme("javascript:1", "<x>", "sans");
  assert.equal(bad.bg, "#121214", "valeurs invalides remplacées, jamais injectées");
});

test("thème : variables CSS --v-* sûres à injecter", () => {
  const css = C.themeCss(C.buildTheme("#fafafa", "#0055ff", "mono"));
  assert.match(css, /^:root\{--v-accent:#0055ff;--v-accent-fg:#[0-9a-f]{6};--v-bg:#fafafa;/);
  assert.ok(css.includes("--v-font:" + C.FONT_STACKS.mono));
  assert.ok(!/[<>]/.test(css));
});

test("thème : références « theme:<jeton> » reconnues, tout le reste refusé", () => {
  assert.equal(C.themeRef("theme:accent"), "accent");
  assert.equal(C.themeRef("theme:accentFg"), "accentFg");
  for (const bad of ["theme:rouge", "theme:", "accent", "#ff0000", null, undefined, 5, "theme:accent;x"]) assert.equal(C.themeRef(bad), null, String(bad));
});

test("manifeste : une couleur peut suivre le thème, rien d'autre — et le groupe « apparence » est accepté", () => {
  const field = (over) => base({ settings: [{ key: "c", label: "C", type: "color", ...over }] });
  assert.ok(parseManifest(field({ default: "theme:accent", group: "appearance" })).ok);
  assert.equal(parseManifest(field({ default: "theme:inconnu" })).ok, false);
  assert.equal(parseManifest(field({ type: "text", default: "theme:accent" })).ok, false);
  assert.equal(parseManifest(field({ group: "autre" })).ok, false);
  assert.ok(parseManifest(field({ default: "#abcdef" })).ok);
});

const MOD = {
  "module.json": base({ main: "index.mjs", settings: [
    { key: "wall", label: "Mur", type: "color", default: "theme:surface", group: "appearance" },
    { key: "plain", label: "Fixe", type: "color", default: "#123456", group: "appearance" },
    { key: "title", label: "Titre", type: "text", default: "x" },
  ] }),
  "index.mjs": "export default {};",
};
async function demo() {
  await installModule(makeRepo(MOD).url);
  await setModuleEnabled("demo", true);
  const mod = await R.getModule("demo");
  const inst = await createInstance(db.prisma, { manifest: mod.manifest, names: { en: "Demo" } });
  return { mod, inst: (await R.getActiveInstances()).find((a) => a.instance.id === inst.id).instance };
}

test("contexte : ctx.theme reflète les réglages du site, y compris après un changement", async () => {
  const { mod, inst } = await demo();
  const before = await buildContext(mod, inst, "en");
  assert.equal(before.theme.accent, "#e8a23b", "thème par défaut du site");
  await setSetting("theme.accent", "#00aa55");
  await setSetting("theme.background", "#fafafa");
  await setSetting("theme.font", "serif");
  const after = await buildContext(mod, inst, "en");
  assert.equal(after.theme.accent, "#00aa55");
  assert.equal(after.theme.bg, "#fafafa");
  assert.equal(after.theme.fontKey, "serif");
  assert.equal(after.theme.fg, "#18181b", "texte sombre sur fond clair");
});

test("contexte : une couleur « theme:… » suit le thème tant qu'aucune couleur n'est choisie", async () => {
  const { mod, inst } = await demo();
  assert.equal((await buildContext(mod, inst, "en")).setting("wall"), C.buildTheme("#121214", "#e8a23b", "sans").surface);
  await setSetting("theme.background", "#fafafa");
  assert.equal((await buildContext(mod, inst, "en")).setting("wall"), C.buildTheme("#fafafa", "#e8a23b", "sans").surface, "suit le changement de thème");
  await setSetting(instanceSettingKey(inst.id, "wall"), "#ff0000");
  assert.equal((await buildContext(mod, inst, "en")).setting("wall"), "#ff0000", "la couleur choisie l'emporte");
  await setSetting(instanceSettingKey(inst.id, "wall"), "");
  assert.equal((await buildContext(mod, inst, "en")).setting("wall"), C.buildTheme("#fafafa", "#e8a23b", "sans").surface, "vide = retour au thème");
});

test("contexte : une couleur fixe ou un réglage ordinaire n'est pas affecté par le thème", async () => {
  const { mod, inst } = await demo();
  await setSetting("theme.accent", "#00aa55");
  const ctx = await buildContext(mod, inst, "en");
  assert.equal(ctx.setting("plain"), "#123456");
  assert.equal(ctx.setting("title"), "x");
});

test("modules livrés : toutes les couleurs par défaut du dépôt qui doivent suivre le thème le font", () => {
  const ticker = BUILTIN_MODULES.find((b) => b.manifest.id === "ticker-overlay").manifest;
  for (const k of ["textColor", "cardColor"]) {
    const f = ticker.settings.find((s) => s.key === k);
    assert.ok(C.themeRef(f.default), k);
    assert.equal(f.group, "appearance");
  }
});

test("overlays : le thème du site traverse jusqu'au rendu (fond, texte, accent), et les réglages propres l'emportent", () => {
  const theme = C.buildTheme("#fafafa", "#00aa55", "sans");
  const query = new URLSearchParams();
  const out = ticker.default.overlay(fakeCtx({ theme, settings: {} }), { query });
  assert.match(out.html, /--ticker-accent:#00aa55/);
  assert.match(out.html, new RegExp(`--tk-bg:${theme.surface}`));
  assert.match(out.html, new RegExp(`--tk-fg:${theme.fg}`));
  assert.match(out.html, new RegExp(`--tk-on-accent:${theme.accentFg}`));
  const custom = ticker.default.overlay(fakeCtx({ theme, settings: { accentColor: "#ff00ff" } }), { query });
  assert.match(custom.html, /--ticker-accent:#ff00ff/);
  const m = maze.default.overlay(fakeCtx({ theme, settings: {} }), { query });
  assert.match(m.css, new RegExp(`border:2px solid ${theme.accent}`));
  assert.match(m.css, new RegExp(`background:${theme.surface}ee;color:${theme.fg}`));
});

test("labyrinthe : couleurs de mur et de sol propres au module, valeurs invalides → défauts", () => {
  const cfg = (settings) => JSON.parse(maze.default.overlay(fakeCtx({ settings }), { query: new URLSearchParams() }).script.match(/__MAZE__=(\{.*?\});import/s)[1]);
  assert.deepEqual([cfg({}).wallColor, cfg({}).floorColor], ["#2a2118", "#181310"]);
  assert.deepEqual([cfg({ wallColor: "#112233", floorColor: "#445566" }).wallColor, cfg({ wallColor: "#112233", floorColor: "#445566" }).floorColor], ["#112233", "#445566"]);
  assert.equal(cfg({ wallColor: "red" }).wallColor, "#2a2118");
  assert.equal(cfg({ wallColor: "#fff;}</style>" }).wallColor, "#2a2118");
});

test("labyrinthe : les réglages d'apparence sont groupés à part dans le manifeste", async () => {
  const fs = await import("node:fs");
  const m = JSON.parse(fs.readFileSync("modules-community/maze-overlay/module.json", "utf8"));
  assert.ok(parseManifest(m).ok);
  const appearance = m.settings.filter((s) => s.group === "appearance").map((s) => s.key);
  for (const k of ["accent", "wallTexture", "floorTexture", "wallColor", "floorColor", "portalTexture", "handsSprite"]) assert.ok(appearance.includes(k), k);
  assert.ok(!appearance.includes("moveSpeed"), "les réglages de comportement restent séparés");
  assert.equal(m.settings.find((s) => s.key === "accent").default, "theme:accent");
});
