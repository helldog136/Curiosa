// Skin customization, pure part (docs/SKINS.md "Customization"): the tolerant reader and its limits, the values the core accepts (and every attempt to smuggle
// something into a style sheet), the variables written, defaults that leave a skin exactly as shipped, the legibility SIGNAL (never a correction).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { parseSkinManifest } = await import("@/core/skins/manifest");
const { validateSkinFolder } = await import("@/core/skins/validate");
const { toSkinDefinition } = await import("@/core/skins/folder");
const R = await import("@/core/skins/customizeRead");
const V = await import("@/core/skins/customizeResolve");
const { CUSTOMIZE_LIMITS } = await import("@/core/skins/customizeSpec");
const { composeSkin } = await import("@/core/skins/compose");
const { renderSheet, renderTokens } = await import("@/core/skins/sheet");
const ergonomics = await import("../../testsupport/ergonomics.mjs");

const FIXTURE = path.resolve("tests/fixtures/skins/customizable");
const fixtureJson = () => JSON.parse(fs.readFileSync(path.join(FIXTURE, "skin.json"), "utf8"));
const codes = (issues) => issues.map((i) => i.code);
const errors = (issues) => issues.filter((i) => i.severity === "error").map((i) => i.code);
const L = (fr, en = fr) => ({ fr, en });

const validated = validateSkinFolder(FIXTURE, { coreVersion: "0.44.0", folderName: "customizable" });
assert.ok(validated.ok, JSON.stringify(validated.issues.map((i) => i.message.en)));
const skin = toSkinDefinition({ id: "customizable", version: "1.0.0", manifest: validated.manifest, css: validated.css, tokens: validated.tokens });
const decl = skin.customize;

// ── the reader ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("reader: the fixture (the declaration of the knight skin) is read whole, with its looks, groups, and exactly two featured controls", () => {
  assert.ok(decl);
  assert.equal(decl.groups.length, 4);
  assert.equal(decl.looks.length, 4);
  const all = decl.groups.flatMap((g) => g.controls);
  assert.deepEqual(all.map((c) => c.type).sort(), ["color", "color", "color", "image", "image", "image", "slider"]);
  assert.deepEqual(all.filter((c) => c.featured).map((c) => c.id), ["banner", "pennants"]);
  assert.deepEqual(codes(validated.issues).filter((c) => c.startsWith("customize")), [], "no customize warning on the reference declaration");
});

const parseWith = (patch, base = fixtureJson()) => { patch(base); return parseSkinManifest(base); };
const declWith = (customize) => R.readCustomize(customize);
const minimal = (controls, extra = {}) => ({ version: 1, groups: [{ id: "g", label: L("Groupe", "Group"), controls }], ...extra });
const slider = (id = "s", extra = {}) => ({ id, type: "slider", label: L("Taille", "Size"), min: 0, max: 10, step: 1, unit: "px", default: 2, ...extra });

test("reader: a skin of contract 3 cannot carry customize (the author fixes it); an overlay skin ignores it with a warning", () => {
  const r = parseWith((m) => { m.skinContract = 3; });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r.issues), ["customize-contract"]);
  const o = parseWith((m) => { m.kind = "overlay"; m.skinContract = 5; });
  assert.equal(o.ok, true);
  assert.equal(o.manifest.customize, null);
  assert.ok(codes(o.warnings).includes("customize-unknown"));
});

test("reader: tolerant, an unknown control type, key or group key is skipped with a warning and the rest works", () => {
  const r = declWith(minimal([slider("a"), { id: "x", type: "hologram", label: L("Autre", "Other") }, { ...slider("b"), shiny: true }], { surprise: 1 }));
  assert.equal(r.decl.groups[0].controls.length, 2, "the unknown type is skipped");
  assert.deepEqual(errors(r.issues), []);
  assert.equal(codes(r.issues).filter((c) => c === "customize-unknown").length, 3, "type, key of a control, key of customize");
});

test("reader: a customize written for a later version is ignored with a warning, never refused", () => {
  const r = declWith({ version: 2, groups: [] });
  assert.equal(r.decl, null);
  assert.deepEqual(codes(r.issues), ["customize-version-ahead"]);
  assert.equal(r.issues[0].severity, "warning");
  const m = parseWith((x) => { x.customize = { version: 9, whatever: true }; });
  assert.equal(m.ok, true);
  assert.equal(m.manifest.customize, null);
});

test("reader: the limits are the core's and a skin cannot raise them (groups, controls per group, total, featured, looks, choices)", () => {
  const ctl = (n) => Array.from({ length: n }, (_, i) => slider(`c${i}`));
  const groups = (n, per) => Array.from({ length: n }, (_, g) => ({ id: `g${g}`, label: L("G"), controls: Array.from({ length: per }, (_, i) => slider(`g${g}-${i}`)) }));
  assert.ok(errors(declWith({ version: 1, groups: groups(6, 1) }).issues).includes("customize-limit"), "6 groups");
  assert.ok(errors(declWith(minimal(ctl(8))).issues).includes("customize-limit"), "8 controls in a group");
  assert.ok(errors(declWith({ version: 1, groups: groups(5, 5) }).issues).includes("customize-limit"), "25 controls in all");
  assert.deepEqual(errors(declWith({ version: 1, groups: groups(5, 4) }).issues), [], "20 controls are fine");
  assert.ok(errors(declWith(minimal([slider("a", { featured: true }), slider("b", { featured: true }), slider("c", { featured: true })])).issues).includes("customize-limit"), "3 featured");
  const looks = Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, label: L("Look"), values: { s: 3 } }));
  assert.ok(errors(declWith(minimal([slider()], { looks })).issues).includes("customize-limit"), "9 looks");
  const choice = (n) => ({ id: "c", type: "choice", label: L("Choix", "Choice"), default: "v0", values: Array.from({ length: n }, (_, i) => ({ id: `v${i}`, label: L("Valeur", "Value"), tokens: {} })) });
  assert.ok(errors(declWith(minimal([choice(11)])).issues).includes("customize-limit"), "11 choices");
  assert.deepEqual(errors(declWith(minimal([choice(10)])).issues), [], "10 choices");
  assert.ok(errors(declWith(minimal([choice(1)])).issues).length > 0, "one choice is not a choice");
});

test("reader: labels are required in French AND English, short, without colon or parentheses; hints 60 characters at most; no jargon, no shouting", () => {
  const bad = (label, hint) => errors(declWith(minimal([{ ...slider(), label, ...(hint ? { hint } : {}) }])).issues);
  assert.deepEqual(bad(L("Taille", "Size")), []);
  assert.ok(bad({ fr: "Taille" }).includes("customize-label"), "no English");
  assert.ok(bad({ fr: "Taille", en: "" }).includes("customize-label"));
  assert.ok(bad(L("x".repeat(41))).includes("customize-label"), "41 characters");
  assert.ok(bad(L("Taille :", "Size:")).includes("customize-label"), "trailing colon");
  assert.ok(bad(L("Taille (px)", "Size (px)")).includes("customize-label"), "parentheses");
  assert.ok(bad(L("Taille", "Size"), L("x".repeat(61))).includes("customize-label"), "hint over 60");
  assert.deepEqual(bad(L("Taille", "Size"), L("x".repeat(60))), []);
  assert.ok(bad(L("La clé du site", "Size")).includes("customize-wording"), "jargon (R9)");
  assert.ok(bad(L("Taille", "The API token")).includes("customize-wording"));
  assert.ok(bad(L("Super taille !", "Size")).includes("customize-wording"), "exclamation (R13)");
  assert.ok(bad(L("TAILLE", "Size")).includes("customize-wording"), "capitals (R13)");
});

test("reader: the jargon list is the one of the ergonomics kit (a change there must be made here too)", () => {
  assert.deepEqual([...R.CUSTOMIZE_FORBIDDEN_WORDS].sort(), [...ergonomics.FORBIDDEN_WORDS].sort());
});

test("reader: ids, duplicates and variable collisions are errors", () => {
  assert.ok(errors(declWith(minimal([slider("Bad Id")])).issues).includes("customize-id"));
  assert.ok(errors(declWith(minimal([slider("1a")])).issues).includes("customize-id"));
  assert.ok(errors(declWith(minimal([slider("a"), slider("a")])).issues).includes("customize-id"), "duplicate");
  assert.ok(errors(declWith(minimal([slider("x".repeat(26))])).issues).includes("customize-id"), "26 characters");
  const img = { id: "pic", type: "image", label: L("Image"), default: "none", alternatives: [{ id: "a", file: "images/a.svg", label: L("A") }] };
  assert.ok(errors(declWith(minimal([img, slider("pic-size")])).issues).includes("customize-id"), "--sk-cz-pic-size is written by the image slot");
  assert.ok(errors(declWith(minimal([{ ...img, alternatives: [{ id: "none", file: "images/a.svg", label: L("A") }] }])).issues).includes("customize-id"), "none is reserved");
});

test("reader: colours need a valid palette and default; a free colour needs a range; values per mode", () => {
  const sw = (id, light = "#112233", dark = "#223344") => ({ id, label: L("Teinte"), light, dark });
  const col = (extra) => ({ id: "c", type: "color", label: L("Couleur", "Colour"), ...extra });
  assert.deepEqual(errors(declWith(minimal([col({ palette: [sw("a"), sw("b")], default: "a" })])).issues), []);
  assert.ok(errors(declWith(minimal([col({ palette: [sw("a")], default: "zzz" })])).issues).includes("customize-field"), "default not in the palette");
  assert.ok(errors(declWith(minimal([col({ palette: [sw("a", "red")], default: "a" })])).issues).includes("customize-field"), "named colours are not hex");
  assert.ok(errors(declWith(minimal([col({ palette: [sw("a", "#fff;}")], default: "a" })])).issues).includes("customize-field"));
  assert.ok(errors(declWith(minimal([col({ palette: [], default: "#112233" })])).issues).includes("customize-field"), "no palette and no range");
  assert.deepEqual(errors(declWith(minimal([col({ palette: [], default: "#abc", custom: { l: [0.1, 0.5], c: [0, 0.1] } })])).issues), [], "a short hex default is written back as #aabbcc");
  assert.equal(declWith(minimal([col({ palette: [], default: "#ABC", custom: { l: [0.1, 0.5], c: [0, 0.1] } })])).decl.groups[0].controls[0].default, "#aabbcc");
  assert.ok(errors(declWith(minimal([col({ palette: [sw("a")], default: "a", custom: { l: [0.6, 0.2], c: [0, 0.1] } })])).issues).includes("customize-field"), "an empty range");
  assert.ok(errors(declWith(minimal([col({ palette: Array.from({ length: 11 }, (_, i) => sw(`s${i}`)), default: "s0" })])).issues).includes("customize-limit"), "11 swatches");
});

test("reader: choices and toggles may set common --sk-* tokens only, each with a valid value (never a palette token, never a free variable)", () => {
  const choice = (tokens) => ({ id: "c", type: "choice", label: L("Choix", "Choice"), default: "a", values: [{ id: "a", label: L("A"), tokens: {} }, { id: "b", label: L("B"), tokens }] });
  assert.deepEqual(errors(declWith(minimal([choice({ "--sk-radius-card": "0.25rem" })])).issues), []);
  assert.ok(errors(declWith(minimal([choice({ "--sk-radius-card": "url(//x)" })])).issues).includes("customize-token"), "bad value");
  assert.ok(errors(declWith(minimal([choice({ "--v-bg": "#ffffff" })])).issues).includes("customize-token"), "palette tokens are not for choices");
  assert.ok(errors(declWith(minimal([choice({ "--sk-cz-x": "none" })])).issues).includes("customize-token"), "no free custom variable from a choice (a skin could hide content with it)");
  assert.ok(errors(declWith(minimal([choice({ "color": "red" })])).issues).includes("customize-token"), "not even a token name");
});

test("reader: sliders have a closed unit list and sane bounds; images need a way to choose a picture and a valid upload rule", () => {
  assert.deepEqual(errors(declWith(minimal([slider("s", { unit: "px" })])).issues), []);
  assert.ok(errors(declWith(minimal([slider("s", { unit: "vh" })])).issues).includes("customize-field"), "unit outside the list");
  assert.ok(errors(declWith(minimal([slider("s", { min: 5, max: 1 })])).issues).includes("customize-field"));
  assert.ok(errors(declWith(minimal([slider("s", { default: 99 })])).issues).includes("customize-field"));
  assert.ok(errors(declWith(minimal([slider("s", { step: 0 })])).issues).includes("customize-field"));
  assert.ok(errors(declWith(minimal([slider("s", { min: 0, max: 99999, step: 1 })])).issues).includes("customize-field"), "more than 1000 steps");
  const img = (extra) => ({ id: "p", type: "image", label: L("Image"), default: "none", ...extra });
  assert.ok(errors(declWith(minimal([img({})])).issues).includes("customize-field"), "nothing to choose from");
  const upload = { formats: ["png"], maxKb: 100, ratio: [16, 3], minPx: [100, 20], maxPx: [800, 150] };
  assert.deepEqual(errors(declWith(minimal([img({ upload })])).issues), []);
  assert.ok(errors(declWith(minimal([img({ upload: { ...upload, formats: ["exe"] } })])).issues).includes("customize-field"));
  assert.ok(errors(declWith(minimal([img({ upload: { ...upload, maxKb: 5000 } })])).issues).includes("customize-field"), "no skin sets its own size limit above the core's");
  assert.ok(errors(declWith(minimal([img({ upload: { ...upload, minPx: [900, 20] } })])).issues).includes("customize-field"));
  assert.ok(errors(declWith(minimal([img({ alternatives: [{ id: "a", file: "../../etc/passwd", label: L("A") }] })])).issues).includes("customize-asset"), "a path outside images/");
});

test("reader: a look names existing controls and allowed values, and cannot carry an upload", () => {
  const ok = declWith(minimal([slider("s")], { looks: [{ id: "big", label: L("Grand", "Big"), values: { s: 9 } }] }));
  assert.deepEqual(errors(ok.issues), []);
  assert.deepEqual(ok.decl.looks[0].values, { s: 9 });
  assert.ok(errors(declWith(minimal([slider("s")], { looks: [{ id: "x", label: L("X"), values: { nope: 1 } }] })).issues).includes("customize-look"), "unknown control");
  assert.ok(errors(declWith(minimal([slider("s")], { looks: [{ id: "x", label: L("X"), values: { s: "wide" } }] })).issues).includes("customize-look"), "value of the wrong type");
  assert.ok(errors(declWith(minimal([slider("s")], { looks: [{ id: "x", label: L("X"), values: {} }] })).issues).includes("customize-look"), "an empty look");
});

test("install check: a picture that is not a declared asset is refused, and the sheet and the declaration are compared (warnings only)", () => {
  const r = R.checkCustomizeAgainstSkin(decl, { contract: 4, imageFiles: new Set(["images/fanions.svg"]), css: "a{color:var(--sk-cz-banner)} b{color:var(--sk-cz-nope)}" });
  assert.ok(codes(r).includes("customize-asset"));
  assert.ok(codes(r).includes("customize-undeclared"));
  assert.ok(codes(r).includes("customize-unused"));
  assert.equal(r.filter((i) => i.code === "customize-undeclared" || i.code === "customize-unused").every((i) => i.severity === "warning"), true);
  assert.ok(codes(R.checkCustomizeAgainstSkin(decl, { contract: 3, imageFiles: new Set(), css: "" })).includes("customize-contract"));
});

// ── values ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ctl = (id) => decl.groups.flatMap((g) => g.controls).find((c) => c.id === id);
const raw = (values, look) => ({ v: 1, look, values });
const resolve = (values, ctx = {}) => V.resolveValues(decl, raw(values), { skinId: "customizable", version: "1.0.0", ...ctx });
const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";

test("values: defaults are always written, so an untouched skin is exactly what was shipped", () => {
  const r = resolve({});
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.vars.light["--sk-cz-banner"], "#16235a");
  assert.equal(r.vars.dark["--sk-cz-banner"], "#16235a");
  assert.equal(r.vars.light["--sk-cz-parchment"], "#f8f0dc");
  assert.equal(r.vars.dark["--sk-cz-parchment"], "#251e19");
  assert.equal(r.vars.light["--sk-cz-trim"], "#c9962f");
  assert.equal(r.vars.light["--sk-cz-corner"], "0.2rem");
  assert.equal(r.vars.light["--sk-cz-pennants"], 'url("/skins/customizable/1.0.0/images/fanions.svg")');
  assert.equal(r.vars.light["--sk-cz-banner-image"], "none");
  assert.equal(r.vars.light["--sk-cz-emblem"], 'url("/skins/customizable/1.0.0/images/ecu.svg")');
  assert.equal(r.vars.light["--sk-cz-emblem-size"], "contain");
  assert.equal(r.vars.light["--sk-cz-pennants-repeat"], "repeat");
  assert.deepEqual(resolve({}), resolve(undefined), "nothing stored and an empty store give the same result");
});

test("values: untouched, the composed skin is the shipped one and the only addition is the --sk-cz-* variables (both modes)", () => {
  const plain = composeSkin({ skin });
  const custom = V.resolveValues(decl, null, { skinId: "customizable", version: "1.0.0" });
  const withCustom = composeSkin({ skin, custom: { tokens: custom.tokens, vars: custom.vars, stills: custom.stills } });
  for (const [i, m] of plain.modes.entries()) {
    const extra = Object.keys(withCustom.modes[i].tokens).filter((k) => !(k in m.tokens));
    assert.ok(extra.length > 0 && extra.every((k) => k.startsWith("--sk-cz-")), extra.join());
    for (const [k, v] of Object.entries(m.tokens)) assert.equal(withCustom.modes[i].tokens[k], v, k);
  }
  const sheet = renderSheet(withCustom);
  assert.match(sheet, /--sk-cz-banner:#16235a/);
  assert.equal(renderSheet(withCustom), sheet, "deterministic");
  assert.match(renderTokens(withCustom), /@media \(prefers-color-scheme:dark\)/);
  assert.ok(!renderTokens(withCustom).includes("[data-skin-region"), "the token part only");
});

test("values: chosen values change only what they name, colours per mode, pictures as core-built URLs", () => {
  const r = resolve({ banner: "crimson", parchment: "aged", pennants: "gold", corner: 0.5, trim: "#aabbcc" });
  assert.deepEqual(r.changed.sort(), ["banner", "corner", "parchment", "pennants", "trim"]);
  assert.equal(r.vars.light["--sk-cz-banner"], "#5e1414");
  assert.equal(r.vars.dark["--sk-cz-banner"], "#4a1010");
  assert.equal(r.vars.light["--sk-cz-parchment"], "#ecdfbf");
  assert.equal(r.vars.dark["--sk-cz-parchment"], "#201a15");
  assert.equal(r.vars.light["--sk-cz-corner"], "0.5rem");
  assert.match(r.vars.light["--sk-cz-pennants"], /fanions-or\.svg/);
  assert.ok(/^#[0-9a-f]{6}$/.test(r.vars.light["--sk-cz-trim"]), "a free colour is written back as #rrggbb");
});

test("values: a free colour is pulled inside the range the skin declares (hue free), the dark value inside its own range", () => {
  const c = ctl("banner");
  const k = V.colorOf(c, "#ffffff");          // white is far above the allowed lightness 0.14 to 0.34
  assert.notEqual(k.light, "#ffffff");
  const k2 = V.colorOf(c, "#ff0000");         // very saturated red: chroma capped at 0.14
  assert.notEqual(k2.light, "#ff0000");
  assert.equal(V.colorOf(c, "#16235a").light, "#16235a", "inside the range: untouched, byte for byte");
  assert.equal(V.checkValue(c, "#FFFFFF", { allowUpload: false }).value, V.colorOf(c, "#ffffff").light, "stored already inside the range, lower case");
  const twice = V.checkValue(c, V.checkValue(c, "#ff8800", { allowUpload: false }).value, { allowUpload: false }).value;
  assert.equal(twice, V.checkValue(c, "#ff8800", { allowUpload: false }).value, "idempotent: saving again never drifts");
});

test("values: hostile values never reach a sheet (colours, ids, numbers, pictures)", () => {
  const evil = [
    "#fff;}body{display:none}", "red;background:url(//x)", "#12345", "#1234567", "#12345g", "javascript:alert(1)", "url(//evil.example/x.png)", "var(--x)", "expression(1)",
    "#ｆｆｆｆｆｆ", "#16235a\u0000", " #16235a", "#16235a ", "x".repeat(1_000_000), true, null, undefined, [], {}, ["#16235a"], { id: "royal" }, "__proto__", "constructor", "royal;color:red", "ROYAL",
  ];
  for (const v of evil) {
    const r = resolve({ banner: v, trim: v, parchment: v, pennants: v, corner: v });
    assert.deepEqual(r.changed, [], `${String(v).slice(0, 30)} must change nothing`);
    for (const m of ["light", "dark"]) for (const [n, val] of Object.entries(r.vars[m])) assert.ok(V.safeVar(n, val), `${n}: ${val}`);
  }
  // keys that are not controls never make a variable
  const r = resolve({ "__proto__": "#ffffff", constructor: 1, "--evil": "x", "a b": 1, "banner-size": "cover", toString: 3 });
  assert.equal(Object.keys(r.vars.light).filter((n) => !/^--sk-cz-(banner|pennants|banner-image|emblem|parchment|corner|trim)/.test(n)).length, 0);
  assert.ok(r.dropped.length >= 4, "unknown keys are ignored here and kept in storage");
  // numbers: NaN, Infinity, strings, and values outside the bounds
  for (const v of [NaN, Infinity, -Infinity, "1;x", "0.5rem", 1e308]) assert.equal(V.checkValue(ctl("corner"), v, { allowUpload: false }).ok === true && Number.isFinite(V.checkValue(ctl("corner"), v, { allowUpload: false }).value), v === 1e308, String(v));
  assert.equal(V.checkValue(ctl("corner"), 99, { allowUpload: false }).value, 1.5, "clamped to the maximum");
  assert.equal(V.checkValue(ctl("corner"), -3, { allowUpload: false }).value, 0, "clamped to the minimum");
  assert.equal(V.checkValue(ctl("corner"), 0.37, { allowUpload: false }).value, 0.35, "snapped to the step");
});

test("values: an uploaded picture is a server-made name, in the right shape, and only where a slot takes uploads", () => {
  const slot = ctl("emblem");
  const ok = V.checkValue(slot, { upload: `${UUID}.webp`, still: `${UUID2}.webp`, lum: [0.1, 0.9] }, { allowUpload: true });
  assert.equal(ok.ok, true);
  assert.equal(V.checkValue(slot, { upload: `${UUID}.webp` }, { allowUpload: false }).ok, false, "a look cannot carry an upload");
  assert.equal(V.checkValue(ctl("pennants"), { upload: `${UUID}.webp` }, { allowUpload: true }).ok, false, "a slot without upload takes none");
  for (const bad of [
    { upload: "../../etc/passwd.webp" }, { upload: `${UUID}.html` }, { upload: `${UUID}.gif` }, { upload: `${UUID}.jpg` }, { upload: "x.webp" }, { upload: `/uploads/${UUID}.webp` },
    { upload: `${UUID}.webp?x=1` }, { upload: `${UUID}.webp`, still: `${UUID2}.svg` }, { upload: `${UUID}.webp`, lum: [2, 3] }, { upload: `${UUID}.webp`, lum: [0.1] }, { upload: 5 }, { upl: 1 },
    { upload: `${UUID}.webp"); background: url(//x` },
  ]) assert.equal(V.checkValue(slot, bad, { allowUpload: true }).ok, false, JSON.stringify(bad));
  const r = resolve({ emblem: { upload: `${UUID}.webp`, still: `${UUID2}.webp` } });
  assert.equal(r.vars.light["--sk-cz-emblem"], `url("/uploads/${UUID}.webp")`);
  assert.deepEqual(r.stills, { "--sk-cz-emblem": `url("/uploads/${UUID2}.webp")` });
  const sheet = renderSheet(composeSkin({ skin, custom: { tokens: r.tokens, vars: r.vars, stills: r.stills } }));
  assert.match(sheet, /@media \(prefers-reduced-motion:reduce\)\{:root\[data-skin="customizable"\]\{--sk-cz-emblem:url\("\/uploads\/2/);
});

test("values: a missing file falls back to the skin's own picture and is reported", () => {
  const r = resolve({ emblem: { upload: `${UUID}.webp` } }, { fileExists: () => false });
  assert.deepEqual(r.missing, ["emblem"]);
  assert.match(r.vars.light["--sk-cz-emblem"], /ecu\.svg/);
});

test("values: a renamed control keeps its value through `was`; unknown keys are ignored; a wrong value is dropped and the default shows", () => {
  const renamed = structuredClone(decl);
  const trim = renamed.groups.flatMap((g) => g.controls).find((c) => c.id === "trim");
  trim.id = "metal"; trim.was = ["trim"];
  const r = V.resolveValues(renamed, raw({ trim: "silver", gone: 3, banner: "no-such-swatch" }), { skinId: "customizable", version: "1.0.0" });
  assert.equal(r.values.metal, "silver");
  assert.equal(r.vars.light["--sk-cz-metal"], "#9aa3ad");
  assert.deepEqual(r.dropped.sort(), ["banner", "gone"]);
  assert.equal(r.values.banner, "royal", "default");
  const bad = [null, "text", 5, [], { v: 2, values: {} }, { v: 1 }, { v: 1, values: [] }, { v: 1, values: "x" }];
  for (const b of bad) assert.doesNotThrow(() => V.resolveValues(decl, b, { skinId: "customizable", version: "1.0.0" }));
});

test("values: choices and toggles set common tokens, joined to the skin's token layer and checked again by the composer", () => {
  const d = declWith(minimal([
    { id: "round", type: "choice", label: L("Angles", "Corners"), default: "soft", values: [{ id: "soft", label: L("Doux", "Soft"), tokens: {} }, { id: "sharp", label: L("Vifs", "Sharp"), tokens: { "--sk-radius-card": "0" } }] },
    { id: "flat", type: "toggle", label: L("À plat", "Flat"), default: false, on: { "--sk-radius-button": "0" }, off: {} },
  ])).decl;
  const r = V.resolveValues(d, raw({ round: "sharp", flat: true }), { skinId: "customizable", version: "1.0.0" });
  assert.deepEqual(r.tokens, { "--sk-radius-card": "0", "--sk-radius-button": "0" });
  assert.equal(r.vars.light["--sk-cz-flat"], "1");
  const c = composeSkin({ skin, custom: { tokens: r.tokens, vars: r.vars, stills: r.stills } });
  assert.equal(c.modes[0].tokens["--sk-radius-card"], "0");
  assert.equal(V.resolveValues(d, raw({ flat: "yes" }), { skinId: "customizable", version: "1.0.0" }).tokens["--sk-radius-button"], undefined, "a toggle takes a boolean only");
});

test("variables: every variable name matches the family and every value has one of the exact shapes", () => {
  assert.ok(V.safeVar("--sk-cz-banner", "#16235a"));
  assert.ok(V.safeVar("--sk-cz-x", "0.5rem") && V.safeVar("--sk-cz-x", "-3px") && V.safeVar("--sk-cz-x", "12") && V.safeVar("--sk-cz-x", "50% 50%") && V.safeVar("--sk-cz-x", "none"));
  assert.ok(V.safeVar("--sk-cz-x", `url("/uploads/${UUID}.webp")`) && V.safeVar("--sk-cz-x", 'url("/skins/feodal/1.1.3/images/a.svg")'));
  for (const [n, v] of [
    ["--sk-cz-x", "#fff"], ["--sk-cz-x", "red"], ["--sk-cz-x", "#16235a;color:red"], ["--sk-cz-x", 'url("//x/y.png")'], ["--sk-cz-x", 'url("https://x/y.png")'], ["--sk-cz-x", "url(/uploads/a.webp)"],
    ["--sk-cz-x", `url("/uploads/${UUID}.gif")`], ["--sk-cz-x", 'url("/skins/a/1/images/../../x.svg")'], ["--sk-cz-x", "block"], ["--sk-cz-x", "1e9"], ["--sk-cz-x", "calc(1px)"], ["--sk-cz-x", ""],
    ["--v-bg", "#16235a"], ["--sk-color-link", "#16235a"], ["--sk-cz-", "#16235a"], ["--sk-cz-X", "#16235a"], ["--sk-cz-a;b", "#16235a"], ["color", "#16235a"],
  ]) assert.equal(V.safeVar(n, v), false, `${n}: ${v}`);
});

// ── legibility: a signal, never a correction ────────────────────────────────────────────────────────────────────────

const effective = (r) => { const c = composeSkin({ skin, custom: { tokens: r.tokens, vars: r.vars, stills: r.stills } }); return Object.fromEntries(c.modes.map((m) => [m.mode, m.tokens])); };

test("signal: nothing for the skin's own values, even if a declared pair is weak (that is the author's choice)", () => {
  const r = resolve({});
  assert.deepEqual(V.computeSignals(decl, r, effective(r)), []);
});

test("signal: a colour too pale for the declared text is reported per mode with the real ratio; the value is NOT changed", () => {
  const d = declWith(minimal([{ id: "bar", type: "color", label: L("Barre", "Bar"), default: "dark", contrast: [{ text: "#f8efd6", min: 4.5 }],
    palette: [{ id: "dark", label: L("Foncé", "Dark"), light: "#16235a", dark: "#16235a" }, { id: "pale", label: L("Pâle", "Pale"), light: "#c0c8ff", dark: "#305080" }] }])).decl;
  const r = V.resolveValues(d, raw({ bar: "pale" }), { skinId: "customizable", version: "1.0.0" });
  assert.equal(r.vars.light["--sk-cz-bar"], "#c0c8ff", "the value is applied as chosen: nothing is corrected");
  const s = V.computeSignals(d, r, { light: {}, dark: {} });
  assert.deepEqual(s.map((x) => x.mode), ["light"], "only the light mode is at risk: the dark swatch is fine");
  assert.equal(s[0].control, "bar");
  assert.equal(s[0].min, 4.5);
  assert.ok(s[0].ratio < 4.5 && s[0].ratio > 1, String(s[0].ratio));
  assert.deepEqual(V.computeSignals(d, V.resolveValues(d, null, { skinId: "customizable", version: "1.0.0" }), { light: {}, dark: {} }), [], "the default is the author's choice");
});

test("signal: a text colour taken from the skin's own palette (--v-fg, --v-muted) is read in the mode being checked", () => {
  const ivory = resolve({ parchment: "ivory" });
  assert.deepEqual(V.computeSignals(decl, ivory, effective(ivory)), [], "the ivory parchment keeps the text readable in both modes");
  const aged = resolve({ parchment: "aged" });
  const s = V.computeSignals(decl, aged, effective(aged));
  assert.deepEqual(s.map((x) => `${x.control}/${x.mode}`), ["parchment/light"], "secondary text on the aged parchment is a little low in the light mode only");
  assert.ok(s[0].ratio >= 4 && s[0].ratio < 4.5);
  // the same swatch with another palette of the skin: the signal follows the effective colours, not the colours declared by the author
  const eff = effective(ivory);
  eff.dark = { ...eff.dark, "--v-fg": "#2a221c" };
  assert.ok(V.computeSignals(decl, ivory, eff).some((x) => x.control === "parchment" && x.mode === "dark"));
});

test("signal: a colour that sits on the page (against) is compared with the page colour of each mode", () => {
  const near = resolve({ trim: "#d9d2c0" });   // the page colour of the light mode
  const eff = effective(near);
  const s = V.computeSignals(decl, near, eff);
  assert.ok(s.some((x) => x.control === "trim" && x.mode === "light" && x.ratio < 1.5), JSON.stringify(s));
});

test("signal: text over a picture, from the brightest or darkest part the upload measured", () => {
  const bright = resolve({ "banner-image": { upload: `${UUID}.webp`, lum: [0.7, 0.95] } });
  const s = V.computeSignals(decl, bright, effective(bright));
  assert.ok(s.some((x) => x.control === "banner-image"), JSON.stringify(s));
  const dark = resolve({ "banner-image": { upload: `${UUID}.webp`, lum: [0.01, 0.08] } });
  assert.deepEqual(V.computeSignals(decl, dark, effective(dark)).filter((x) => x.control === "banner-image"), []);
});

test("the stored size and the limits are what the documentation says", () => {
  assert.deepEqual(CUSTOMIZE_LIMITS, { groups: 5, perGroup: 7, controls: 24, featured: 2, looks: 8, choices: 10, segmented: 4, alternatives: 8, label: 40, hint: 60, contrastPairs: 4, was: 2, uploadFiles: 8, uploadBytes: 4 * 1024 * 1024, tokens: 12, storedBytes: 4096 });
});
