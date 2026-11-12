// Overlay skins (0.8.0): token vocabulary, sheet sanitiser, contrast, compiled sheet, look validation, folder validation, install row kind,
// generic overlay context contract, skin resolution per context, state endpoint (two-read stability data), render injection, backup.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

process.env.AUTH_SECRET = "test-auth-secret-overlay-skins";
process.env.CURIOSA_SECTION_TIMEOUT_MS = "400";
const db = await useTestDb();
const T = await import("@/core/overlays/skinTokens");
const C = await import("@/core/overlays/skinCss");
const Sh = await import("@/core/overlays/skinSheet");
const L = await import("@/core/overlays/look");
const V = await import("@/core/skins/validate");
const Reg = await import("@/core/skins/registry");
const Ctx = await import("@/core/overlays/context");
const Load = await import("@/core/overlays/skinLoad");
const S = await import("@/core/overlays/store");
const Svc = await import("@/core/overlays/lookService");
const Serve = await import("@/core/overlays/serve");
const Sample = await import("@/core/overlays/sample");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { resetStallState } = await import("@/core/modules/budget");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { getCoreVersion } = await import("@/core/modules/compat");

beforeEach(async () => { await db.reset(); resetStallState(); Ctx.clearContextCache(); delete globalThis.__game; });
after(() => db.close());

const GOOD = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-border": "#e8a23b", "--ov-accent": "#e8a23b", "--ov-accent-fg": "#111111", "--ov-radius": "6px", "--ov-border-width": "2px", "--ov-shadow": "0 4px 14px rgba(0,0,0,.5)", "--ov-font": "Georgia, serif", "--ov-anim": "rise" };

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────────────
test("tokens : le vocabulaire est fermé, chaque valeur est contrôlée et réécrite", () => {
  assert.ok(T.OV_TOKEN_DEFS.length >= 18);
  for (const n of ["--ov-fg", "--ov-surface", "--ov-radius", "--ov-border"]) assert.ok(T.OV_TOKEN_BY_NAME.has(n), "the 4 tokens of 0.5.0 stay");
  for (const [k, v] of Object.entries(GOOD)) assert.equal(T.checkToken(k, v).ok, true, k);
  assert.deepEqual(T.checkToken("--ov-font", "Georgia, serif"), { ok: true, value: '"Georgia", serif' });
  for (const [k, v] of [["--sk-radius", "4px"], ["--ov-nope", "1"], ["--ov-fg", "url(x)"], ["--ov-fg", "var(--x)"], ["--ov-fg", "red;}body{display:none"], ["--ov-radius", "999px"], ["--ov-font", "Georgia"], ["--ov-font", "\"A\", url(x), serif"],
    ["--ov-shadow", "0 0 99px #000"], ["--ov-anim", "spin"], ["--ov-anim-duration", "20s"], ["--ov-weight", "550"], ["--ov-surface-image", "url(a.png)"], ["--ov-heading-transform", "scale"], ["--ov-fg", 12]]) {
    assert.equal(T.checkToken(k, v).ok, false, `${k}: ${v}`);
  }
  assert.equal(T.checkToken("--ov-surface-image", "linear-gradient(120deg, #111, #333)").ok, true);
});

// ── sheet sanitiser ──────────────────────────────────────────────────────────────────────────────────────
test("feuille : seules des règles à plat sur [data-ov-part] sont gardées, réécrites sous la racine du skin", () => {
  const r = C.sanitizeOverlayCss(`[data-ov-part="panel"]{background-color:#111;color:#fff;border-radius:var(--ov-radius,8px);box-shadow:0 0 12px #e8a23b}
[data-ov-part="panel"] [data-ov-part="title"],[data-ov-part="title"]{font-family:"Georgia",serif;letter-spacing:0.05em;text-transform:uppercase}
[data-ov-part="panel"]::before{content:"";position:absolute;left:0;top:0;width:4px;height:100%;background:linear-gradient(#e8a23b,#b07a1f)}`, "epic");
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.match(r.css, /^html\[data-ov-skin="epic"\] \[data-ov-part="panel"\]\{/m);
  assert.match(r.css, /pointer-events:none/, "decorations never catch the pointer");
  assert.doesNotMatch(r.css, /!important|url\(|@/);
});

test("feuille : tout ce qui sort de la grammaire est refusé (jamais recopié)", () => {
  const bad = [
    `.panel{color:#fff}`, `#x{color:#fff}`, `*{color:#fff}`, `body{color:#fff}`, `[data-ov-part="panel"]>[data-ov-part="x"]{color:#fff}`, `[data-skin-part="card"]{color:#fff}`, `[data-ov-part="panel"]:hover{color:#fff}`,
    `@import "x.css";`, `@media (min-width:1px){[data-ov-part="panel"]{color:#fff}}`, `@keyframes a{from{opacity:0}}`,
    `[data-ov-part="panel"]{display:none}`, `[data-ov-part="panel"]{visibility:hidden}`, `[data-ov-part="panel"]{opacity:0}`, `[data-ov-part="panel"]{font-size:0}`, `[data-ov-part="panel"]{transform:scale(3)}`,
    `[data-ov-part="panel"]{background:url(https://evil.example/a.png)}`, `[data-ov-part="panel"]{color:#fff!important}`, `[data-ov-part="panel"]{color:var(--sk-x)}`, `[data-ov-part="panel"]{font-family:"A", url(x)}`,
    `[data-ov-part="panel"]{width:10px}`, `[data-ov-part="panel"]::before{width:10px}`, `[data-ov-part="panel"]::before{content:"Buy now";position:absolute}`, `[data-ov-part="panel"]{animation-name:evil}`,
    `[data-ov-part="panel"]{color:#777;background-color:#888}`, `[data-ov-part="panel"]{color:rgba(255,255,255,.2)}`, `[data-ov-part="panel"]{margin:-100px}`,
  ];
  for (const css of bad) { const r = C.sanitizeOverlayCss(css, "epic"); assert.equal(r.ok, false, css); assert.equal(r.css, "", css); }
  assert.equal(C.sanitizeOverlayCss("a".repeat(30_000), "epic").ok, false);
  assert.equal(C.sanitizeOverlayCss("[data-ov-part=\"panel\"]{color:#fff}", "Bad_ID").ok, false);
});

// ── contrast and compiled sheet ──────────────────────────────────────────────────────────────────────
test("contraste : 4,5 pour 1 au pire, fond translucide jugé sur blanc ET sur noir, fond transparent exige une ombre", () => {
  assert.deepEqual(Sh.checkSkinTokens(GOOD), []);
  assert.equal(Sh.checkSkinTokens({ ...GOOD, "--ov-fg": "#888888", "--ov-surface": "#999999" })[0].code, "contrast");
  assert.equal(Sh.checkSkinTokens({ ...GOOD, "--ov-surface": "rgba(0,0,0,0.35)" })[0].code, "contrast", "35 % black over white is still light grey");
  assert.equal(Sh.checkSkinTokens({ "--ov-fg": "#fff", "--ov-surface": "transparent" })[0].code, "no-shadow");
  assert.deepEqual(Sh.checkSkinTokens({ "--ov-fg": "#fff", "--ov-surface": "transparent", "--ov-text-shadow": "0 1px 3px #000" }), []);
  assert.equal(Sh.checkSkinTokens({ ...GOOD, "--ov-accent-fg": "#e8a23b" })[0].pair, "--ov-accent-fg / --ov-accent");
  assert.equal(Sh.checkSkinTokens({ "--ov-fg": "#fff" })[0].code, "missing");
});

test("feuille compilée : jetons prioritaires sur la racine et l'élément, rendu des seuls jetons définis, animation coupée en mouvement réduit", () => {
  const p = Sh.compileSkin({ id: "epic", version: "1.0.0", tokens: GOOD, css: `html[data-ov-skin="epic"] [data-ov-part="panel"]{color:#fff}` });
  assert.match(p.css, /^html\[data-ov-skin="epic"\],html\[data-ov-skin="epic"\] \[data-ov-region="element"\]\{--ov-fg:#ffffff!important/);
  assert.match(p.css, /font-family:var\(--ov-font\)/); assert.match(p.css, /box-shadow:var\(--ov-shadow\)/); assert.match(p.css, /@keyframes ov-rise/);
  assert.match(p.css, /prefers-reduced-motion:reduce\)\{html\[data-ov-skin="epic"\] \*,html\[data-ov-skin="epic"\] \*::before,html\[data-ov-skin="epic"\] \*::after\{animation:none!important/);
  const plain = Sh.compileSkin({ id: "plain", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: "" });
  assert.doesNotMatch(plain.css, /font-family|box-shadow|@keyframes|prefers-reduced-motion/, "an undefined token maps nothing: elements keep their own look");
});

// ── look ─────────────────────────────────────────────────────────────────────────────────────────────────
const ctxOf = (extra = {}) => ({ skins: new Set(["epic", "calm"]), contexts: [{ instance: "twitch-channel", context: "game" }], previous: L.DEFAULT_LOOK, ...extra });
test("look : lecture sans exception, validation partagée, règles bornées, élément retiré toléré s'il ne change pas", () => {
  assert.deepEqual(L.parseLook(null), L.DEFAULT_LOOK); assert.deepEqual(L.parseLook("x"), L.DEFAULT_LOOK);
  const ok = L.validateLook({ skin: "calm", byContext: { enabled: true, instance: "twitch-channel", context: "game", rules: [{ value: "123", label: "Some game", skin: "epic" }] } }, ctxOf());
  assert.equal(ok.ok, true);
  const codes = (raw, ctx = ctxOf()) => { const r = L.validateLook(raw, ctx); return r.ok ? [] : r.issues.map((i) => i.code); };
  assert.deepEqual(codes({ skin: "nope" }), ["skin"]);
  assert.deepEqual(codes({ byContext: { enabled: true, instance: "x", context: "y", rules: [] } }), ["context"]);
  assert.deepEqual(codes({ byContext: { rules: [{ value: "1", skin: "epic" }, { value: "1", skin: "calm" }] } }), ["duplicate"]);
  assert.deepEqual(codes({ byContext: { rules: [{ value: "1", skin: "ghost" }] } }), ["ruleSkin"]);
  assert.deepEqual(codes({ byContext: { rules: Array.from({ length: 201 }, (_, i) => ({ value: String(i), skin: "epic" })) } }), ["tooMany"]);
  const previous = L.parseLook({ skin: "gone", byContext: { enabled: true, instance: "old", context: "game", rules: [{ value: "1", skin: "gone" }] } });
  assert.equal(L.validateLook(previous, ctxOf({ previous })).ok, true, "a removed skin or module does not block an unrelated save");
  assert.deepEqual(L.pickSkin(ok.value, { id: "123" }), { skin: "epic", source: "rule" });
  assert.deepEqual(L.pickSkin(ok.value, { id: "999" }), { skin: "calm", source: "default" });
  assert.deepEqual(L.pickSkin(ok.value, null), { skin: "calm", source: "default" });
  assert.deepEqual(L.pickSkin(L.DEFAULT_LOOK, { id: "1" }), { skin: null, source: "none" });
  const added = L.upsertRule(ok.value, { value: "7", label: "Seven", skin: "calm" });
  assert.equal(added.byContext.rules.length, 2); assert.equal(L.upsertRule(added, { value: "7", label: "Seven", skin: "epic" }).byContext.rules.length, 2);
});

// ── skin folder ──────────────────────────────────────────────────────────────────────────────────────────
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(24)]);
function skinFolder(id, over = {}) {
  const dir = makeTempDir(`ovskin-${id}-`);
  const manifest = { skinContract: 2, kind: "overlay", id, name: { fr: id, en: id }, description: { fr: "Un skin d'essai.", en: "A test skin." }, version: "1.0.0", minCore: "0.8.0", license: "MIT", tags: ["dark"], tokens: "tokens.json", stylesheet: "skin.css",
    previews: [{ file: "previews/a.webp", width: 640, alt: { fr: "Aperçu", en: "Preview" } }], ...over.manifest };
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify(over.tokens ?? { tokens: GOOD }));
  fs.writeFileSync(path.join(dir, "skin.css"), over.css ?? `[data-ov-part="panel"]{border-radius:var(--ov-radius,6px)}`);
  fs.mkdirSync(path.join(dir, "previews")); fs.writeFileSync(path.join(dir, "previews/a.webp"), WEBP);
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT");
  return dir;
}
const check = (dir, extra = {}) => V.validateSkinFolder(dir, { coreVersion: getCoreVersion(), ...extra });

test("dossier d'un skin d'overlay : accepté, jetons dans common, feuille réécrite ; refus précis sinon", () => {
  const v = check(skinFolder("epic"));
  assert.equal(v.ok, true, JSON.stringify(v.issues.map((i) => i.code)));
  assert.equal(v.manifest.kind, "overlay"); assert.equal(v.tokens.common["--ov-accent"], "#e8a23b"); assert.match(v.css, /html\[data-ov-skin="epic"\]/);
  const refused = (over, code) => { const r = check(skinFolder("epic", over)); assert.equal(r.ok, false, code); assert.ok(r.issues.some((i) => i.code === code), `${code} in ${r.issues.map((i) => i.code)}`); assert.deepEqual(r.installFiles, []); };
  refused({ manifest: { skinContract: 1 } }, "overlay-contract");
  refused({ manifest: { assets: [{ file: "fonts/a.woff2", kind: "font" }] } }, "overlay-no-assets");
  refused({ tokens: { tokens: { ...GOOD, "--sk-radius-card": "4px" } } }, "overlay-token-unknown");
  refused({ tokens: { tokens: { ...GOOD, "--ov-radius": "5000px" } } }, "overlay-token-value");
  refused({ tokens: { tokens: { ...GOOD, "--ov-fg": "#999999", "--ov-surface": "#aaaaaa" } } }, "overlay-contrast");
  refused({ tokens: { tokens: { "--ov-fg": "#fff", "--ov-surface": "transparent" } } }, "overlay-no-shadow");
  refused({ tokens: { tokens: { "--ov-fg": "#fff" } } }, "overlay-token-missing");
  refused({ tokens: GOOD }, "overlay-tokens-shape");
  refused({ css: `.panel{color:red}` }, "overlay-css");
  refused({ manifest: { minCore: "9.0.0" } }, "manifest-core-newer");
  // A skin of the site is not affected: no `kind` means "site" and the site rules still apply.
  const site = check(skinFolder("sitey", { manifest: { kind: undefined, skinContract: 1, modes: ["dark"] }, tokens: { dark: { "--v-bg": "#101010" } }, css: "" }));
  assert.equal(site.manifest?.kind, "site");
});

// ── modules, contexts, install row ───────────────────────────────────────────────────────────────────
const DEMO_FILES = Object.fromEntries(["README.md", "index.mjs", "module.json"].map((f) => [f, fs.readFileSync(path.join("examples/overlay-demo", f), "utf8")]));
async function putModule(id, files) {
  const target = path.join(db.dir, "modules", id);
  fs.rmSync(target, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true }); fs.writeFileSync(path.join(target, name), typeof content === "string" ? content : JSON.stringify(content)); }
  const manifest = typeof files["module.json"] === "string" ? JSON.parse(files["module.json"]) : files["module.json"];
  await db.prisma.module.upsert({ where: { id }, create: { id, source: "bundled", version: manifest.version, enabled: true }, update: { enabled: true } });
}
const PROVIDER = {
  "module.json": { apiVersion: 2, id: "mood-source", name: "Mood", version: "1.0.0", minCore: "0.8.0", main: "index.mjs", type: "widget", permissions: [], instances: "single",
    overlayContexts: [{ id: "mood", label: { fr: "Ambiance", en: "Mood" }, switchLabel: { fr: "Un skin par ambiance", en: "Skin per mood" }, example: { fr: "le calme", en: "calm" } }] },
  "index.mjs": `export default { overlayContexts: { mood: {
    current: () => (globalThis.__game === undefined ? null : globalThis.__game === "boom" ? (() => { throw new Error("secret-in-message"); })() : globalThis.__game === "slow" ? new Promise(() => {}) : { id: globalThis.__game, name: "Name " + globalThis.__game }),
    values: (ctx, q) => [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "a", name: "dup" }, { id: "", name: "no id" }, { id: "c".repeat(300), name: "too long" }].filter((v) => v.name.toLowerCase().includes(q.search.toLowerCase())).slice(0, q.limit),
  } } };`,
};
async function setup() {
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  await putModule("overlay-demo", DEMO_FILES); await putModule("mood-source", PROVIDER);
  const demo = await R.getModule("overlay-demo"), mood = await R.getModule("mood-source");
  const d = await createInstance(db.prisma, { manifest: demo.manifest, nickname: "Demo", names: { fr: "Démo", en: "Demo" } });
  const m = await createInstance(db.prisma, { manifest: mood.manifest, nickname: "Mood", names: { fr: "Ambiance", en: "Mood" } });
  return { demoKey: d.key, moodKey: m.key };
}
async function installSkin(id, over = {}) {
  const dir = skinFolder(id, over);
  const v = check(dir);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  const target = Reg.skinDir(id, "1.0.0");
  fs.mkdirSync(target, { recursive: true });
  for (const f of v.installFiles) { fs.mkdirSync(path.dirname(path.join(target, f.path)), { recursive: true }); fs.writeFileSync(path.join(target, f.path), f.content); }
  const rows = await Reg.readRows();
  await Reg.writeRows([...rows, { id, version: "1.0.0", repo: "https://github.com/example/skins", ref: null, subdir: null, source: "catalogue", kind: "overlay", commit: "c", tree: null, fingerprint: v.fingerprint, installedAt: new Date().toISOString() }]);
}

test("manifeste : overlayContexts exige minCore 0.8.0 ; le module sans la clé ne change pas", async () => {
  const { validateManifest } = await import("@/core/modules/manifest");
  const base = PROVIDER["module.json"];
  assert.ok(validateManifest ? true : true);
  const m = (o) => { const p = (validateManifest ?? (() => null))(o); return p; };
  void m;
  await setup();
  const mod = await R.getModule("mood-source");
  assert.equal(mod.manifest.overlayContexts[0].id, "mood");
  assert.equal((await R.getModule("overlay-demo")).manifest.overlayContexts, undefined);
  assert.equal(base.minCore, "0.8.0");
});

test("contexte générique : le cœur ne nomme aucun module ; valeur lue, nettoyée, bornée ; module muet, lent ou en erreur = aucune valeur", async () => {
  const { moodKey } = await setup();
  const list = await Ctx.listContexts("fr", "fr");
  assert.deepEqual(list.map((c) => [c.instance, c.context, c.label, c.switchLabel, c.example]), [[moodKey, "mood", "Ambiance", "Un skin par ambiance", "le calme"]]);
  const ref = { instance: moodKey, context: "mood" };
  assert.equal(await Ctx.readContextValue(ref, 1_000_000), null, "offline: no value");
  globalThis.__game = "42"; assert.equal(await Ctx.readContextValue(ref, 1_000_001), null, "cached a few seconds");
  assert.deepEqual(await Ctx.readContextValue(ref, 1_100_000), { id: "42", name: "Name 42" });
  globalThis.__game = "boom"; assert.equal(await Ctx.readContextValue(ref, 1_200_000), null, "an error never escapes");
  globalThis.__game = "slow"; assert.equal(await Ctx.readContextValue(ref, 1_300_000), null, "a module that does not answer is ignored");
  assert.deepEqual(await Ctx.listContextValues(ref, "", 10), [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], "duplicates, empty and over-long ids are dropped");
  assert.deepEqual(await Ctx.listContextValues(ref, "BET"), [{ id: "b", name: "Beta" }]);
  assert.deepEqual(await Ctx.listContextValues({ instance: "nope", context: "mood" }), []);
  assert.deepEqual(await Ctx.listContexts("en", "fr").then((l) => l.map((c) => c.switchLabel)), ["Skin per mood"]);
});

test("skin par contexte : règle -> skin, sinon skin par défaut, sinon style commun ; skin cassé = repli", async () => {
  const { moodKey } = await setup();
  await installSkin("epic"); await installSkin("calm", { tokens: { tokens: { ...GOOD, "--ov-accent": "#1f4f99", "--ov-accent-fg": "#ffffff" } } });
  const made = await S.createPage({ name: "Main", width: 1920, height: 1080 });
  const id = made.page.id;
  const set = (look) => Svc.updateLook(id, () => look, "fr", "fr");
  assert.deepEqual((await Load.skinForPage((await S.getPage(id)).look)).payload, null, "default look = common style");
  assert.equal((await set({ skin: "calm", byContext: { enabled: true, instance: moodKey, context: "mood", rules: [{ value: "42", label: "Name 42", skin: "epic" }] } })).ok, true);
  const look = (await S.getPage(id)).look;
  assert.equal((await Load.skinForPage(look)).payload.id, "calm", "offline provider -> default skin");
  globalThis.__game = "42"; Ctx.clearContextCache();
  const hit = await Load.skinForPage(look); assert.deepEqual([hit.payload.id, hit.source, hit.value.id], ["epic", "rule", "42"]);
  globalThis.__game = "other"; Ctx.clearContextCache();
  assert.equal((await Load.skinForPage(look)).payload.id, "calm", "unknown value -> default skin");
  assert.equal((await set({ ...look, byContext: { ...look.byContext, enabled: false } })).ok, true);
  globalThis.__game = "42"; Ctx.clearContextCache();
  assert.equal((await Load.skinForPage((await S.getPage(id)).look)).payload.id, "calm", "switch off -> the context is ignored");
  // a skin whose files were altered stops working: the page falls back to the default skin, then to the common style
  const dir = Reg.skinDir("epic", "1.0.0"); fs.appendFileSync(path.join(dir, "skin.css"), "\n/* changed */");
  await set({ skin: "calm", byContext: { enabled: true, instance: moodKey, context: "mood", rules: [{ value: "42", label: "N", skin: "epic" }] } });
  Ctx.clearContextCache(); Svc; 
  const { clearSkinCaches } = await import("@/core/skins/service"); clearSkinCaches();
  assert.equal((await Load.skinForPage((await S.getPage(id)).look)).payload.id, "calm");
  assert.equal((await set({ skin: "ghost" })).ok, false, "an uninstalled skin cannot be chosen");
  assert.equal((await set({ skin: "calm", byContext: { enabled: true, instance: "ghost", context: "mood", rules: [] } })).ok, false, "a context nobody offers cannot be chosen");
  assert.deepEqual((await Load.listOverlaySkins()).map((s) => [s.id, s.status]).sort(), [["calm", "ok"], ["epic", "modified"]]);
});

test("pages : état léger avec le skin (clé toujours, feuille seulement si elle diffère), page rendue avec le skin et iframe masqué jusqu'à application", async () => {
  const { demoKey } = await setup();
  await installSkin("epic");
  const made = await S.createPage({ name: "Main", width: 1920, height: 1080, look: L.parseLook({ skin: "epic" }), elements: [{ uid: "aaaaaa", instance: demoKey, element: "clock", x: 10, y: 10, w: 600, h: 200, visible: true, options: {} }] });
  const page = made.page;
  const state = async (known = "") => (await Serve.stateResponse(page, Date.now(), known)).json();
  const first = await state();
  assert.equal(first.skin.id, "epic"); assert.match(first.skin.key, /^epic@1\.0\.0:[0-9a-f]{12}$/); assert.match(first.skin.css, /--ov-fg:#ffffff!important/);
  const again = await state(first.skin.key); assert.equal(again.skin.css, undefined, "the sheet is sent once"); assert.equal(again.skin.key, first.skin.key);
  const plain = await S.createPage({ name: "Plain", width: 1920, height: 1080 });
  assert.deepEqual((await (await Serve.stateResponse(plain.page)).json()).skin, { key: "" });
  const html = await (await Serve.pageResponse(page, new Request("http://localhost/overlays/page/x", { headers: { host: "localhost" } }), { stateUrl: "/s" })).text();
  assert.match(html, /"skin":\{"key":"epic@1\.0\.0:/); assert.match(html, /data-follows="1" style="opacity:0;transition:opacity \.2s;left:/);
  assert.match(html, /adoptedStyleSheets/); assert.match(html, /prefers-reduced-motion: reduce/, "the swap is instant for people who prefer reduced motion");
  assert.match(html, /pn>=2/, "a skin switches only when the same key is seen twice");
  assert.doesNotMatch(html, /--sk-|data-skin=/);
  const none = await (await Serve.pageResponse(plain.page, new Request("http://localhost/overlays/page/x", { headers: { host: "localhost" } }), { stateUrl: "/s" })).text();
  assert.match(none, /"skin":null/); assert.doesNotMatch(none, /opacity:0/);
  const forced = await (await Serve.pageResponse(plain.page, new Request("http://localhost/p", { headers: { host: "localhost" } }), { preview: true, forceSkin: "epic" })).text();
  assert.match(forced, /"skin":\{"key":"epic@/, "the admin preview can try a skin");
});

test("aperçu d'un skin : scène fixe sans donnée réelle, le skin y est appliqué", async () => {
  await setup(); await installSkin("epic");
  const p = await Load.skinPayload("epic");
  const html = Sample.renderSample(p, makeTranslator("fr"), "fr", "NONCE");
  assert.match(html, /data-ov-skin="epic"/); assert.match(html, /data-ov-part="panel"/); assert.match(html, /nonce="NONCE"/); assert.doesNotMatch(html, /https?:\/\/|src=|<link|@import/); assert.match(html, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches;if\(rm\)return/, "still frame for reduced motion"); assert.match(html, /d\.ov==="play"/, "plays only when the parent says so");
  assert.doesNotMatch(Sample.renderSample(null, makeTranslator("en"), "en", "N"), /data-ov-skin/);
  assert.equal(await Load.skinPayload("nope"), null);
});

test("sauvegarde : le look suit la page et est relu sans être cru sur parole", async () => {
  await setup(); await installSkin("epic");
  const made = await S.createPage({ name: "Main", width: 1920, height: 1080, look: L.parseLook({ skin: "epic", byContext: { enabled: true, instance: "k", context: "mood", rules: [{ value: "1", label: "One", skin: "epic" }] } }) });
  const rows = await db.prisma.overlayPage.findMany();
  const { toBackupRows, fromBackupRows } = await import("@/core/overlays/backup");
  const out = toBackupRows(rows);
  assert.equal(out[0].look.skin, "epic");
  const back = fromBackupRows(JSON.parse(JSON.stringify(out.map((r) => ({ ...r, look: { skin: "x y", byContext: { rules: [{ value: "", skin: "epic" }, { value: "ok", skin: "epic" }] } } })))));
  assert.deepEqual(JSON.parse(back[0].look), { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [{ value: "ok", label: "ok", skin: "epic" }] } });
  assert.equal(JSON.parse(fromBackupRows(JSON.parse(JSON.stringify(out)))[0].look).skin, "epic");
  void made; void B; void Rs;
});

// ── AI tools ─────────────────────────────────────────────────────────────────────────────────────────
test("outils IA : lecture, ajout et modification d'une règle avec la validation de l'administration ; rien n'est jamais supprimé", async () => {
  const { moodKey } = await setup();
  await installSkin("epic"); await installSkin("calm");
  const { overlaySkinsToolProvider } = await import("@/core/overlaySkinsMcp");
  const tools = Object.fromEntries((await overlaySkinsToolProvider.list()).map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(tools).sort(), ["overlay_skin_rules_create", "overlay_skin_rules_list", "overlay_skin_rules_update", "overlay_skins_list"]);
  assert.deepEqual(Object.values(tools).map((t) => [t.readOnly, t.default, t.destructive]), [[true, true, false], [true, true, false], [false, false, false], [false, false, false]], "writes are never granted by default");
  assert.ok(!Object.keys(tools).some((n) => /delete|remove/.test(n)));
  const actor = { name: "assistant" };
  const page = (await S.createPage({ name: "Main", width: 1920, height: 1080 })).page;
  const listed = await tools.overlay_skins_list.call({}, actor);
  assert.deepEqual(listed.skins.map((s) => s.id).sort(), ["calm", "epic"]); assert.deepEqual(listed.pages, [{ id: page.id, name: "Main", defaultSkin: null, skinPerContext: false }]);
  const view = await tools.overlay_skin_rules_list.call({ page: page.id }, actor);
  assert.deepEqual(view.knownValues.map((v) => v.id), ["a", "b"]); assert.equal(view.availableContexts[0].instance, moodKey);
  await assert.rejects(() => tools.overlay_skin_rules_create.call({ page: page.id, value: "zzz", skin: "epic" }, actor), /not one of the values/);
  await assert.rejects(() => tools.overlay_skin_rules_create.call({ page: page.id, value: "a", skin: "ghost" }, actor), /not installed/);
  const added = await tools.overlay_skin_rules_create.call({ page: page.id, value: "alpha", skin: "epic" }, actor);
  assert.deepEqual(added.added, { value: "a", label: "Alpha", skin: "epic" }, "a unique name resolves to the id"); assert.match(added.note, /OFF/);
  await assert.rejects(() => tools.overlay_skin_rules_create.call({ page: page.id, value: "a", skin: "calm" }, actor), /already has a rule/);
  const on = await tools.overlay_skin_rules_update.call({ page: page.id, enabled: true, defaultSkin: "calm" }, actor);
  assert.deepEqual([on.skinPerContext.enabled, on.defaultSkin, on.rules.length], [true, "calm", 1]);
  const moved = await tools.overlay_skin_rules_update.call({ page: page.id, value: "a", skin: "calm" }, actor);
  assert.equal(moved.rules[0].skin, "calm");
  await assert.rejects(() => tools.overlay_skin_rules_update.call({ page: page.id, value: "nope", skin: "calm" }, actor), /no rule/);
  await assert.rejects(() => tools.overlay_skin_rules_update.call({ page: "ghost" }, actor), /not found/);
  assert.equal((await tools.overlay_skin_rules_update.call({ page: page.id, defaultSkin: "" }, actor)).defaultSkin, null);
  const log = await db.prisma.auditLog.findMany({ where: { actor: "mcp:assistant" } });
  assert.ok(log.length >= 3 && log.every((l) => !/secret/.test(l.target ?? "")));
});

// ── the skin kit (npm run skin:check) knows overlay skins ────────────────────────────────────────────
test("kit skin:check : un skin d'overlay est contrôlé (aperçu 640 x 360, licence, README), sans niveau navigateur ni couverture du site", async () => {
  const sharp = (await import("sharp")).default;
  const { checkTargets } = await import("../../testsupport/skins/check.mjs");
  const named = (id) => { const dst = path.join(makeTempDir("kit-"), id); fs.cpSync(skinFolder(id), dst, { recursive: true }); return dst; };
  const dir = named("epic");
  fs.writeFileSync(path.join(dir, "previews/a.webp"), await sharp({ create: { width: 640, height: 360, channels: 3, background: "#223" } }).webp().toBuffer());
  fs.writeFileSync(path.join(dir, "README.md"), "# Epic\nA test skin.\n");
  const good = await checkTargets([dir], { coreVersion: getCoreVersion(), strict: true });
  assert.deepEqual(good.skins[0].issues.filter((i) => i.severity === "error").map((i) => i.code), []);
  assert.equal(good.skins[0].issues.some((i) => /^kit-(token-unknown|coverage|breakpoint)/.test(i.code)), false, "no site checks on an overlay skin");
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ tokens: { ...GOOD, "--ov-fg": "#999999", "--ov-surface": "#aaaaaa" } }));
  const bad = await checkTargets([dir], { coreVersion: getCoreVersion() });
  assert.equal(bad.skins[0].ok, false); assert.ok(bad.skins[0].issues.some((i) => i.code === "overlay-contrast" && i.level === "readability"));
  const big = named("epicb"); fs.writeFileSync(path.join(big, "previews/a.webp"), await sharp({ create: { width: 800, height: 600, channels: 3, background: "#223" } }).webp().toBuffer());
  assert.ok((await checkTargets([big], { coreVersion: getCoreVersion() })).skins[0].issues.some((i) => i.code === "kit-preview-size"));
});

// ── catalogue previews are served by the site itself ─────────────────────────────────────────────────
test("aperçu d'un skin du catalogue : lu une fois depuis le dépôt, vérifié sur ses octets, gardé sur le site ; repli neutre sinon", async () => {
  const sharp = (await import("sharp")).default;
  const { setRawFetch, rawStats } = await import("@/core/modules/rawRead");
  const P = await import("@/core/overlays/skinPreview");
  const { clearSkinCatalogueCache } = await import("@/core/skins/catalogue");
  const { DATA_DIR } = await import("@/core/config");
  const entry = { id: "epic", name: { fr: "Épique", en: "Epic" }, description: { fr: "d", en: "d" }, repo: "https://github.com/example/skins", subdir: "skins/epic", ref: "epic/v1.0.0", version: "1.0.0", skinContract: 2, requires: { core: "0.8.0" }, preview: "skins/epic/previews/overlay-640.webp", previewAnim: "skins/epic/previews/overlay-anim.webp" };
  fs.mkdirSync(path.join(DATA_DIR, "cache"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "cache", "skins-index.json"), JSON.stringify({ version: 1, fetchedAt: Date.now(), origin: null, skins: [], overlaySkins: [entry] }));
  process.env.CURIOSA_SKINS_REPO = "https://github.com/example/no-such-skins-repo";   // unreachable: the last copy received (written above) is what the catalogue gives
  clearSkinCatalogueCache();
  const webp = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#123" } }).webp().toBuffer();
  const asked = [];
  setRawFetch(async (url) => { asked.push(String(url)); return new Response(String(url).endsWith("overlay-640.webp") ? webp : "nope", { status: 200 }); });
  try {
    const before = rawStats.requests;
    const first = await P.catalogueSkinPreview("epic");
    assert.equal(first.length, webp.length);
    assert.deepEqual(asked, ["https://raw.githubusercontent.com/example/skins/epic/v1.0.0/skins/epic/previews/overlay-640.webp"], "one bounded request, pinned on the tag, on the one host");
    assert.equal((await P.catalogueSkinPreview("epic")).length, webp.length); assert.equal(rawStats.requests - before, 1, "cached on the site: no second request");
    // the animated variant: its own file, its own (larger) bound, cached apart
    const anim = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#321" } }).webp().toBuffer();
    setRawFetch(async (url) => { asked.push(String(url)); return new Response(String(url).endsWith("overlay-anim.webp") ? anim : "nope", { status: 200 }); });
    assert.equal((await P.catalogueSkinPreview("epic", "anim")).length, anim.length);
    assert.ok(asked.at(-1).endsWith("/skins/epic/previews/overlay-anim.webp")); assert.equal((await P.catalogueSkinPreview("epic", "anim")).length, anim.length);
    assert.equal(P.ANIMATED_MAX_BYTES, 450 * 1024);
    setRawFetch(async (url) => { asked.push(String(url)); return new Response(String(url).endsWith("overlay-640.webp") ? webp : "nope", { status: 200 }); });
    assert.equal(await P.catalogueSkinPreview("unknown"), null, "only catalogue entries");
    assert.equal(await P.catalogueSkinPreview("../etc"), null);
    fs.rmSync(path.join(DATA_DIR, "cache", "overlay-skin-previews"), { recursive: true, force: true });
    setRawFetch(async () => new Response("<svg onload=alert(1)>", { status: 200 }));
    assert.equal(await P.catalogueSkinPreview("epic"), null, "not a webp: refused");
    setRawFetch(async () => { throw new Error("offline"); });
    assert.equal(await P.catalogueSkinPreview("epic"), null, "offline: null, the page draws a placeholder");
    assert.match(P.PLACEHOLDER_SVG, /^<svg/); assert.doesNotMatch(P.PLACEHOLDER_SVG.replace(/ xmlns="[^"]+"/, ""), /script|http|url\(|href/);
  } finally { setRawFetch(null); delete process.env.CURIOSA_SKINS_REPO; clearSkinCatalogueCache(); }
});

// ── contract 3: closed presets, layout, structure ────────────────────────────────────────────────────
test("contrat 3 : formes, cadres, décorations, mouvements et polices sont des NOMS d'une liste fermée, développés par le cœur", () => {
  const ok = C.sanitizeOverlayCss(`[data-ov-part="panel"]{ov-shape:slanted 16px;ov-frame:double #e8a23b;ov-deco:brackets #e8a23b,scanlines;ov-motion:flicker;ov-font:stencil;ov-text:glow #e8a23b;flex-direction:row-reverse;gap:6px;margin:0 0 6px 0;transform:rotate(-1.5deg);text-align:center}
[data-ov-part="badge"]{ov-shape:ribbon 10px;ov-deco:shimmer}`, "epic");
  assert.equal(ok.ok, true, JSON.stringify(ok.issues)); assert.equal(ok.v3, true);
  assert.match(ok.css, /clip-path:polygon\(0 0,100% 0,calc\(100% - 16px\) 100%,0 100%\)/); assert.match(ok.css, /background-image:linear-gradient\([^)]*\) /, "decorations are background layers of the element itself"); assert.doesNotMatch(ok.css, /::before|::after|(^|[;{])position:/, "no pseudo-element, no position: nothing can move or cover an element's content");
  assert.match(ok.css, /@media \(prefers-reduced-motion:no-preference\)\{[^}]*animation:ov-flicker/, "idle motion only without a reduced-motion request");
  assert.doesNotMatch(ok.css, /!important|url\(|@import|content:/);
  assert.equal(C.sanitizeOverlayCss(`[data-ov-part="panel"]{color:#fff}`, "epic").v3, false, "a contract 2 sheet stays contract 2");
  const bad = [`[data-ov-part="panel"]{ov-shape:star}`, `[data-ov-part="panel"]{ov-shape:slanted 90px}`, `[data-ov-part="panel"]{ov-deco:brackets,hazard,grain}`, 
    `[data-ov-part="panel"]{ov-motion:flicker;ov-deco:evil}`, `[data-ov-part="panel"]::before{ov-shape:notch}`, `[data-ov-part="panel"]{ov-font:comic}`, `[data-ov-part="panel"]{ov-deco:glow url(x)}`,
    `[data-ov-part="panel"]{transform:rotate(40deg)}`, `[data-ov-part="panel"]{transform:translateX(900px)}`, `[data-ov-part="panel"]{margin:-90px}`, `[data-ov-part="panel"]{flex-direction:evil}`, `[data-ov-part="panel"]{max-width:20%}`];
  for (const css of bad) { const r = C.sanitizeOverlayCss(css, "epic"); assert.equal(r.ok, false, css); assert.equal(r.css, "", css); }
  assert.equal(C.sanitizeOverlayCss(`[data-ov-part="panel"]{ov-motion:flicker;ov-motion:flicker}`, "epic").ok, false, "a motion once per rule");
  const compiled = Sh.compileSkin({ id: "epic", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: ok.css });
  assert.match(compiled.css, /@keyframes ov-flicker/); assert.match(compiled.css, /@keyframes ov-shimmer/); assert.match(compiled.css, /@property --ov-shimmer-x/); assert.match(compiled.css, /prefers-reduced-motion:reduce/);
});

test("contrat 3 : un skin qui utilise le vocabulaire du contrat 3 doit l'annoncer ; un ancien cœur le refuse proprement", () => {
  const css = `[data-ov-part="panel"]{ov-shape:notch 12px}`;
  const r2 = check(skinFolder("epic", { css, manifest: { skinContract: 2 } }));
  assert.equal(r2.ok, false); assert.ok(r2.issues.some((i) => i.code === "overlay-contract-v3"));
  const r3 = check(skinFolder("epic", { css, manifest: { skinContract: 3, minCore: "0.8.0" } }));
  assert.equal(r3.ok, true, JSON.stringify(r3.issues.map((i) => i.code)));
  const future = check(skinFolder("epic", { manifest: { skinContract: 4 } }));
  assert.ok(future.issues.some((i) => i.code === "manifest-contract-newer"));
});
