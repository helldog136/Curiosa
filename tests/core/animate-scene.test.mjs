// Scenes (core 0.40.0, docs/OVERLAY-ANIMATIONS.md "Scenes", animateContract 3): the skin's own pictures placed on the abstract bar. The tolerant reader and the bounds of the
// checker, the header probe of pictures, the install rules (images only for a skin that declares a scene), the draw list (pure, deterministic), calm mode as a mechanical
// transform, the effects levels, the fallbacks (a picture that does not load, a kit the scene does not draw), the text drawn last, the serving of vector pictures, and a
// real Chromium under the strict policy of a module element page. The legacy recipes (contract 1 and 2) are proved unchanged by animate-motion.test.mjs (810 golden frames).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { makeTempDir } from "../helpers/tmp.mjs";

const K = await import("@/core/animate/kit");
const S = await import("@/core/animate/spec");
const SC = await import("@/core/animate/scene");
const PR = await import("@/core/animate/imageProbe");
const V = await import("@/core/skins/validate");
const SV = await import("@/core/skins/serve");
const { getCoreVersion } = await import("@/core/modules/compat");

const engine = () => { const win = {}; new Function("window", K.animateScript())(win); return win.CuriosaAnimate; };
const A = engine();
const FIX = "tests/fixtures/scene-skins/lantern-vine";
const T0 = 1_800_000_000_000, SIZE = { w: 1280, h: 360 };
const validated = V.validateSkinFolder(FIX, { coreVersion: getCoreVersion() });
const scene = validated.scene;
const recipe = { animateContract: 3, scene, base: "/skins/lantern-vine/1.0.0/" };
const rawScene = JSON.parse(fs.readFileSync(`${FIX}/scene.json`, "utf8"));
const infos = new Map(validated.manifest.assets.map((a) => [a.file, { w: 100, h: 50, svg: a.file.endsWith(".svg") }]));
const st = { genre: "gauge", value: 75, target: 100, label: "Goal", milestones: [25, 50, 75], highlights: [{ id: "a", at: T0, kind: "step", amount: 3 }, { id: "m", at: T0, kind: "milestone" }] };
const frame = (rc, state, dt, opts = {}) => A.frame(state, rc, T0 + dt, SIZE, { ...opts });
const digest = (f) => crypto.createHash("sha256").update(JSON.stringify({ ops: f.ops, keys: f.keys, animating: f.animating })).digest("hex").slice(0, 16);
const imgs = (f) => f.ops.filter((o) => o.k === "img");
const check = (patch) => SC.checkScene({ ...structuredClone(rawScene), ...patch }, infos);
const codes = (r) => r.issues.map((i) => `${i.code}:${i.severity}:${i.path}`);

// ── A. the checker ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("scene checker: the test skin's scene passes with no issue and comes back cleaned (numbers inside their bounds, defaults filled)", () => {
  const r = SC.checkScene(rawScene, infos);
  assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.deepEqual(r.issues, []);
  assert.equal(r.scene.animateContract, 3); assert.equal(r.scene.kits.gauge.layers.length, 6);
  assert.equal(r.scene.kits.gauge.layers[0].fit, "stretch"); assert.equal(r.scene.kits.gauge.layers[5].fit, "contain", "a point anchor contains its picture by default");
  assert.deepEqual(r.scene.assets.sparks, { file: "images/sparks.png", w: 100, h: 50, svg: false, cols: 4, rows: 2 });
  assert.equal(r.scene.emitters.petals.blend, "normal");
});

test("scene checker (tolerant reader): a word this core does not know is skipped with a warning, never an error", () => {
  const g = structuredClone(rawScene.kits.gauge);
  g.layers.push({ src: "leaf", at: "orbit" }, { src: "leaf", at: "head", reveal: { mode: "iris" }, role: "halo", fit: "spiral", blend: "multiply", wings: 3, on: { teleport: "pop" } });
  g.on.rebase = [{ emit: "petals" }]; g.on.step.push({ timeline: "pop", target: "x" }, { emit: "petals", at: "moon" });
  const r = check({ kits: { gauge: g, levels: { layers: [] }, hologram: {} }, extra: 1, timelines: { ...rawScene.timelines, pop: { tracks: { scale: [[0, 1], [1, 1.2]], skew: [[0, 0], [1, 1]] } } } });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  const w = codes(r).join(" ");
  for (const part of ["unknown:warning:kits.gauge.layers.6.at", "reveal", "role", "fit", "blend", "wings", "on.teleport", "kits.gauge.on.rebase", "kits.levels", "kits.hologram", "extra", "tracks.skew", "at"]) assert.ok(w.includes(part), `${part} in ${w}`);
  assert.equal(r.scene.kits.gauge.layers.length, 7, "the layer with an unknown anchor is skipped, the other one is kept with its known words");
  assert.equal(r.scene.kits.levels, undefined);
});

test("scene checker: a known word with a value out of its bounds, a missing picture, a missing timeline, an unreadable text: errors with their path", () => {
  const bad = (mut) => { const g = structuredClone(rawScene.kits.gauge); mut(g); return check({ kits: { gauge: g } }); };
  assert.equal(bad((g) => { g.layers[5].size.h = 99; }).ok, false);
  assert.equal(bad((g) => { g.layers[5].src = "nope"; }).ok, false);
  assert.equal(bad((g) => { g.layers[5].on.step = "nope"; }).ok, false);
  assert.equal(bad((g) => { g.layers[0].tier = "ultra"; }).ok, false);
  assert.equal(bad((g) => { g.layers[1].reveal = { mode: "wipe" }; g.layers[3].reveal = { mode: "wipe" }; }).ok, false, "a wipe belongs to the track anchor");
  assert.equal(bad((g) => { g.layers[2].loop = { fps: 30 }; }).ok, false, "a loop is at most 8 frames a second");
  assert.equal(bad((g) => { g.layers[5].loop = { fps: 4 }; }).ok, false, "a loop needs a sheet");
  assert.equal(bad((g) => { g.thickness = 3; }).ok, false);
  assert.equal(bad((g) => { g.on.step[0].emit = "nope"; }).ok, false);
  assert.equal(check({ emitters: { ...rawScene.emitters, glints: { ...rawScene.emitters.glints, count: 500 } } }).ok, false, "at most 40 particles an emitter");
  assert.equal(check({ timelines: { pop: { tracks: { scale: [[0, 1], [0, 2]] } } } }).ok, false, "keys must rise");
  assert.equal(check({ timelines: { pop: { spring: "wobbly", tracks: { scale: [[0, 1], [1, 2]] } } } }).ok, false);
  const t = bad((g) => { g.text.value = { color: "#777777", outline: "#888888" }; });
  assert.ok(t.issues.some((i) => i.code === "text-contrast"), "readability is never tolerated away");
  assert.equal(SC.checkScene(null, infos).ok, false); assert.equal(SC.checkScene({ animateContract: 2 }, infos).ok, false);
  const many = (n) => Array.from({ length: n }, () => ({ src: "leaf", at: "head" }));
  assert.equal(bad((g) => { g.layers = many(17); }).ok, false, "at most 16 layers");
  const tooBig = new Map(infos); tooBig.set("images/leaf.png", { w: 3000, h: 10, svg: false });
  assert.equal(SC.checkScene(rawScene, tooBig).ok, false, "a picture over 2048 px is dropped, so what refers to it is an error…");
  assert.ok(codes(SC.checkScene(rawScene, tooBig)).some((c) => c.startsWith("limit:")), "…with a limit issue");
});

test("scene checker (contracts): written for a later contract it reads what it knows and only warns; a minimum above ours switches it off", () => {
  const body = structuredClone(rawScene); body.kits.gauge.layers[5].size.h = 99; body.kits.gauge.layers[0].tier = "ultra";
  const ahead = SC.checkScene({ ...body, animateContract: 4, animateMinContract: 3 }, infos);
  assert.equal(ahead.ok, true, JSON.stringify(ahead.issues)); assert.equal(ahead.scene.animateContract, 3); assert.ok(ahead.issues.some((i) => i.code === "contract-ahead"));
  const later = SC.checkScene({ ...rawScene, animateContract: 4 }, infos);
  assert.equal(later.ok, true); assert.equal(later.scene, null); assert.equal(later.newer, true);
  assert.equal(SC.checkScene({ ...rawScene, animateMinContract: 2 }, infos).ok, false);
  assert.equal(S.ANIMATE_CONTRACT, 2, "recipes keep their own contract");
  assert.equal(S.SCENE_CONTRACT, 3);
});

// ── B. headers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("image probe: PNG, WebP (lossy, lossless, extended) and sanitised SVG sizes from the first bytes; animated pictures are recognised", async () => {
  const raw = { create: { width: 40, height: 20, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } };
  assert.deepEqual(PR.probeImage("a.png", await sharp(raw).png().toBuffer()), { w: 40, h: 20, animated: false });
  assert.deepEqual(PR.probeImage("a.webp", await sharp(raw).webp({ lossless: true }).toBuffer()), { w: 40, h: 20, animated: false });
  assert.deepEqual(PR.probeImage("a.webp", await sharp(raw).webp({ quality: 50 }).toBuffer()), { w: 40, h: 20, animated: false });
  const alpha = await sharp({ create: { width: 33, height: 17, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).webp().toBuffer();
  assert.deepEqual(PR.probeImage("a.webp", alpha), { w: 33, h: 17, animated: false });
  assert.deepEqual(PR.probeImage("a.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64"><rect/></svg>')), { w: 48, h: 64, animated: false });
  assert.deepEqual(PR.probeImage("a.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect/></svg>')), { w: 10, h: 5, animated: false });
  assert.equal(PR.probeImage("a.svg", Buffer.from("<svg><rect/></svg>")), null);
  assert.equal(PR.probeImage("a.png", Buffer.from("not a png at all, really not")), null);
  // an animated PNG: an `acTL` chunk before the data
  const png = await sharp(raw).png().toBuffer(), actl = Buffer.alloc(20); actl.writeUInt32BE(8, 0); actl.write("acTL", 4, "latin1");
  assert.equal(PR.probeImage("a.png", Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)])).animated, true);
  // an animated WebP: the animation flag of the extended header
  const ext = Buffer.alloc(30); ext.write("RIFF", 0, "latin1"); ext.writeUInt32LE(22, 4); ext.write("WEBP", 8, "latin1"); ext.write("VP8X", 12, "latin1"); ext.writeUInt32LE(10, 16); ext[20] = 0x02;
  assert.equal(PR.probeImage("a.webp", ext).animated, true);
});

// ── C. install ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function copyFixture(over = {}) {
  const dir = makeTempDir("scene-skin-");
  fs.cpSync(FIX, dir, { recursive: true });
  const mf = path.join(dir, "skin.json"), m = JSON.parse(fs.readFileSync(mf, "utf8"));
  if (over.manifest) { Object.assign(m, over.manifest); fs.writeFileSync(mf, JSON.stringify(m)); }
  for (const [f, content] of Object.entries(over.files ?? {})) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), content); }
  return dir;
}
const validate = (dir) => V.validateSkinFolder(dir, { coreVersion: getCoreVersion() });
const refused = (over, code) => { const r = validate(copyFixture(over)); assert.equal(r.ok, false, code); assert.ok(r.issues.some((i) => i.code === code), `${code} in ${r.issues.map((i) => i.code)}`); assert.deepEqual(r.installFiles, []); };

test("install: a skin with a scene ships images (PNG, WebP, sanitised SVG) and installs; the files and their fingerprint cover pictures and scene", () => {
  const v = validated;
  assert.equal(v.ok, true, JSON.stringify(v.issues)); assert.deepEqual(v.issues, []);
  const kinds = Object.fromEntries(v.files.map((f) => [f.path, f.kind]));
  assert.equal(kinds["scene.json"], "scene"); assert.equal(kinds["images/head.png"], "image"); assert.equal(kinds["images/tick.svg"], "image");
  assert.ok(v.installFiles.some((f) => f.path === "images/tick.svg") && v.fingerprint.length === 64);
  assert.equal(validate(copyFixture()).fingerprint, v.fingerprint, "the same bytes give the same fingerprint");
  assert.ok(v.totalBytes < 200 * 1024);
});

test("install: the images gate is lifted ONLY for a skin that declares a scene, and only for images", () => {
  const file = (f) => ({ file: f, kind: "image", license: "CC0-1.0", licenseFile: "LICENSES/CC0.txt", author: "x", source: "y" });
  const m = JSON.parse(fs.readFileSync(`${FIX}/skin.json`, "utf8"));
  refused({ manifest: { scene: undefined } }, "overlay-no-assets");   // the same pictures without a scene: refused as before
  refused({ manifest: { assets: [...m.assets, { file: "fonts/a.woff2", kind: "font" }] }, files: { "fonts/a.woff2": "wOF2" } }, "overlay-no-assets");
  refused({ manifest: { skinContract: 4 } }, "overlay-contract-v5");
  refused({ manifest: { assets: [...m.assets, file("images/photo.jpg")] }, files: { "images/photo.jpg": Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) } }, "scene-image-type");
  refused({ manifest: { assets: [...m.assets, file("images/anim.avif")] } }, "scene-image-type");
  refused({ manifest: { scene: "missing.json" } }, "scene-missing");
  refused({ files: { "scene.json": "{not json" } }, "scene-unreadable");
  const sceneWith = (patch) => JSON.stringify({ ...rawScene, ...patch });
  refused({ files: { "scene.json": sceneWith({ kits: { gauge: { layers: [{ src: "head", at: "head", size: { h: 99 } }] } } }) } }, "scene-invalid");
  refused({ files: { "scene.json": sceneWith({ kits: { gauge: { ...rawScene.kits.gauge, text: { value: { color: "#777777", outline: "#888888" } } } } }) } }, "scene-text-contrast");
  const v = validate(copyFixture({ files: { "scene.json": sceneWith({ animateContract: 4 }) } }));
  assert.equal(v.ok, true); assert.equal(v.scene, null); assert.ok(v.issues.some((i) => i.code === "scene-contract-newer"), "a later scene installs with the basic look");
  const w = validate(copyFixture({ files: { "scene.json": sceneWith({ kits: { ...rawScene.kits, rings: {} } }) } }));
  assert.equal(w.ok, true); assert.ok(w.issues.some((i) => i.code === "scene-ignored"));
  // a site skin cannot have a scene
  const site = copyFixture({ manifest: { kind: "site", skinContract: 3, modes: ["dark"], tokens: "tokens.json" } });
  assert.ok(validate(site).issues.some((i) => i.code === "scene-overlay-only"));
});

test("install: pictures are checked for what they really are — licence, signature, sanitised SVG, decoded size from the header, no animation, size ceilings", async () => {
  const m = JSON.parse(fs.readFileSync(`${FIX}/skin.json`, "utf8")), one = (f) => ({ ...m.assets.find((a) => a.file === f) });
  const without = (f) => m.assets.filter((a) => a.file !== f);
  refused({ manifest: { assets: [...without("images/leaf.png"), { ...one("images/leaf.png"), license: undefined }] } }, "asset-license-missing");
  refused({ files: { "images/leaf.png": "this is text" } }, "asset-signature");
  refused({ files: { "images/tick.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script></svg>' } }, "asset-svg-refused");
  refused({ files: { "images/tick.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>' } }, "asset-svg-refused");   // no viewBox: refused by the sanitiser
  refused({ files: { "images/leaf.png": Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]) } }, "scene-image-unreadable");
  // a decompression bomb: a tiny file whose header says 5000 x 5000
  const small = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
  const bomb = Buffer.from(small); bomb.writeUInt32BE(5000, 16); bomb.writeUInt32BE(5000, 20);
  refused({ files: { "images/leaf.png": bomb } }, "scene-image-pixels");
  // an animated picture
  const actl = Buffer.alloc(20); actl.writeUInt32BE(8, 0); actl.write("acTL", 4, "latin1");
  refused({ files: { "images/leaf.png": Buffer.concat([small.subarray(0, 33), actl, small.subarray(33)]) } }, "scene-image-animated");
  // a picture over the 200 KB ceiling of images
  const noise = await sharp({ create: { width: 700, height: 700, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
  assert.ok(noise.length > 200 * 1024);
  refused({ files: { "images/leaf.png": noise } }, "file-too-large");
  // more pictures than the skin ceiling (12), and a file in the images folder nobody declared
  const extra = Array.from({ length: 8 }, (_, i) => ({ ...one("images/leaf.png"), file: `images/l${i}.png` }));
  refused({ manifest: { assets: [...m.assets, ...extra] }, files: Object.fromEntries(extra.map((e) => [e.file, small])) }, "images-too-many");
  refused({ files: { "images/stray.png": small } }, "skin-file-unlisted");
});

// ── D. the draw list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("draw list: pure and deterministic — the same state at the same instant gives the same list, a pinned digest guards every mechanism", () => {
  const a = frame(recipe, st, 600), b = frame(recipe, st, 600), c = frame(JSON.parse(JSON.stringify(recipe)), JSON.parse(JSON.stringify(st)), 600);
  assert.equal(digest(a), digest(b)); assert.equal(digest(a), digest(c));
  assert.notEqual(digest(a), digest(frame(recipe, st, 900)));
  assert.equal(Math.random.toString().includes("native"), true);
  const src = K.animateScript(); const scenePart = src.slice(src.indexOf("function sceneFrame"), src.indexOf("var BMP"));
  assert.doesNotMatch(scenePart, /Math\.random|Date\.now|performance\.now/, "the scene's frame reads no clock and no randomness");
  const PINNED = { rest: [-5000, "rest"], step: [300, "steps"], milestone: [600, "milestone"] };
  const states = { rest: { ...st, highlights: [] }, steps: { ...st, highlights: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, at: T0 + i * 150, kind: "step", amount: 1 })) }, milestone: st };
  const got = {}; for (const [k, [dt, s]] of Object.entries(PINNED)) got[k] = digest(frame(recipe, states[s], dt));
  assert.deepEqual(got, JSON.parse(fs.readFileSync("tests/fixtures/scene-skins/draw-list-digests.json", "utf8")), "the pinned draw lists changed: if intended, regenerate tests/fixtures/scene-skins/draw-list-digests.json");
});

test("draw list: anchors — the track, the wipe-revealed fill, sprites along the fill, one post per milestone, the head at the end of the fill; the head stays inside the element", () => {
  const f = frame(recipe, { ...st, highlights: [] }, -5000);
  const clip = f.ops.find((o) => o.k === "clip"); assert.ok(clip, "the fill is revealed by a wipe (a clip to the progress)");
  const track = imgs(f).find((o) => o.id.endsWith("track.png")), fill = imgs(f).find((o) => o.id.endsWith("fill.png")), head = imgs(f).find((o) => o.id.endsWith("head.png"));
  assert.equal(track.L, 0, "a still track is in the cached layer"); assert.equal(fill.L, 3);
  assert.ok(Math.abs(clip.p[2] - (track.x + track.w * 0.75)) < 0.1, "the wipe stops at 75 %");
  assert.ok(Math.abs(head.x - clip.p[2]) < 0.1, "the head sits at the end of the fill");
  assert.equal(imgs(f).filter((o) => o.id.endsWith("tick.svg?raster=1")).length, 3, "one picture per milestone, a vector picture asked as a bitmap");
  const leaves = imgs(f).filter((o) => o.id.endsWith("leaf.png")); assert.ok(leaves.length >= 3 && leaves.every((o) => o.x < head.x), "leaves grow along the fill only");
  const done = imgs(frame(recipe, { ...st, value: 100, highlights: [] }, -5000)).find((o) => o.id.endsWith("head.png"));
  assert.ok(done.x + done.w / 2 <= SIZE.w + 0.01, "the head never leaves the element");
  const empty = frame(recipe, { ...st, value: 0, highlights: [] }, -5000);
  assert.ok(!empty.ops.some((o) => o.k === "clip"), "no wipe, and no fill, at 0 %");
});

test("draw list: events — the step timeline (spring) scales the head, the milestone timeline swings it, emitters throw seeded sprites, all within the core's event windows", () => {
  const rest = imgs(frame(recipe, { ...st, highlights: [] }, -5000)).find((o) => o.id.endsWith("head.png"));
  const mid = imgs(frame(recipe, st, 500)).find((o) => o.id.endsWith("head.png"));
  assert.ok(mid.w > rest.w * 1.1 && mid.r !== undefined, "scaled and rotated while the milestone plays");
  const later = imgs(frame(recipe, st, 6000)).find((o) => o.id.endsWith("head.png"));
  assert.ok(Math.abs(later.w - rest.w) < 0.5 && later.r === undefined, "back at rest once the core's window is over");
  const sparks = (f) => imgs(f).filter((o) => o.id.endsWith("sparks.png"));
  assert.ok(sparks(frame(recipe, st, 900)).length > 5 && sparks(frame(recipe, st, 900)).length <= S.SCENE.limits.live);
  assert.equal(sparks(frame(recipe, st, 6000)).length, 0, "an emitter lives inside its event's window");
  assert.equal(JSON.stringify(sparks(frame(recipe, st, 900))), JSON.stringify(sparks(frame(recipe, st, 900))));
  // a burst of five steps is one merged event: the core's merge rule is the rate limiter
  const burst = { ...st, highlights: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, at: T0 + i * 150, kind: "step", amount: 1 })) };
  assert.ok(frame(recipe, burst, 400).view.highlights.length === 1);
  // every emitter is capped and every frame draws a bounded number of sprites
  const heavy = structuredClone(scene); for (const e of Object.values(heavy.emitters)) e.count = 40;
  const many = { ...st, highlights: Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, at: T0 + i * 2000, kind: "complete" })) };
  for (let d = 0; d < 9000; d += 250) assert.ok(imgs(frame({ ...recipe, scene: heavy }, many, d)).length <= S.SCENE.limits.sprites + S.SCENE.limits.live, `frame ${d}`);
});

test("draw list: the value text is drawn LAST by the core, with its readability rule, whatever the pictures are", () => {
  const f = frame(recipe, st, 600), ops = f.ops, firstText = ops.findIndex((o) => o.k === "text");
  assert.ok(firstText > 0 && ops.slice(firstText).every((o) => o.k === "text"), "no picture is drawn over a text");
  const value = ops.filter((o) => o.k === "text").at(-1); assert.equal(value.t, "75 / 100"); assert.ok(value.ow > 0 && A.contrast(value.f, value.o) >= 4.5);
  const stepOnly = frame(recipe, { ...st, highlights: [{ id: "a", at: T0, kind: "step", amount: 3 }] }, 300).ops;
  assert.ok(stepOnly.some((o) => o.k === "text" && o.t === "+3"), "the amount of a step rises from the value, written by the core");
  // a scene that styles its text badly is still readable: the engine raises the outline
  const bad = structuredClone(scene); bad.kits.gauge.text.value = { color: "#777777", outline: "#888888", outlineWidth: 0 };
  const t = frame({ ...recipe, scene: bad }, st, 600).ops.filter((o) => o.k === "text").at(-1); assert.ok(A.contrast(t.f, t.o) >= 4.5 && t.ow > 0);
});

// ── E. calm, levels, fallbacks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("calm mode: a mechanical transform of the scene — no emitters, only alpha and frame tracks, loops frozen; the reveal and the value stay", () => {
  const live = frame(recipe, st, 900), calm = frame(recipe, st, 900, { calm: true });
  assert.ok(imgs(live).some((o) => o.id.endsWith("sparks.png")) && !imgs(calm).some((o) => o.id.endsWith("sparks.png")), "emitters are dropped");
  const head = (f) => imgs(f).find((o) => o.id.endsWith("head.png")), rest = head(frame(recipe, { ...st, highlights: [] }, -5000, { calm: true }));
  assert.ok(head(calm).w === rest.w && head(calm).r === undefined, "no scale, no rotation, whatever the timeline says");
  const sheen = (f) => imgs(f).find((o) => o.id.endsWith("shine.png"));
  assert.equal(sheen(frame(recipe, st, -5000, { calm: true })).fr, 1, "a loop rests on the frame the skin chose (calmFrame)");
  assert.equal(sheen(frame(recipe, st, -5000 + 1000, { calm: true })).fr, 1);
  const frames = new Set([0, 250, 500, 750, 1000].map((d) => sheen(frame(recipe, { ...st, highlights: [] }, d)).fr)); assert.ok(frames.size > 1, "the same loop runs when not calm");
  assert.equal(calm.view.display, live.view.display, "the value glide stays");
  assert.ok(calm.ops.some((o) => o.k === "clip"), "the reveal stays");
  // alpha tracks survive calm
  const glow = structuredClone(scene); glow.timelines.pop = { ease: "linear", tracks: { alpha: [[0, 0], [0.5, 1], [1, 0]], scale: [[0, 1], [0.5, 3], [1, 1]] } }; glow.kits.gauge.layers[5].alpha = 0;
  const g = imgs(frame({ ...recipe, scene: glow }, { ...st, highlights: [{ id: "a", at: T0, kind: "step", amount: 1 }] }, 450, { calm: true })).find((o) => o.id.endsWith("head.png"));
  assert.ok(g.a > 0.3 && g.w === rest.w);
});

test("effects levels: full draws everything, light drops `full` layers, halves emitters and refuses additive blending, minimal draws the base layers still", () => {
  const f = frame(recipe, st, 900, { quality: "full" }), l = frame(recipe, st, 900, { quality: "light" }), m = frame(recipe, st, 900, { quality: "minimal" });
  const has = (x, name) => imgs(x).some((o) => o.id.endsWith(name));
  assert.ok(has(f, "shine.png") && !has(l, "shine.png") && !has(m, "shine.png"), "a `full` layer needs the full level");
  assert.ok(has(l, "leaf.png") && !has(m, "leaf.png"), "a `light` layer needs light");
  assert.ok(has(m, "track.png") && has(m, "fill.png") && has(m, "head.png"), "the base layers stay at minimal");
  const n = (x) => imgs(x).filter((o) => o.id.endsWith("sparks.png")).length;
  assert.ok(n(f) > n(l) && n(l) > 0 && n(m) === 0, `particles ${n(f)} / ${n(l)} / ${n(m)}`);
  assert.ok(imgs(f).some((o) => o.b === "lighter") && !imgs(l).some((o) => o.b === "lighter"), "additive blending is full only");
  const hm = imgs(m).find((o) => o.id.endsWith("head.png")), hr = imgs(frame(recipe, { ...st, highlights: [] }, -5000, { quality: "minimal" })).find((o) => o.id.endsWith("head.png"));
  assert.equal(hm.w, hr.w, "no motion at minimal");
  assert.equal(A.frame(st, recipe, T0, SIZE, { quality: "bogus" }).quality, "full");
});

test("fallbacks: a picture that is not ready is skipped and the basic look of the core shows in its place; a kit the scene does not draw uses the basic recipe", () => {
  const url = (f) => recipe.base + f;
  const ready = (list) => Object.fromEntries(list.map((f) => [url(f), true]));
  const none = frame(recipe, st, 600, { assets: {} });
  assert.equal(imgs(none).length, 0); assert.ok(none.ops.some((o) => o.k === "poly" && o.L === 0) && none.ops.some((o) => o.k === "poly" && o.L === 3), "a flat track and a flat fill from the page's tokens");
  assert.ok(none.ops.filter((o) => o.k === "text").length >= 2, "the texts are always there");
  const noTrack = frame(recipe, st, 600, { assets: ready(["images/fill.png", "images/head.png", "images/sparks.png"]) });
  assert.ok(imgs(noTrack).some((o) => o.id.endsWith("fill.png")) && noTrack.ops.some((o) => o.k === "poly" && o.L === 0) && !noTrack.ops.some((o) => o.k === "poly" && o.L === 3), "only the track falls back");
  const noFill = frame(recipe, st, 600, { assets: ready(["images/track.png", "images/head.png"]) });
  assert.ok(imgs(noFill).some((o) => o.id.endsWith("track.png")) && noFill.ops.some((o) => o.k === "poly" && o.L === 3), "only the fill falls back");
  assert.equal(JSON.stringify(frame(recipe, st, 600, { assets: undefined }).ops.length > 0), "true", "no `assets` option: every picture counts as ready (tests, still frames)");
  const levels = { genre: "levels", value: 620, target: 1000, level: 3, label: "Hype", highlights: [] };
  assert.equal(JSON.stringify(frame(recipe, levels, 0).ops), JSON.stringify(A.frame(levels, null, T0, SIZE, {}).ops), "levels and counter are not drawn by this scene: the basic look");
  assert.equal(A.isScene(recipe), true); assert.equal(A.isScene({ animateContract: 3, genres: {} }), false); assert.equal(A.isScene(null), false);
  assert.equal(A.usable(recipe), false, "the legacy reader never reads a scene");
});

// ── F. serving ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("serving: a scene's pictures come through the skin asset route; a vector picture also as a PNG at twice its size (`?raster=1`)", async () => {
  const root = makeTempDir("scene-serve-"), dir = path.join(root, "lantern-vine", "1.0.0", "images"); fs.mkdirSync(dir, { recursive: true });
  for (const f of validated.installFiles.filter((x) => x.path.startsWith("images/"))) fs.writeFileSync(path.join(root, "lantern-vine", "1.0.0", f.path), f.content);
  const png = SV.resolveSkinAsset("lantern-vine", "1.0.0", "images", "head.png", root), svg = SV.resolveSkinAsset("lantern-vine", "1.0.0", "images", "tick.svg", root);
  assert.equal(png.type, "image/png"); assert.equal(svg.type, "image/svg+xml"); assert.match(SV.assetHeaders(svg)["content-security-policy"], /sandbox/);
  const raster = await SV.rasterizeSvg(svg.file), meta = await sharp(raster).metadata();
  assert.equal(meta.format, "png"); assert.equal(meta.width, 96); assert.equal(meta.height, 128);
  assert.equal(SV.rasterHeaders(raster.length)["content-type"], "image/png"); assert.match(SV.rasterHeaders(1)["cache-control"], /immutable/);
  assert.equal(await SV.rasterizeSvg(path.join(root, "nope.svg")), null);
});

// ── G. real Chromium, under the strict policy of a module element page ────────────────────────────────────────────────────────────────────────
let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

test("real browser: the pictures load by fetch under `connect-src 'self'` with NO image policy (stream-goals' element page), the bar draws them; a missing picture falls back to the basic look", { skip: skipBrowser, timeout: 120000 }, async () => {
  const B = await import("../../scripts/visual/scene-bench.mjs");
  const skin = B.prepare(FIX), pages = new Map(), { srv, port } = await B.serve(skin, pages);
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args }), errors = [];
  try {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 360 } })).newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    const go = async (rc, extra = {}) => { pages.set("/p", K.animateKitPage({ state: st, recipe: rc, width: 1280, height: 360, at: T0 + 600, background: "dark", ...extra })); await p.goto(`http://127.0.0.1:${port}/p`); await p.waitForSelector("html[data-ready='1']"); return p.evaluate(() => ({ imgs: window.__frame.ops.filter((o) => o.k === "img").length, polys: window.__frame.ops.filter((o) => o.k === "poly").length })); };
    const good = await go(skin.recipe);
    assert.ok(good.imgs > 8, JSON.stringify(good));
    const px = await p.evaluate(() => { const c = document.getElementById("cv").getContext("2d"), d = c.getImageData(0, 0, 1280, 360).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 120 && d[i] < 140 && d[i + 2] < 120) lit++; return lit; });
    assert.ok(px > 20000, "the green of the fill is on the canvas: " + px);
    const lost = await go({ ...skin.recipe, base: "/skins/lantern-vine/9.9.9/" });
    assert.equal(lost.imgs, 0); assert.ok(lost.polys >= 2, "the base look: " + JSON.stringify(lost));
    // calm and minimal in a real page
    assert.ok((await go(skin.recipe, { calm: true })).imgs > 5); assert.ok((await go(skin.recipe, { quality: "minimal" })).imgs > 3);
    const hostile = await p.evaluate(() => typeof createImageBitmap + "/" + document.visibilityState);
    assert.equal(hostile, "function/visible");
  } finally { await browser.close(); srv.close(); fs.rmSync(skin.root, { recursive: true, force: true }); }
  assert.deepEqual(errors, []);
});
