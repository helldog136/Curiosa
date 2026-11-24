// Overlay skins that ship their own mosaic pieces (core 0.48.0, skin contract 7, docs/OVERLAY-SKINS.md "Patterns"). Pure, folder-level tests (no database, no server):
// the validator and each refusal, what is handed to the page (numbers only), what is never served, and the example skin of the repository.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";
import { LT, NARROW, PATTERN_ASSET, RECIPE, patternSkin } from "../helpers/overlay-pattern-skin.mjs";

const V = await import("@/core/skins/validate");
const K = await import("@/core/skins/constants");
const Mf = await import("@/core/skins/manifest");
const Cat = await import("@/core/skins/catalogue");
const Msg = await import("@/core/skins/messages");
const Se = await import("@/core/skins/serve");
const S = await import("@/core/animate/spec");
const Kit = await import("@/core/animate/kit");
const A = (() => { const win = {}; new Function("window", Kit.animateScript())(win); return win.CuriosaAnimate; })();

const check = (dir, extra = {}) => V.validateSkinFolder(dir, { coreVersion: "0.48.0", ...extra });
const codes = (r) => r.issues.map((i) => i.code);
const refused = (over, code, id = "slate-test") => { const r = check(patternSkin(id, over)); assert.equal(r.ok, false, `${code}: should be refused`); assert.ok(codes(r).includes(code), `${code} in ${codes(r)}`); return r; };
const FIXTURE = "tests/fixtures/pattern-skins/slate-panes";

test("the example skin of the repository passes, its pieces are part of the installed files and the fingerprint", () => {
  const v = check(FIXTURE);
  assert.equal(v.ok, true, JSON.stringify(v.issues.map((i) => [i.code, i.message.en])));
  assert.equal(v.manifest.skinContract, 7);
  assert.deepEqual(v.files.filter((f) => f.kind === "pattern").map((f) => f.path), ["patterns/square.json", "patterns/wide.json"]);
  assert.deepEqual(v.installFiles.map((f) => f.path).filter((p) => p.startsWith("patterns/")), ["patterns/square.json", "patterns/wide.json"]);
  // an old core says "core newer" and nothing is half-installed
  const old = V.validateSkinFolder(FIXTURE, { coreVersion: "0.47.0" });
  assert.equal(old.ok, false);
  assert.ok(codes(old).includes("manifest-core-newer"));
});

test("the page is handed numbers: the recipe's table holds the normalised pieces, no file name, no raw text", () => {
  const v = check(FIXTURE);
  const t = v.animation.patterns;
  assert.deepEqual(Object.keys(t), ["panes"]);
  assert.equal(t.panes.length, 2);
  assert.deepEqual(t.panes.map((g) => g.domain), [[240, 100], [100, 100]]);
  const text = JSON.stringify(v.animation);
  assert.doesNotMatch(text, /patterns\/|\.json|\$comment|Curiosa tests|CC0/, "no file name, comment, author or licence reaches the page");
  // the engine draws from that table: a frame with the pattern differs from the simple one, and the same input gives the same frame
  const lay = (recipe) => A.frame({ genre: "gauge", value: 60, target: 100 }, recipe, 1_800_000_000_000, { w: 1764, h: 717 }, { quality: "full" });
  const a = JSON.stringify(lay(v.animation)), b = JSON.stringify(lay(v.animation));
  assert.equal(a, b);
  const simple = { ...v.animation, genres: { gauge: { body: { draw: "mosaic", pattern: "voronoi", seed: 3 } } } };
  assert.ok(lay(v.animation).ops.filter((o) => o.k === "poly").length >= 20, "the pieces of the skin are drawn");
  assert.notEqual(a, JSON.stringify(lay(simple)));
});

test("contract and core: patterns need contract 7 and minCore 0.48.0, only an overlay skin may ship them", () => {
  refused({ manifest: { skinContract: 6 } }, "overlay-contract-v7");
  refused({ manifest: { minCore: "0.47.0" } }, "overlay-pattern-mincore");
  refused({ manifest: { minCore: undefined } }, "manifest-no-mincore");
  assert.equal(K.maxSkinContract("overlay"), 7);
  assert.equal(K.maxSkinContract("site"), K.maxSkinContract(undefined));
  assert.equal(Mf.parseSkinManifest({ skinContract: 8, kind: "overlay", id: "slate-test" }).ok, false, "contract 8 is newer than this core");
  const site = Mf.parseSkinManifest(({ skinContract: 1, kind: "site", id: "slate-test", name: { fr: "a", en: "a" }, description: { fr: "a", en: "a" }, version: "1.0.0", minCore: "0.48.0", license: "MIT", tags: [], modes: ["dark"], tokens: "tokens.json", assets: [PATTERN_ASSET("patterns/wide.json")] }));
  assert.equal(site.ok, true, JSON.stringify(site.issues?.map((i) => i.code)));
});

test("each refusal of a pattern file is precise: not JSON, not allowed, too big, overlapping, undeclared, missing, wrong path, twice", () => {
  refused({ patterns: { "wide.json": Buffer.from("{ nope") } }, "pattern-unreadable");
  refused({ patterns: { "wide.json": { ...LT, patternContract: "x" } } }, "pattern-invalid");
  refused({ patterns: { "wide.json": { ...LT, cells: [] } } }, "pattern-cells");
  const big = refused({ patterns: { "wide.json": Buffer.alloc(33 * 1024, 32) } }, "pattern-too-large");
  assert.match(big.issues.find((i) => i.code === "pattern-too-large").message.en, /33 KB; at most 32 KB/);
  refused({ patterns: { "wide.json": { patternContract: 1, domain: [100, 100], cells: [{ p: [[0, 0], [60, 0], [60, 100], [0, 100]], tone: 0.2 }, { p: [[40, 0], [100, 0], [100, 100], [40, 100]], tone: 0.7 }] } } }, "pattern-overlap");
  refused({ patterns: { "wide.json": LT, "extra.json": LT }, assets: [PATTERN_ASSET("patterns/wide.json")] }, "skin-file-unlisted");   // present, not declared
  refused({ patterns: { "wide.json": LT }, assets: [PATTERN_ASSET("patterns/wide.json"), PATTERN_ASSET("patterns/ghost.json")] }, "asset-missing");
  refused({ patterns: { "wide.json": LT }, assets: [PATTERN_ASSET("patterns/wide.json"), PATTERN_ASSET("patterns/Wide.JSON")] }, "asset-bad-path");
  refused({ patterns: { "wide.json": LT }, assets: [PATTERN_ASSET("patterns/wide.json"), PATTERN_ASSET("patterns/wide.json")] }, "asset-duplicate");
  refused({ patterns: { "wide.json": LT }, assets: [PATTERN_ASSET("images/wide.json")] }, "asset-bad-path");
  const many = Object.fromEntries(Array.from({ length: 49 }, (_, i) => [`p${i}.json`, LT]));
  refused({ patterns: many }, "patterns-too-many");
});

test("warnings keep the skin and say what will look wrong; a newer pattern is skipped, never half-read", () => {
  const holes = { patternContract: 1, domain: [100, 100], cells: [{ p: [[0, 0], [50, 0], [50, 100], [0, 100]], tone: 0.2 }] };
  const r = check(patternSkin("slate-test", { patterns: { "wide.json": holes } }));
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.ok(r.issues.some((i) => i.code === "pattern-coverage" && i.severity === "warning"));
  const newer = check(patternSkin("slate-test", { patterns: { "wide.json": { patternContract: 99, whatever: "future" } } }));
  assert.equal(newer.ok, true, JSON.stringify(codes(newer)));
  assert.ok(newer.issues.some((i) => i.code === "pattern-contract-newer" && i.severity === "warning"));
  assert.ok(!("panes" in (newer.animation.patterns ?? {})) && !("arch" in (newer.animation.patterns ?? {})), "the name is dropped: the mosaic draws the simple pattern");
});

test("the recipe's words are checked against the files the skin ships", () => {
  refused({ recipe: RECIPE({ arch: [{ file: "patterns/ghost.json" }] }) }, "pattern-missing");
  refused({ recipe: RECIPE({ arch: [{ file: "patterns/wide.json" }] }, { source: "nope" }) }, "pattern-source");
  refused({ recipe: RECIPE({ Bad: [{ file: "patterns/wide.json" }] }) }, "patterns-shape");
  const two = check(patternSkin("slate-test", { patterns: { "wide.json": LT, "narrow.json": NARROW }, recipe: RECIPE({ arch: [{ file: "patterns/wide.json" }, { file: "patterns/narrow.json" }] }) }));
  assert.equal(two.ok, true, JSON.stringify(codes(two)));
  assert.ok(two.issues.some((i) => i.code === "pattern-stretch" && i.severity === "warning"), "2:1 against 2:3 is stretched a lot");
  assert.equal(two.animation.patterns.arch.length, 2);
  // a recipe that ships files but never names them is fine (nothing to inline)
  const unused = check(patternSkin("slate-test", { recipe: { animateContract: 4, genres: { gauge: { body: { draw: "mosaic", pattern: "voronoi", seed: 1 } } } } }));
  assert.equal(unused.ok, true, JSON.stringify(codes(unused)));
});

test("what is handed over weighs 96 KB at most for the whole skin", () => {
  const cells = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 10; j++) cells.push({ p: [[i * 10, j * 10], [i * 10 + 10, j * 10], [i * 10 + 10, j * 10 + 10], [i * 10, j * 10 + 10]], tone: ((i + j) % 10) / 10 });
  const grid = { patternContract: 1, domain: [120, 100], cells };
  const table = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n${i}`, [{ file: "patterns/wide.json" }]]));
  const r = check(patternSkin("slate-test", { patterns: { "wide.json": grid }, recipe: RECIPE(table, { source: "n0" }) }));
  assert.equal(r.ok, false, "12 names of 120 pieces each are too much");
  assert.ok(codes(r).includes("patterns-total-too-large"), JSON.stringify(codes(r)));
  const one = check(patternSkin("slate-test", { patterns: { "wide.json": grid }, recipe: RECIPE({ arch: [{ file: "patterns/wide.json" }] }) }));
  assert.equal(one.ok, true, JSON.stringify(codes(one)));
  assert.ok(JSON.stringify(one.animation.patterns).length < S.PATTERN.totalBytes);
});

test("a site skin cannot ship patterns, and a pattern file is never served", () => {
  const site = patternSkin("slate-test", { manifest: { kind: "site", modes: ["dark"], skinContract: 1 } });
  const r = check(site);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("pattern-overlay-only"), JSON.stringify(codes(r)));
  const root = makeTempDir("pat-serve-");
  const dir = path.join(root, "slate-test/1.0.0/patterns"); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "wide.json"), JSON.stringify(LT));
  for (const kind of ["patterns", "images", "fonts", ""]) assert.equal(Se.resolveSkinAsset("slate-test", "1.0.0", kind, "wide.json", root), null, `${kind}/wide.json is not served`);
});

test("the catalogue lists such a skin as compatible with this core, and every new message has EN and FR text", () => {
  const entry = { id: "slate-test", name: "Slate", description: "d", repo: "https://github.com/test/curiosa-skins", skinContract: 7 };
  assert.equal(Cat.sanitizeSkinEntries({ skins: [entry] }, "0.48.0", "official", "overlay")[0].compatible, true);
  assert.equal(Cat.sanitizeSkinEntries({ skins: [{ ...entry, skinContract: 8 }] }, "0.48.0", "official", "overlay")[0].compatible, false);
  for (const c of ["overlay-contract-v7", "overlay-pattern-mincore", "pattern-overlay-only", "patterns-too-many", "patterns-total-too-large", "pattern-unreadable"]) {
    const e = Msg.catalogEntry(c);
    assert.ok(e.fr.trim() && e.en.trim() && e.hintFr.trim() && e.hintEn.trim(), c);
  }
});
