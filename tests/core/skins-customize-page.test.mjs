// Skin customization, the admin page (docs/SKINS.md "Customization", docs/ERGONOMIE-ADMIN.md): the REAL components rendered with react-dom/server, in French and English;
// the budgets of the generic page whatever a skin declares (R2, R4, R5, R19), accessibility, hostile labels, and the server actions (rights, errors under the field).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { appearanceLabels } = await import("@/app/admin/(panel)/appearance/labels");
const { AppearanceLabelsProvider } = await import("@/app/admin/(panel)/appearance/AppearanceLabels");
const { CustomizeForm } = await import("@/app/admin/(panel)/appearance/customize/CustomizeForm");
const { buildModel, optionControls } = await import("@/app/admin/(panel)/appearance/customize/model");
const { floatingLabels } = await import("@/components/admin/floating");
const actions = await import("@/app/admin/(panel)/appearance/customize/actions");
const { readCustomize } = await import("@/core/skins/customizeRead");
const { resolveValues } = await import("@/core/skins/customizeResolve");
const S = await import("@/core/skins/service");
const A = await import("@/core/skins/appearance");
const C = await import("@/core/skins/customizeStore");
const { getSetting } = await import("@/core/settings");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");
const fixture = JSON.parse(fs.readFileSync("tests/fixtures/skins/customizable/skin.json", "utf8"));

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
  globalThis.curiosaTestSession = null;
});
after(() => { db.close(); cat.close(); });

const L = (fr, en = fr) => ({ fr, en });
const modelOf = (customize, lang = "en", extra = {}) => {
  const decl = readCustomize(customize).decl;
  assert.ok(decl, "declaration read");
  const resolved = resolveValues(decl, null, { skinId: "x-skin", version: "1.0.0" });
  return buildModel({ skin: { id: "x-skin", version: "1.0.0", name: L("Mon skin", "My skin") }, decl, resolved, storedLook: null, signals: [], options: optionControls([], {}, lang), pictureCount: 0, lang, variantsLabel: "Variants", ...extra });
};
const render = (model, lang = "en") => renderToStaticMarkup(React.createElement(AppearanceLabelsProvider, { labels: appearanceLabels(makeTranslator(lang)) },
  React.createElement(CustomizeForm, { model, pages: [{ label: "Home", path: "/" }], initialSrc: "/?curiosa_skin_preview=x", bothModes: true, floating: floatingLabels(makeTranslator(lang)), hasPictures: false, canReset: true })));
/** The markup with every folded group removed: what is on screen before anyone opens anything. */
const visible = (html) => html.replace(/<details[\s\S]*?<\/details>/g, "");
const fields = (html) => (html.match(/<fieldset/g) ?? []).length + (html.match(/<input type="range"/g) ?? []).length + (html.match(/<select/g) ?? []).length;

test("page: the reference declaration, in both languages: looks, exactly two featured controls, every group folded with its summary (R2)", () => {
  for (const lang of ["en", "fr"]) {
    const html = render(modelOf(fixture.customize, lang), lang);
    const v = visible(html);
    assert.ok(v.includes(lang === "fr" ? "Ambiances" : "Looks"));
    for (const name of lang === "fr" ? ["Bleu royal", "Cramoisi", "Forêt", "Veille de nuit", "Couleur de la bannière", "Fanions"] : ["Royal blue", "Crimson", "Forest", "Night watch", "Banner colour", "Pennants"]) assert.ok(v.includes(name), `${lang}: ${name}`);
    assert.equal((v.match(/data-control="/g) ?? []).length, 2, "two featured controls on screen");
    assert.equal((html.match(/<details/g) ?? []).length, 3, "the three other groups are folded");
    assert.equal((html.match(/<details open/g) ?? []).length, 0, "none open by default");
    for (const g of lang === "fr" ? ["Images", "Parchemin", "Avancé"] : ["Pictures", "Parchment", "Advanced"]) assert.ok(new RegExp(`<summary[^>]*>[\\s\\S]*${g}`).test(html), g);
    assert.match(html, /name="skin" value="x-skin"/);
    assert.ok(fields(v) <= 5, `${lang}: ${fields(v)} fields visible (R4: 5 at most)`);
  }
});

test("page: the worst case a skin can declare (5 groups, 24 controls, 10 swatches, 10 choices, 2 featured) stays inside the budgets (R2, R4, R5, R19)", () => {
  const sw = (i) => ({ id: `s${i}`, label: L(`Teinte ${i}`, `Shade ${i}`), light: "#223344", dark: "#334455" });
  const kinds = [
    (id) => ({ id, type: "color", label: L("Couleur", "Colour"), palette: Array.from({ length: 10 }, (_, i) => sw(i)), default: "s0", custom: { l: [0.1, 0.9], c: [0, 0.2] } }),
    (id) => ({ id, type: "choice", label: L("Choix", "Choice"), default: "v0", values: Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, label: L(`Valeur ${i}`, `Value ${i}`), tokens: {} })) }),
    (id) => ({ id, type: "slider", label: L("Taille", "Size"), min: 0, max: 10, step: 1, unit: "px", default: 3 }),
    (id) => ({ id, type: "toggle", label: L("Actif", "Active"), default: false, on: {}, off: {} }),
    (id) => ({ id, type: "image", label: L("Image", "Picture"), default: "none", fit: "cover", alternatives: [{ id: "a", file: "images/a.svg", label: L("A") }], upload: { formats: ["png"], maxKb: 100, ratio: [16, 3], minPx: [100, 20], maxPx: [800, 150] } }),
  ];
  let n = 0;
  const groups = Array.from({ length: 5 }, (_, g) => ({ id: `g${g}`, label: L(`Groupe ${g}`, `Group ${g}`), folded: false, controls: Array.from({ length: g < 4 ? 5 : 4 }, () => { const i = n++; return { ...kinds[i % 5](`c${i}`), featured: i < 2 }; }) }));
  assert.equal(n, 24);
  const html = render(modelOf({ version: 1, groups }));
  assert.equal((html.match(/data-control="/g) ?? []).length, 24);
  const v = visible(html);
  assert.equal((v.match(/data-control="/g) ?? []).length, 2);
  assert.ok(fields(v) <= 5, `${fields(v)} fields visible`);
  assert.equal((html.match(/<details/g) ?? []).length, 5, "every group is folded, even the ones the skin declared open");
  for (const part of html.match(/<details[\s\S]*?<\/details>/g)) assert.ok((part.match(/data-control="/g) ?? []).length <= 7, "7 controls at most in a section (R4)");
});

test("page: accessibility and ergonomics of the markup (R19, R27, R28): real radio groups with legends, labelled inputs, 44 px targets, nothing truncated", () => {
  const html = render(modelOf(fixture.customize));
  const groups = html.match(/<fieldset[\s\S]*?<\/fieldset>/g).filter((g) => g.includes('type="radio"'));
  assert.ok(groups.length >= 6);
  for (const g of groups) { assert.match(g, /<legend/, "every group of choices has a legend"); assert.match(g, /type="radio"/); }
  assert.equal((html.match(/<input type="radio"/g) ?? []).length, (html.match(/<label[^>]*>(?:(?!<\/label>)[\s\S])*type="radio"/g) ?? []).length, "every radio is inside its label");
  assert.ok(!/<(div|span)[^>]*onclick/.test(html), "no click on a non-control");
  assert.ok(!/truncate|text-ellipsis|line-clamp/.test(visible(html).replace(/<summary[\s\S]*?<\/summary>/g, "")), "choices are never truncated (R19)");
  assert.ok(!/\bsr-only[^>]*type="radio"[^>]*disabled/.test(html));
  for (const btn of html.match(/<button[^>]*>/g) ?? []) assert.match(btn, /min-h-11|h-11/, btn);
  assert.match(html, /<aside[^>]*aria-label=/, "the preview is named");
  assert.match(html, /<iframe[^>]*title="/, "the preview frame has a title");
});

test("page: a hostile label from a skin is text, never markup", () => {
  const evil = structuredClone(fixture.customize);
  evil.groups[0].controls[0].label = L("Teinte <img src=x>", "Colour");
  const r = readCustomize(evil);
  assert.deepEqual(r.issues.filter((i) => i.severity === "error").length, 0, "angle brackets are not forbidden in a label: they are escaped on display");
  const html = render(modelOf(evil, "fr"), "fr");
  assert.ok(!html.includes("<img src=x"), "escaped");
  assert.ok(html.includes("&lt;img src=x"));
});

test("page: states (R33): untouched shows no status line; a changed value shows the count, a reset per control, a reset for all; a legibility signal only where it applies", () => {
  const m = modelOf(fixture.customize);
  const untouched = render(m);
  assert.ok(!untouched.includes("Changed settings"), "nothing said about the customization when it is the skin's own");
  assert.ok(!untouched.includes("Back to the skin"), "no reset button for an untouched control");
  assert.ok(!/Hard to read/.test(untouched));
  assert.ok(!untouched.includes("Reset everything"), "nothing to reset");
  const changed = { ...m, values: { ...m.values, banner: "crimson", corner: 0.5 }, signals: [{ control: "banner", mode: "light", ratio: 2.1, min: 4.5 }] };
  const html = render(changed);
  assert.match(html, /Changed settings: 2/);
  assert.equal((html.match(/Back to the skin&#x27;s value/g) ?? []).length >= 2, true);
  assert.match(html, /Reset everything to the skin/);
  assert.match(html, /data-testid="signal-banner"[^>]*>[\s\S]*Hard to read in light mode: contrast 2\.1 instead of 4\.5\./);
  const fr = render({ ...changed, signals: [{ control: "banner", mode: "dark", ratio: 2.1, min: 4.5 }] }, "fr");
  assert.match(fr, /Peu lisible en mode sombre : contraste 2,1 sur 4,5\./);
  const both = render({ ...changed, signals: [{ control: "banner", mode: "light", ratio: 2.1, min: 4.5 }, { control: "banner", mode: "dark", ratio: 3.9, min: 4.5 }] });
  assert.match(both, /contrast 2\.1 instead of 4\.5\./);
  assert.ok(!/in light mode: contrast 2\.1/.test(both), "both modes at risk: one line, no mode named");
});

test("page: a missing picture is a degraded state with a plain sentence", () => {
  const m = modelOf(fixture.customize);
  const html = render({ ...m, values: { ...m.values, emblem: { upload: "123e4567-e89b-12d3-a456-426614174000.webp" } }, missing: ["emblem"] });
  assert.match(html, /Picture not found\. The skin&#x27;s own picture is used\./);
});

test("page: the skin's own options are one more group of choices, 'Variants'", () => {
  const options = optionControls([{ id: "density", label: L("Densité", "Density"), default: "normal", values: [{ id: "normal", label: L("Normale", "Normal"), tokens: {} }, { id: "airy", label: L("Aérée", "Airy"), tokens: {} }] }], { density: "airy" }, "fr");
  const m = modelOf(fixture.customize, "fr", { options });
  assert.equal(m.values["opt-density"], "airy");
  const html = render(m, "fr");
  assert.match(html, /Variants[\s\S]*Densité/);
});

// ── server actions ──────────────────────────────────────────────────────────────────────────────────────────────────

const asRole = async (role) => {
  const email = `${role}@example.org`;
  const u = (await db.prisma.user.findUnique({ where: { email } })) ?? (await db.prisma.user.create({ data: { email, name: role, role, passwordHash: "x" } }));
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
  return u;
};
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, typeof v === "string" ? v : JSON.stringify(v)); return f; };
async function setup() {
  await cat.publish("customizable", { from: "customizable" });
  assert.equal((await S.installFromCatalogue("customizable")).ok, true);
  await A.chooseSkin("customizable");
}

test("actions: only the Administration role saves, resets and previews; an editor and a visitor are turned away", async () => {
  await setup();
  const fd = form({ skin: "customizable", state: { values: { banner: "crimson" } } });
  for (const who of [null, "editor"]) {
    if (who) await asRole(who); else globalThis.curiosaTestSession = null;
    await assert.rejects(() => actions.saveCustomizationAction(null, fd), undefined, String(who));
    await assert.rejects(() => actions.resetCustomizationAction(null, form({ skin: "customizable", what: "all" })));
    await assert.rejects(() => actions.previewDraftAction("customizable", { values: {} }));
  }
  assert.equal(await getSetting("skin.custom.customizable"), undefined);
});

test("actions: saving writes the skin's own setting and its options; bad input comes back under the control, with what to do; nothing is written on error", async () => {
  await setup();
  await asRole("admin");
  const ok = await actions.saveCustomizationAction(null, form({ skin: "customizable", state: { values: { banner: "crimson", corner: 0.5 }, look: "crimson", options: { density: "airy" } } }));
  assert.deepEqual(ok, { ok: "Customization saved." });
  assert.deepEqual((await C.readStored("customizable")).values, { banner: "crimson", corner: 0.5 });
  assert.equal((await C.readStored("customizable")).look, "crimson");
  assert.deepEqual(await getSetting("skin.options"), { density: "airy" });
  const bad = await actions.saveCustomizationAction(null, form({ skin: "customizable", state: { values: { banner: "#fff;}body{display:none}", corner: "x" } } }));
  assert.deepEqual(Object.keys(bad.errors).sort(), ["cz-banner", "cz-corner"]);
  assert.match(bad.errors["cz-banner"], /not allowed here\. Choose one of the choices shown\./);
  assert.deepEqual((await C.readStored("customizable")).values, { banner: "crimson", corner: 0.5 }, "unchanged");
  const pic = await actions.saveCustomizationAction(null, form({ skin: "customizable", state: { values: { emblem: { upload: "123e4567-e89b-12d3-a456-426614174000.webp" } } } }));
  assert.match(pic.errors["cz-emblem"], /no longer available/);
  for (const skin of ["basic", "../x", "", "nope-skin"]) assert.ok((await actions.saveCustomizationAction(null, form({ skin, state: { values: {} } }))).error, skin);
  assert.ok((await actions.saveCustomizationAction(null, form({ skin: "customizable", state: "{not json" }))).ok, "unreadable state: nothing to keep, nothing breaks (the page sends JSON)");
});

test("actions: reset gives the skin's own look back, options included; the preview returns the sheet, the signals and the real values, and writes nothing", async () => {
  await setup();
  await asRole("owner");
  await actions.saveCustomizationAction(null, form({ skin: "customizable", state: { values: { banner: "forest" }, options: { density: "airy" } } }));
  assert.deepEqual(await actions.resetCustomizationAction(null, form({ skin: "customizable", what: "all" })), { ok: "The skin's own look is back." });
  assert.equal(await C.readStored("customizable"), null);
  assert.equal(await getSetting("skin.options"), undefined);
  assert.ok((await actions.resetCustomizationAction(null, form({ skin: "customizable", what: "nothing" }))).error);
  const before = await db.prisma.setting.count();
  const p = await actions.previewDraftAction("customizable", { values: { banner: "night", trim: "#d9d2c0" }, options: { density: "airy" } });
  assert.equal(p.ok, true);
  assert.match(p.css, /--sk-cz-banner:#1c1830/);
  assert.match(p.css, /--sk-page-width:54rem/, "the skin's own options are previewed too");
  assert.ok(p.signals.some((s) => s.control === "trim"));
  assert.equal(p.values.banner, "night");
  assert.equal(await db.prisma.setting.count(), before);
  assert.deepEqual(await actions.previewDraftAction("../x", {}), { ok: false });
  const garbage = await actions.previewDraftAction("customizable", "garbage");
  assert.equal(garbage.ok, true);
  assert.ok(!garbage.css.includes("--sk-cz-banner:#1c1830") && garbage.signals.length === 0, "garbage is the skin's own look");
});

test("removing a skin keeps the customization and the pictures by default; the box 'also delete my pictures' erases them (D12)", async () => {
  await setup();
  await asRole("owner");
  const appearance = await import("@/app/admin/(panel)/appearance/actions");
  const sharp = (await import("sharp")).default;
  const skin = { id: "customizable", version: "1.0.0", customize: (await (await import("@/core/skins/appearanceView")).definitionOf("customizable")).customize };
  const u = await db.prisma.user.findFirst();
  const pic = await C.storePicture(skin, "emblem", await sharp({ create: { width: 144, height: 184, channels: 3, background: "#aa5522" } }).png().toBuffer(), { uploaderId: u.id });
  await C.saveCustom(skin, { values: { emblem: pic.value, banner: "forest" } });
  await A.chooseSkin("basic");
  assert.equal((await appearance.removeSkinAction(null, form({ id: "customizable" }))).ok !== undefined, true);
  assert.deepEqual((await C.readStored("customizable")).values.banner, "forest", "kept");
  assert.equal((await C.pictureUsage("customizable")).files, 1, "the picture is kept too");
  await cat.publish("customizable", { from: "customizable" });
  await S.installFromCatalogue("customizable");
  await appearance.removeSkinAction(null, form({ id: "customizable", erase: "on" }));
  assert.equal(await C.readStored("customizable"), null);
  assert.equal((await C.pictureUsage("customizable")).files, 0);
});
