// Compositions (core 0.19.0): "Place the text" on a picture or a GIF. The data checker (every error code), the placement maths, auto-shrink, the auto colour,
// undo/redo, the automatic values (chips, never braces), the gallery option and its server check (64 000 characters), the appearance kit exception, the
// editor markup, and the engine itself in a REAL Chromium (sizes, shrink, contained frame, textContent only, the kit's outline does not override a box).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import vm from "node:vm";
import zlib from "node:zlib";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const M = await import("@/core/compose/model");
const L = await import("@/core/compose/layout");
const Hs = await import("@/core/compose/history");
const T = await import("@/core/compose/tokens");
const C = await import("@/core/compose/contrast");
const R = await import("@/core/compose/render");
const O = await import("@/core/compose/option");
const { composeKit } = await import("@/core/compose/kit");
const G = await import("@/core/gallery");
const K = await import("@/core/overlays/appearance");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const SRC = "/uploads/00000001-0000-4000-8000-000000000000.png";
const GIF = "/uploads/00000002-0000-4000-8000-000000000000.gif";
const VID = "/uploads/00000003-0000-4000-8000-000000000000.webm";
const codes = (r) => (r.ok ? [] : r.errors.map((e) => `${e.path}:${e.code}`));

/* ───────────── data ───────────── */

test("model: the default composition is valid, canonical and small; JSON text or object", () => {
  const c = M.defaultComposition(SRC);
  const r = M.checkComposition(c, { src: SRC });
  assert.equal(r.ok, true);
  assert.equal(M.canonicalComposition(r.value), M.canonicalComposition(M.checkComposition(JSON.stringify(c), { src: SRC }).value));
  assert.ok(M.canonicalComposition(r.value).length < 700);
  assert.deepEqual(r.value.boxes[0].content, { kind: "phrase" });
  assert.equal(r.value.boxes[0].size, 56, "56 px on a 1080 frame, the TV xl step");
  // missing optional keys take defaults
  const min = M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: [{ id: "a" }] }, { src: SRC });
  assert.equal(min.ok, true);
  assert.equal(min.value.format, "media");
});

test("model: every error code, with its path, all at once", () => {
  assert.deepEqual(codes(M.checkComposition("{nope")), [":json"]);
  assert.deepEqual(codes(M.checkComposition([1])), [":format"]);
  assert.deepEqual(codes(M.checkComposition("x".repeat(20_000))), [":size"]);
  const r = M.checkComposition({
    v: 2, format: "3:2", extra: 1,
    backdrop: { src: "https://example.org/a.png", fit: "stretch", focus: [120, 50] },
    duration: { mode: "always", seconds: 90 },
    stickers: [{}],
    boxes: [
      { id: "A", size: 300, colour: "#fff", content: { kind: "custom", text: "Merci {pseudo}" }, look: "neon", color: "red", in: { anim: "spin", at: 99, dur: 5 }, x: 99 },
      { id: "b", content: { kind: "custom", text: "" } },
      { id: "b", content: { kind: "custom", text: "x".repeat(121) } },
    ],
  }, { variables: ["name"], src: SRC });
  const got = codes(r);
  for (const want of ["v:version", "format:choice", "extra:unknown_key", "backdrop.src:file", "backdrop.fit:choice", "backdrop.focus[0]:range", "duration.mode:choice", "duration.seconds:range", "stickers:range",
    "boxes[0].colour:unknown_key", "boxes[0].id:format", "boxes[0].content.text:variable", "boxes[0].x:range", "boxes[0].size:range", "boxes[0].look:choice", "boxes[0].color:choice",
    "boxes[0].in.anim:choice", "boxes[0].in.at:range", "boxes[0].in.dur:range", "boxes[1].content.text:required", "boxes[2].id:choice", "boxes[2].content.text:range"]) assert.ok(got.includes(want), `${want} in ${got}`);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: [] })), ["boxes:boxes"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` })) })), ["boxes:boxes"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: [{ id: "a" }, { id: "b" }] }, { maxBoxes: 1 })), ["boxes:boxes"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, boxes: [{ id: "a" }] })), ["backdrop:required"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC } })), ["boxes:required"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: GIF }, boxes: [{ id: "a" }] }, { src: SRC })), ["backdrop.src:file"], "the backdrop is the file the composition belongs to");
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC, poster: "/x.svg" }, boxes: [{ id: "a" }] })), ["backdrop.poster:file"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, format: "16:9", backdrop: { src: SRC }, boxes: [{ id: "a" }] }, { formats: ["media"] })), ["format:choice"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: [{ id: "a", x: 50, w: 60 }] })), ["boxes[0].w:range"], "a box stays inside the frame");
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: [{ id: "a", look: "custom", pill: { opacity: 33 } }] })), ["boxes[0].pill.opacity:range"], "steps of 5");
  // a video backdrop is accepted by the data (step 2), with its own keys
  assert.equal(M.checkComposition({ v: 1, backdrop: { src: VID, play: "once", sound: true }, boxes: [{ id: "a" }] }).ok, true);
  // 4 KB at most once canonical
  const big = { v: 1, backdrop: { src: SRC }, boxes: Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, content: { kind: "custom", text: "é".repeat(120) }, look: "custom", pill: { color: "#123456", opacity: 85, radius: 12 }, resolved: "#ffffff" })) };
  const rb = M.checkComposition(big);
  assert.equal(rb.ok, true, "4 complete boxes fit in 4 KB");
  assert.ok(M.canonicalComposition(rb.value).length <= M.LIMITS.bytes);
});

test("model: the texts are filled on the server, plain, bounded; an empty box is dropped; copying keeps each file's own backdrop", () => {
  const c = M.checkComposition({ v: 1, backdrop: { src: SRC }, boxes: [{ id: "a" }, { id: "b", content: { kind: "custom", text: "Merci {name} · {amount} bits" } }, { id: "c", content: { kind: "custom", text: "{text}" } }] }, { variables: ["name", "amount", "text"] }).value;
  const r = M.resolveComposition(c, { phrase: "Camille vous suit", values: { name: "<b>lune_douce</b>", amount: undefined, text: "" } });
  assert.deepEqual(r.boxes.map((b) => [b.id, b.text]), [["a", "Camille vous suit"], ["b", "Merci <b>lune_douce</b> · bits"]], "the value is text (set with textContent), a missing value leaves no doubled separator and no braces; {text} empty: the box is gone");
  assert.equal(M.resolveComposition(c, { phrase: "x".repeat(500) }).boxes[0].text.length, 200);
  assert.equal("content" in r.boxes[0], false);
  const copy = M.copyPlacement(c, GIF);
  assert.equal(copy.backdrop.src, GIF);
  assert.deepEqual(copy.boxes.map((b) => b.id), ["a", "b", "c"]);
  copy.boxes[0].x = 1;
  assert.notEqual(c.boxes[0].x, 1, "a deep copy");
  assert.equal(M.frameRatio("media", { width: 1000, height: 500 }), 2);
  assert.equal(M.frameRatio("media", null), 16 / 9);
  assert.equal(M.frameRatio("9:16"), 9 / 16);
});

/* ───────────── geometry ───────────── */

test("layout: move, resize (never under 4 %), magnet (edges, centre, safe margins, other boxes), keyboard, zoom", () => {
  assert.deepEqual(L.moveRect({ x: 90, y: 0, w: 20, h: 10 }, 5, -5), { x: 80, y: 0, w: 20, h: 10 }, "kept inside the frame");
  assert.deepEqual(L.resizeRect({ x: 10, y: 10, w: 20, h: 20 }, "se", 5, 5), { x: 10, y: 10, w: 25, h: 25 });
  assert.deepEqual(L.resizeRect({ x: 10, y: 10, w: 20, h: 20 }, "nw", 30, 30), { x: 26, y: 26, w: 4, h: 4 }, "the opposite corner stays, 4 % at least");
  assert.deepEqual(L.resizeRect({ x: 40, y: 40, w: 20, h: 20 }, "e", 5, 0, true), { x: 35, y: 40, w: 30, h: 20 }, "Alt: from the centre");
  const lines = L.snapLines("title", [{ x: 60, y: 60, w: 20, h: 10 }]);
  const near = L.snapMove({ x: 5.6, y: 30, w: 30, h: 10 }, lines, { x: 1, y: 1 });
  assert.equal(near.rect.x, 5, "the 5 % safe margin");
  assert.ok(near.guides.some((g) => g.kind === "margin"));
  assert.equal(L.snapMove({ x: 34.5, y: 30, w: 30, h: 10 }, lines, { x: 1, y: 1 }).rect.x, 35, "the centre of the frame (35 + 15 = 50)");
  assert.equal(L.snapMove({ x: 20, y: 59.4, w: 30, h: 10 }, lines, { x: 1, y: 1 }).rect.y, 60, "another box");
  assert.equal(L.snapMove({ x: 21.5, y: 20, w: 30, h: 10 }, lines, { x: 1, y: 1 }).guides.length, 0);
  assert.equal(L.snapResize({ x: 10, y: 10, w: 84.6, h: 10 }, "e", lines, { x: 1, y: 1 }).rect.w, 85, "the right margin (95 %)");
  assert.deepEqual(L.nudge({ x: 10, y: 10, w: 20, h: 20 }, "ArrowRight", {}), { x: 11, y: 10, w: 20, h: 20 });
  assert.deepEqual(L.nudge({ x: 10, y: 10, w: 20, h: 20 }, "ArrowDown", { shift: true }), { x: 10, y: 10.1, w: 20, h: 20 });
  assert.deepEqual(L.nudge({ x: 10, y: 10, w: 20, h: 20 }, "ArrowLeft", { ctrl: true }), { x: 0, y: 10, w: 20, h: 20 });
  assert.deepEqual(L.nudge({ x: 10, y: 10, w: 20, h: 20 }, "ArrowRight", { alt: true }), { x: 10, y: 10, w: 21, h: 20 }, "Alt + arrows resize");
  assert.equal(L.nudge({ x: 10, y: 10, w: 20, h: 20 }, "a", {}), null);
  assert.equal(L.stepZoom(0.68, 1), 0.75); assert.equal(L.stepZoom(0.75, 1), 1); assert.equal(L.stepZoom(1, -1), 0.75); assert.equal(L.stepZoom(4, 1), 4); assert.equal(L.stepZoom(0.25, -1), 0.25);
  assert.equal(L.fitZoom({ width: 1280, height: 720 }, { width: 640, height: 600 }), 0.5);
  assert.deepEqual(L.zoomAround({ left: 0, top: 0 }, { x: 100, y: 100 }, 1, 2), { left: 100, top: 100 }, "the point under the cursor stays put");
  assert.deepEqual(L.baseFrame(16 / 9, { width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.equal(L.placeOf({ x: 10, y: 73, w: 80, h: 22 }), "bc");
  assert.equal(L.placeOf({ x: 40, y: 40, w: 20, h: 20 }), "c");
  assert.ok(L.overlapShare({ x: 0, y: 0, w: 50, h: 50 }, { x: 25, y: 25, w: 50, h: 50 }) > 0.1);
  assert.equal(L.overlapShare({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 }), 0);
});

test("history: 50 steps, a drag is one step, the same state is not a step", () => {
  let h = Hs.startHistory(0);
  for (let i = 1; i <= 60; i++) h = Hs.record(h, i);
  assert.equal(h.past.length, Hs.HISTORY_MAX);
  assert.equal(Hs.record(h, 60), h);
  h = Hs.replace(h, 61);
  assert.equal(h.past.length, 50);
  h = Hs.undo(Hs.undo(h));
  assert.equal(h.present, 58);
  h = Hs.redo(h);
  assert.equal(h.present, 59);
  h = Hs.record(h, 100);
  assert.deepEqual(h.future, []);
  let e = Hs.startHistory("a");
  assert.equal(Hs.undo(e), e); assert.equal(Hs.redo(e), e);
});

/* ───────────── auto-shrink and colour ───────────── */

const engineOn = () => { const win = {}; R.composeEngine(win); return win.CuriosaCompose; };

test("auto-shrink: the largest size that fits, between the floor and the size, in 8 tries at most", () => {
  const E = engineOn();
  assert.deepEqual(E.fitFont(56, 32, () => true), { size: 56, overflow: false, tries: 1 });
  assert.deepEqual(E.fitFont(56, 32, () => false), { size: 32, overflow: true, tries: 2 });
  for (const limit of [33, 40, 47, 55]) {
    const r = E.fitFont(56, 32, (s) => s <= limit);
    assert.equal(r.size, limit); assert.equal(r.overflow, false); assert.ok(r.tries <= 8, `${r.tries} tries`);
  }
  const wide = E.fitFont(220, 24, (s) => s <= 25);
  assert.ok(wide.size >= 24 && wide.size <= 25 && wide.tries <= 8);
});

test("auto colour: dark text over a bright picture, white over a dark one; a stray pixel does not decide; nothing readable: white", () => {
  const fill = (rgb, n = 400) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4); return a; };
  assert.equal(C.pickTextColour(fill([245, 240, 220])).colour, "#111111");
  assert.equal(C.pickTextColour(fill([15, 15, 30])).colour, "#ffffff");
  const mostlyDark = fill([10, 10, 10]); mostlyDark.set([255, 255, 255, 255], 0);
  assert.equal(C.pickTextColour(mostlyDark).colour, "#ffffff");
  assert.deepEqual(C.pickTextColour(new Uint8ClampedArray(16)), { colour: "#ffffff", ratio: 0 });
  assert.equal(C.needsMeasure({ look: "bare", color: "auto" }), true);
  assert.equal(C.needsMeasure({ look: "element", color: "auto" }), false, "the element decides its own colours");
  assert.equal(C.needsMeasure({ look: "bare", color: "#ff0000" }), false);
});

test("engine: the readability presets are the appearance kit's; the script is self-contained and idempotent", () => {
  const E = engineOn();
  for (const k of K.LOOK_PRESETS) {
    assert.equal(E.presets[k].opacity, K.PRESET_VALUES[k].opacity, k);
    assert.equal(E.presets[k].outline, K.PRESET_VALUES[k].outline, k);
  }
  // the page script runs alone (nothing from the module around it), twice without harm
  const ctxv = vm.createContext({ window: {} });
  vm.runInContext(R.composeScript(), ctxv);
  const first = ctxv.window.CuriosaCompose;
  vm.runInContext(R.composeScript(), ctxv);
  assert.equal(ctxv.window.CuriosaCompose, first);
  assert.equal(typeof first.mount, "function");
  assert.doesNotMatch(R.composeScript(), /innerHTML|insertAdjacentHTML|eval\(|new Function/, "texts only through textContent");
  assert.doesNotMatch(R.COMPOSE_CSS, /url\(|@import|expression/);
  // a look made of closed values: an injected colour is ignored
  const lk = E.lookOf({ look: "readable", color: "red;background:url(x)", outline: "thin" }, 1);
  assert.doesNotMatch(JSON.stringify(lk), /url|red;/);
  assert.equal(composeKit.composeScript(), R.composeScript());
  assert.equal(Object.isFrozen(composeKit), true);
});

test("the appearance kit never overrides the colours or the outline of a placed text", () => {
  const css = K.lookCss(K.appliedLook({ preset: "discreet" }, { style: { text: "light", background: "transparent" }, skin: false }, true));
  assert.match(css, /\*:not\(\[data-ov-region="composition"\],\[data-ov-region="composition"\] \*\)\{text-shadow:var\(--ov-text-shadow\)!important\}/);
  assert.ok(!K.TEXT_PARTS.includes("compose-text") && !K.CONTAINER_PARTS.includes("compose-text"));
});

/* ───────────── automatic values ───────────── */

test("automatic values: stored with braces, shown as [Label] and chips, never braces", () => {
  const vars = [{ token: "name", label: "Pseudo", sample: "etoile_nord" }, { token: "amount", label: "Montant", sample: "500" }];
  assert.equal(T.toDisplay("Merci {name} pour {amount} bits {x}", vars), "Merci [Pseudo] pour [Montant] bits x");
  assert.equal(T.toStored("Merci [pseudo] pour [ Montant ] {oops} [autre]", vars), "Merci {name} pour {amount} oops [autre]");
  assert.deepEqual(T.segments("Merci {name}!", vars), [{ text: "Merci " }, { token: "name", label: "Pseudo" }, { text: "!" }]);
  assert.deepEqual(T.sampleValues(vars, "long"), { name: T.LONG_NAME, amount: "500" });
  assert.deepEqual(T.sampleValues(vars, "big"), { name: "etoile_nord", amount: "1 000 000" });
  assert.equal(T.LONG_NAME.length, 25, "the longest Twitch name");
  assert.equal(T.samplePhrase("Merci etoile_nord", vars, "long"), `Merci ${T.LONG_NAME}`);
});

test("compose option: read and bounded by the core", () => {
  const o = O.composeOption({ variables: [{ token: "name", label: "Pseudo {x}", sample: "etoile_nord" }, { token: "Bad-token", label: "x" }, { token: "name", label: "again" }, "x"], phrase: { label: "Phrase", sample: "Merci" }, formats: ["16:9", "nope"], defaultFormat: "media", maxBoxes: 9, testAction: "test reaction" });
  assert.deepEqual(o.variables, [{ token: "name", label: "Pseudo x", sample: "etoile_nord" }]);
  assert.deepEqual(o.formats, ["16:9"]);
  assert.equal(o.defaultFormat, undefined, "a default outside the formats is dropped");
  assert.equal(o.maxBoxes, 4);
  assert.equal(o.testAction, undefined);
  assert.equal(O.composeOption(null), null);
});

/* ───────────── gallery option and server check ───────────── */

test("gallery: a placed text is kept only in a field that declares compose, only when it checks out for that file; 12 files at most; 64 000 characters", () => {
  const rules = G.composeRules({ variables: [{ token: "name" }], maxBoxes: 2, formats: ["media", "16:9"] });
  const ok = M.defaultComposition(SRC);
  const raw = JSON.stringify([{ src: SRC, compose: ok }, { src: GIF }]);
  const read = G.readGallery(raw, { accept: ["image"], compose: rules });
  assert.equal(read.ok, true);
  assert.equal(read.items[0].compose.backdrop.src, SRC);
  assert.equal(G.readGallery(raw, { accept: ["image"] }).items[0].compose, undefined, "without the option: dropped, as before 0.19.0");
  assert.deepEqual(G.readGallery(JSON.stringify([{ src: GIF }, { src: SRC, compose: { ...ok, backdrop: { src: GIF } } }]), { accept: ["image"], compose: rules }), { ok: false, reason: "compose", index: 1 });
  assert.equal(G.readGallery(JSON.stringify([{ src: SRC, compose: { ...ok, boxes: [{ id: "a", content: { kind: "custom", text: "{amount}" } }] } }]), { accept: ["image"], compose: rules }).reason, "compose", "a value the field does not offer");
  assert.equal(G.writeGallery(read.items), `[{"src":"${SRC}","compose":${M.canonicalComposition(read.items[0].compose)}},{"src":"${GIF}"}]`);
  // the mark carries the rules; the server checks again, tells the module the field could place text, and forgets a mark posted by hand
  const mark = G.galleryMark(["image"], 40, 0, rules);
  assert.match(mark, /^image\|12\|0\|compose:name;2;media,16:9$/);
  assert.deepEqual(G.parseGalleryMark(mark).compose, rules);
  const values = { f: raw, f__gallery: mark, f__compose: "0" };
  assert.deepEqual(G.checkGalleryValues(values), {});
  assert.equal(values.f__compose, "1");
  const forged = { f: raw, f__gallery: G.galleryMark(["image"], 12, 0), f__compose: "1" };
  G.checkGalleryValues(forged);
  assert.equal(forged.f__compose, undefined);
  assert.equal(JSON.parse(forged.f)[0].compose, undefined);
  const bad = { f: JSON.stringify([{ src: SRC, compose: { v: 9 } }]), f__gallery: mark };
  assert.deepEqual(G.checkGalleryValues(bad), { f: { key: "gallery.error.compose", vars: { max: 12, min: 0, n: 1 } } });
  // field length: 64 000 only for such a gallery
  const long = "x".repeat(70_000);
  const bounded = G.boundFormValues([["f", long], ["f__gallery", mark], ["g", long], ["g__gallery", "image|12|0"], ["h", long], ["$ACTION_1", "x"]]);
  assert.equal(bounded.f.length, G.COMPOSE_FIELD_MAX);
  assert.equal(bounded.g.length, G.FIELD_MAX);
  assert.equal(bounded.h.length, G.FIELD_MAX);
  assert.equal("$ACTION_1" in bounded, false);
  // 12 compositions of 4 KB fit
  assert.ok(G.COMPOSE_GALLERY_MAX * (M.LIMITS.bytes + 120) < G.COMPOSE_FIELD_MAX);
});

test("module actions and transfers read fields through the bounded reader (no 20 000 cut for a gallery that places text)", () => {
  const actions = fs.readFileSync("src/app/admin/(panel)/instances/module-actions.ts", "utf8");
  assert.match(actions, /boundFormValues\(formData\.entries\(\)\)/);
  assert.doesNotMatch(actions, /v\.slice\(0, 20000\)/);
  assert.match(fs.readFileSync("src/core/modules/entryPanels.ts", "utf8"), /\|compose:/);
  assert.match(fs.readFileSync("src/core/modules/adminTransferHandlers.ts", "utf8"), /COMPOSE_FIELD_MAX/);
});

/* ───────────── markup and texts ───────────── */

const t = makeTranslator("fr");
const option = { variables: [{ token: "name", label: "Pseudo", sample: "etoile_nord" }], phrase: { label: "La phrase de la réaction", sample: "etoile_nord vous suit" }, testAction: "testReaction" };
const block = (value) => ({ type: "adminForm", action: "save", submitLabel: "Enregistrer la réaction", fields: [{ name: "variants", kind: "gallery", accept: ["image", "video"], label: "Images, GIF ou vidéos", value, compose: option }] });

test("gallery markup: Place the text on pictures only, Edit the text and With text when placed; two visible actions per tile, the moves in ⋯", () => {
  const value = JSON.stringify([{ src: SRC, compose: M.defaultComposition(SRC) }, { src: GIF }, { src: VID }]);
  const b = block(value);
  const html = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i", block: b, labels: formLabels(t, "fr", b) }));
  assert.equal((html.match(/data-gallery-compose=/g) ?? []).length, 2, "the picture and the GIF; the video has no button in this step");
  assert.match(html, />Modifier le texte</);
  assert.match(html, />Placer le texte</);
  assert.equal((html.match(/data-gallery-with-text/g) ?? []).length, 1);
  assert.match(html, /aria-label="Plus d&#x27;actions pour [^"]+"/);
  assert.match(html, /name="variants__gallery" value="image,video\|12\|0\|compose:name;4;/);
  // without the option the tile is what it was
  const plain = { ...b, fields: [{ ...b.fields[0], compose: undefined }] };
  const old = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i", block: plain, labels: formLabels(t, "fr", plain) }));
  assert.doesNotMatch(old, /data-gallery-compose|compose:/);
  assert.equal(formLabels(t, "fr", plain).compose, undefined, "the editor texts travel only with a gallery that places text");
});

test("texts: FR and EN parity, new words in the glossary, no braces, no code words, short labels", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = Object.keys(en).filter((k) => k.startsWith("compose."));
  assert.ok(keys.length > 100);
  for (const k of keys) {
    assert.ok(fr[k], `fr ${k}`);
    assert.deepEqual((fr[k].match(/\{\w+\}/g) ?? []).sort(), (en[k].match(/\{\w+\}/g) ?? []).sort(), k);
    assert.doesNotMatch(`${fr[k]} ${en[k]}`, /\b(JSON|API|token|jeton|slug|cache|clé|webhook)\b/i, k);
    assert.doesNotMatch(fr[k], /!$/, k);
  }
  for (const k of ["compose.place", "compose.use", "compose.test", "compose.f.text", "compose.f.size", "compose.f.look"]) assert.ok(fr[k].length <= 60 && !fr[k].endsWith(":"), k);
  const glossary = fs.readFileSync("docs/TRANSLATING.md", "utf8");
  for (const w of ["| composition | composition |", "| Place the text | Placer le texte |", "| backdrop | arrière-plan |", "| text box | zone de texte |", "| automatic value | valeur automatique |"]) assert.ok(glossary.includes(w), w);
});

/* ───────────── the engine in a real Chromium ───────────── */

let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

/** A small PNG (RGB) of a busy picture: circles of every colour on a bright or a dark ground. */
function busyPng(w, h, bright) {
  const px = Buffer.alloc((w * 3 + 1) * h);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const dots = Array.from({ length: 60 }, () => ({ x: rnd() * w, y: rnd() * h, r: 8 + rnd() * 60, c: [rnd(), rnd(), rnd()].map((v) => Math.round(bright ? 140 + v * 115 : v * 110)) }));
  for (let y = 0; y < h; y++) {
    px[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c = bright ? [244, 240, 224] : [12, 12, 20];
      for (const d of dots) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r ** 2) c = d.c;
      px.set(c, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(px)), chunk("IEND", Buffer.alloc(0))]);
}

test("real browser: sizes follow the frame height, long names shrink to the floor then cut, the frame stays whole in any element, texts are text, the kit's outline does not win", { skip: skipBrowser, timeout: 90000 }, async () => {
  const pngs = { [SRC]: busyPng(320, 180, true), [GIF.replace(".gif", ".png")]: busyPng(320, 180, false) };
  const DARK = GIF.replace(".gif", ".png");
  const kitCss = K.lookCss(K.appliedLook({ preset: "discreet" }, { style: { text: "light", background: "transparent" }, skin: false }, true));
  const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#333}#a,#b,#c{position:relative;display:inline-block;margin:4px}#a{width:640px;height:360px}#b{width:640px;height:260px}#c{width:320px;height:180px}${R.COMPOSE_CSS}${kitCss}</style>
    <div id="a"></div><div id="b"></div><div id="c"></div><script>${R.composeScript()}</script>`;
  const server = http.createServer((req, res) => {
    if (pngs[req.url]) { res.setHeader("content-type", "image/png"); return res.end(pngs[req.url]); }
    res.setHeader("content-type", "text/html; charset=utf-8"); res.end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    await p.evaluate(() => document.documentElement.setAttribute("data-ov-look", ""));
    const comp = (src, boxes, format = "16:9") => M.resolveComposition(M.checkComposition({ v: 1, format, backdrop: { src }, boxes }, { variables: ["name"] }).value, { phrase: "Merci etoile_nord", values: { name: '<img src=x onerror="window.hacked=1">' } });
    const a = comp(SRC, [{ id: "a", look: "readable" }, { id: "b", y: 5, h: 15, content: { kind: "custom", text: "{name}" }, look: "bare" }]);
    const longText = comp(DARK, [{ id: "a", x: 30, w: 40, h: 12, size: 72, minSize: 32, maxLines: 1, content: { kind: "custom", text: `Merci ${T.LONG_NAME} ${T.LONG_NAME}` } }]);
    const r = await p.evaluate(async ([a, l]) => {
      const E = window.CuriosaCompose;
      const ra = E.mount(document.getElementById("a"), a, { motion: false });
      const rb = E.mount(document.getElementById("b"), a, { motion: false });
      const rc = E.mount(document.getElementById("c"), l, { motion: false });
      await new Promise((ok) => setTimeout(ok, 400));
      const box = (root, i) => { const b = root.querySelectorAll(".cmp-box")[i], s = b.firstChild, cs = getComputedStyle(s); return { size: Number(b.dataset.size), overflow: b.dataset.overflow === "1", font: parseFloat(cs.fontSize), color: cs.color, bg: cs.backgroundColor, shadow: cs.textShadow, text: s.textContent, lines: Math.round(s.getBoundingClientRect().height / (parseFloat(cs.fontSize) * 1.15)) }; };
      const rect = (n) => n.getBoundingClientRect().toJSON();
      return { a0: box(ra, 0), a1: box(ra, 1), c0: box(rc, 0), ra: rect(ra), rb: rect(rb), hostB: rect(document.getElementById("b")), label: ra.getAttribute("aria-label"), hacked: !!window.hacked, imgs: ra.querySelectorAll("img").length };
    }, [a, longText]);
    // 56 px on a 1080 frame → 56 × 360 / 1080 on a 360-high frame
    assert.ok(Math.abs(r.a0.font - 56 * 360 / 1080) < 0.6, `font ${r.a0.font}`);
    assert.equal(r.a0.color, "rgb(255, 255, 255)");
    assert.match(r.a0.bg, /rgba\(20, 23, 28, 0\.85\)/, "Readable everywhere: the dark band at 85 %");
    assert.match(r.a1.shadow, /rgba\(0, 0, 0, 0\.9\)/, "bare text keeps its own outline under the kit");
    assert.equal(r.a1.text, '<img src=x onerror="window.hacked=1">', "a value is text");
    assert.equal(r.hacked, false); assert.equal(r.imgs, 1, "only the backdrop");
    assert.equal(r.label, 'Merci etoile_nord · <img src=x onerror="window.hacked=1">');
    // the long name: shrunk to the floor, then cut on one line
    assert.ok(r.c0.size >= 32 && r.c0.size < 72, `size ${r.c0.size}`);
    assert.equal(r.c0.overflow, true);
    assert.ok(r.c0.lines <= 1, `${r.c0.lines} lines`);
    // 16:9 in a 640×260 element: whole, centred, bands on the sides
    assert.equal(Math.round(r.rb.height), 260);
    assert.equal(Math.round(r.rb.width), Math.round(260 * 16 / 9));
    assert.ok(Math.abs((r.rb.left - r.hostB.left) - (r.hostB.right - r.rb.right)) <= 1);
    assert.equal(Math.round(r.ra.width), 640);
    // "media" format: the file's own shape once loaded
    const media = await p.evaluate(async (c) => { const host = document.getElementById("a"); host.replaceChildren(); const root = window.CuriosaCompose.mount(host, c, { motion: false }); await new Promise((ok) => setTimeout(ok, 400)); return root.getAttribute("data-ratio"); }, comp(SRC, [{ id: "a" }], "media"));
    assert.equal(Number(media), 1.778);
    if (process.env.COMPOSE_SHOTS) await p.screenshot({ path: `${process.env.COMPOSE_SHOTS}/engine.png` });
  } finally { await browser.close(); server.close(); }
});
