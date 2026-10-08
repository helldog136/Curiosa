import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const G = await import("@/core/glow");

const spots = (css) => [...css.matchAll(/radial-gradient\((\d+)rem (\d+)rem at (\d+)% (\d+)%,hsla\((\d+),(\d+)%,(\d+)%,([\d.]+)\)/g)].map((m) => ({ w: +m[1], h: +m[2], x: +m[3], y: +m[4], hue: +m[5], alpha: +m[8] }));
const ACCENT = "#e8a23b";
const T = (over = {}) => ({ ...G.GLOW_PRESETS.soft, ...over });

test("halo : rien si désactivé ; préréglages doux et marqué ; valeur inconnue ignorée", () => {
  assert.equal(G.glowCss("none", T(), ACCENT), "");
  const soft = G.glowCss("soft", T(), ACCENT), strong = G.glowCss("strong", T(), ACCENT);
  for (const css of [soft, strong]) assert.match(css, /^body\{background-image:.*;background-repeat:no-repeat;background-attachment:fixed\}$/);
  assert.equal(spots(soft).length, 2);
  assert.equal(spots(strong).length, 3);
  assert.ok(Math.max(...spots(strong).map((s) => s.alpha)) > Math.max(...spots(soft).map((s) => s.alpha)));
  assert.equal(G.isGlowLevel("custom"), true);
  assert.equal(G.isGlowLevel("n'importe quoi"), false);
});

test("halo : nombre de taches réglable, 1 à 8", () => {
  for (const n of [1, 4, 8]) assert.equal(spots(G.glowCss("custom", T({ count: n }), ACCENT)).length, n);
});

test("halo : déterministe — même graine, même résultat ; graine différente, autre disposition", () => {
  const a = G.glowCss("custom", T({ count: 5, seed: 42 }), ACCENT);
  assert.equal(G.glowCss("custom", T({ count: 5, seed: 42 }), ACCENT), a);
  assert.notEqual(G.glowCss("custom", T({ count: 5, seed: 43 }), ACCENT), a);
});

test("halo : variation de taille — nulle = toutes pareilles ; forte = tailles qui varient, dans les bornes ±variation", () => {
  const same = spots(G.glowCss("custom", T({ count: 6, size: 60, variance: 0 }), ACCENT));
  assert.ok(same.every((s) => s.w === 60));
  const varied = spots(G.glowCss("custom", T({ count: 8, size: 60, variance: 50 }), ACCENT));
  assert.ok(new Set(varied.map((s) => s.w)).size > 1);
  assert.ok(varied.every((s) => s.w >= 30 && s.w <= 90), JSON.stringify(varied.map((s) => s.w)));
});

test("halo : décalage de teinte maximal — 0 = toutes l'accent ; sinon chaque tache reste dans ±décalage de l'accent", () => {
  const accentHue = spots(G.glowCss("custom", T({ count: 4, hue: 0 }), ACCENT))[0].hue;
  assert.ok(spots(G.glowCss("custom", T({ count: 8, hue: 0 }), ACCENT)).every((s) => s.hue === accentHue));
  const shifted = spots(G.glowCss("custom", T({ count: 8, hue: 40, seed: 3 }), ACCENT));
  const dist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  assert.ok(shifted.every((s) => dist(s.hue, accentHue) <= 41), JSON.stringify(shifted.map((s) => s.hue)));
  assert.ok(new Set(shifted.map((s) => s.hue)).size > 1, "les taches ont des teintes différentes");
});

test("halo : intensité réglable, positions dans la page", () => {
  const low = spots(G.glowCss("custom", T({ count: 6, intensity: 10 }), ACCENT)), high = spots(G.glowCss("custom", T({ count: 6, intensity: 40 }), ACCENT));
  assert.ok(Math.max(...low.map((s) => s.alpha)) <= 0.101);
  assert.ok(Math.max(...high.map((s) => s.alpha)) > Math.max(...low.map((s) => s.alpha)));
  assert.ok(high.every((s) => s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100));
});

test("halo : suit la couleur d'accent (teinte de base) et reste visible même avec un accent très clair ou très sombre", () => {
  const blue = spots(G.glowCss("custom", T({ hue: 0 }), "#3b6fe8"))[0].hue, orange = spots(G.glowCss("custom", T({ hue: 0 }), ACCENT))[0].hue;
  assert.ok(Math.abs(blue - orange) > 60);
  for (const accent of ["#ffffff", "#000000"]) assert.match(G.glowCss("soft", T(), accent), /hsla\(\d+,\d+%,(3[89]|[4-6]\d)%/);
});

test("halo : réglages normalisés — hors limites ramenés aux bornes, texte ou vide ignorés", () => {
  const n = G.normalizeTuning({ count: 99, size: 5, variance: -3, hue: 999, intensity: "abc", seed: 0 });
  assert.deepEqual(n, { count: 8, size: 30, variance: 0, hue: 180, intensity: G.GLOW_PRESETS.soft.intensity, seed: 1, color: "" });
  assert.deepEqual(G.normalizeTuning(undefined), G.GLOW_PRESETS.soft);
  assert.deepEqual(G.normalizeTuning({ count: "", size: "75.4" }).size, 75);
});

test("halo : branché sur le site, choisi dans l'admin (simple : niveaux ; avancé : réglages fins), validé côté serveur", () => {
  assert.match(fs.readFileSync("src/app/(site)/layout.tsx", "utf8"), /glowCss\(localized\.glow\.level, localized\.glow\.custom, localized\.accent\)/);
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  assert.match(page, /name="glow"/);
  for (const k of ["count", "size", "variance", "hue", "intensity", "seed"]) assert.match(page, new RegExp(`name="glow_${k}"`));
  assert.match(page, /advanced \? \[\{ value: "custom"/, "« personnalisé » seulement en mode avancé");
  const actions = fs.readFileSync("src/app/admin/(panel)/settings/actions.ts", "utf8");
  assert.match(actions, /normalizeTuning\(raw\)/);
  assert.match(actions, /adv \|\| glow !== "custom"/, "le mode simple ne peut pas activer le personnalisé");
});

test("admin : le numéro de version est toujours affiché en bas du menu, pour tous les rôles et dans les deux modes", () => {
  const layout = fs.readFileSync("src/app/admin/(panel)/layout.tsx", "utf8");
  const tail = layout.slice(layout.lastIndexOf("nav.logout"));
  assert.match(tail, /data-testid="app-version">Curiosa v\{readVersion\(\)\}/, "après le bouton de déconnexion, dans le menu");
  const before = layout.slice(0, layout.indexOf("data-testid=\"app-version\""));
  assert.ok(!/(role|advanced)\s*(===|&&)[^<]{0,40}$/.test(before.slice(-120)), "pas conditionné au rôle ni au mode");
});

test("halo : couleur propre aux taches (sinon l'accent) ; le décalage de teinte part de cette couleur ; valeur invalide ignorée", () => {
  const hue = (css) => spots(css)[0].hue;
  const accent = hue(G.glowCss("custom", T({ hue: 0 }), ACCENT));
  const pink = hue(G.glowCss("custom", T({ hue: 0, color: "#e8337a" }), ACCENT));
  assert.ok(Math.abs(pink - accent) > 100, "les taches prennent la couleur choisie, pas celle de l'accent");
  assert.ok(Math.abs(pink - 337) < 6);
  assert.equal(G.normalizeTuning({ color: "#E8337A" }).color, "#e8337a");
  for (const bad of ["red", "#12", "url(x)", 5, null, "#ggg111"]) assert.equal(G.normalizeTuning({ color: bad }).color, "", String(bad));
  assert.equal(G.GLOW_PRESETS.soft.color, "", "les préréglages suivent l'accent");
  const shifted = spots(G.glowCss("custom", T({ count: 6, hue: 30, color: "#e8337a", seed: 4 }), ACCENT)).map((x) => x.hue);
  assert.ok(shifted.every((h) => Math.min(Math.abs(h - 337), 360 - Math.abs(h - 337)) <= 31), JSON.stringify(shifted));
});

test("admin : un bloc de réglages n'apparaît que lorsque son choix est sélectionné (halo « personnalisé », description du fond « personnalisé »), sans perdre les valeurs", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  assert.match(page, /<ShowWhen field="glow" equals="custom" initial=\{config\.glow\.level\}>/);
  assert.match(page, /<ShowWhen field="bgPreset" equals="custom" initial=\{config\.bg\.preset\}>/);
  const comp = fs.readFileSync("src/components/admin/ShowWhen.tsx", "utf8");
  assert.match(comp, /hidden=\{value !== equals\}/, "masqué par `hidden` : les champs restent dans le formulaire et sont envoyés");
  assert.match(comp, /RadioNodeList/);
});

test("admin : les sélecteurs de couleur sont de vraies pastilles visibles (pas aplaties par le remplissage des champs texte)", () => {
  const ui = fs.readFileSync("src/components/admin/ui.ts", "utf8");
  assert.match(ui, /colorInput: "block h-11 w-full cursor-pointer[^"]*p-1/);
  assert.equal((fs.readFileSync("src/components/admin/ThemePicker.tsx", "utf8").match(/type="color"[^\n]*className=\{ui\.colorInput\}/g) ?? []).length, 2, "fond et accent");
  assert.match(fs.readFileSync("src/components/admin/Field.tsx", "utf8"), /type === "color" \? ui\.colorInput : ui\.input/);
});
