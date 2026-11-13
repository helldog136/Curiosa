// Gallery field (`kind: "gallery"`, core 0.14.0) and extra form buttons (`extraActions`): the pure rules, the server checks, the markup (page and dialog), the keyboard and
// accessibility contract, FR/EN parity and the test kit. The behaviour in a real browser (several files at once, drag and drop, progress, remove, reorder, focus) is checked with
// Playwright (screenshots listed in the pull request).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeTempDir } from "../helpers/tmp.mjs";
import * as F from "../helpers/audio-fixtures.mjs";

const dir = makeTempDir("curiosa-gallery-");
process.env.DATA_DIR = dir;
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (f) => fs.readFileSync(f, "utf8");
const G = await import("@/core/gallery");
const U = await import("@/core/services/uploads");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { adminPageErgonomicsProblems } = await import("../../testsupport/index.mjs");
const { galleryProblems } = await import("../../testsupport/requirements/runtime.mjs");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const uid = (n, ext = "png") => `/uploads/${String(n).padStart(8, "0")}-0000-4000-8000-000000000000.${ext}`;
const item = (n, ext, label) => (label ? { src: uid(n, ext), label } : { src: uid(n, ext) });

/* ───────────── pure rules ───────────── */

test("readGallery: JSON list, array, or one address per line; canonical output; empty is an empty list", () => {
  const ok = (raw, opts) => { const r = G.readGallery(raw, opts); assert.equal(r.ok, true, JSON.stringify(r)); return r.items; };
  assert.deepEqual(ok(""), []);
  assert.deepEqual(ok("   "), []);
  assert.deepEqual(ok(JSON.stringify([item(1), item(2, "jpg", "  Night   shot ")])), [item(1), item(2, "jpg", "Night shot")]);
  assert.deepEqual(ok([uid(1), uid(2, "webp")]), [item(1), item(2, "webp")]);
  assert.deepEqual(ok(`${uid(1)}\n${uid(2, "gif")}\r\n`), [item(1), item(2, "gif")]);
  assert.deepEqual(ok(JSON.stringify([item(1), item(1), item(2)])), [item(1), item(2)], "a duplicate is kept once, first place");
  assert.equal(G.writeGallery([item(1, "png", "A"), item(2)]), JSON.stringify([item(1, "png", "A"), item(2)]));
  assert.equal(G.writeGallery(G.readGallery(JSON.stringify([{ src: uid(1), label: "" }, { src: uid(2), extra: 1 }])).items), JSON.stringify([item(1), item(2)]), "empty labels and unknown keys are dropped");
  assert.equal(ok(JSON.stringify([{ src: uid(1), label: "x".repeat(300) }]))[0].label.length, G.GALLERY_LABEL_MAX);
  assert.equal(ok(JSON.stringify([{ src: uid(1), label: "a\u0000b\nc" }]))[0].label, "a b c", "control characters never reach the module");
});

test("readGallery: every address is one of the site's uploads of an accepted kind; nothing else passes", () => {
  const bad = (raw, opts, reason) => assert.deepEqual(G.readGallery(raw, opts), { ok: false, reason }, JSON.stringify(raw));
  for (const src of [
    "https://evil.example/a.png", "//evil.example/a.png", "http://127.0.0.1/uploads/x.png", `${uid(1)}?c=1,1,0.5,0.5,ffffff`, `${uid(1)}#x`, `/uploads/../${uid(1).slice(9)}`, `/data${uid(1)}`,
    `/uploads/sub/${uid(1).slice(9)}`, "/uploads/x.png", uid(1, "svg"), uid(1, "php"), uid(1, "png.php"), `${uid(1)}\n`, `javascript:alert(1)`, "data:image/png;base64,AAAA", "", "uploads/x", `/uploads/%2e%2e/${uid(1).slice(9)}`,
  ]) bad(JSON.stringify([{ src }]), { accept: ["image", "video", "audio"] }, "address");
  bad([42], {}, "format");
  bad([{ nosrc: 1 }], {}, "format");
  bad("{not json", {}, "format");
  bad("[1, 2", {}, "format");
  bad({ src: uid(1) }, {}, "format");
  bad([uid(1, "mp4")], { accept: ["image"] }, "address");
  bad([uid(1, "mp3")], { accept: ["image", "video"] }, "address");
  bad([uid(1)], { accept: ["audio"] }, "address");
  assert.equal(G.readGallery([uid(1, "mp4"), uid(2, "mp3"), uid(3, "gif")], { accept: ["image", "video", "audio"] }).ok, true);
  assert.equal(G.readGallery([uid(1)], { accept: "image,video" }).ok, true, "accept also reads a comma list");
});

test("readGallery: min, max and defaults", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => uid(i + 1));
  assert.equal(G.readGallery(many(12)).ok, true, "12 by default");
  assert.deepEqual(G.readGallery(many(13)), { ok: false, reason: "many" });
  assert.equal(G.readGallery(many(3), { max: 3 }).ok, true);
  assert.deepEqual(G.readGallery(many(4), { max: 3 }), { ok: false, reason: "many" });
  assert.deepEqual(G.readGallery(many(1), { min: 2 }), { ok: false, reason: "few" });
  assert.deepEqual(G.readGallery("", { min: 1 }), { ok: false, reason: "few" });
  assert.equal(G.galleryMax(500), G.GALLERY_HARD_MAX);
  assert.equal(G.galleryMax(0), 12); assert.equal(G.galleryMax("x"), 12); assert.equal(G.galleryMax(2.5), 12); assert.equal(G.galleryMax("7"), 7);
  assert.equal(G.galleryMin(99, 5), 5); assert.equal(G.galleryMin(-1, 5), 0);
  assert.deepEqual(G.galleryAccept(undefined), ["image"]); assert.deepEqual(G.galleryAccept([]), ["image"]); assert.deepEqual(G.galleryAccept(["audio", "image", "x", "image"]), ["image", "audio"]); assert.deepEqual(G.galleryAccept(["bogus"]), ["image"]);
});

test("checkGalleryValues: rebuilds the canonical text, removes the mark, reports problems by field; a form without the mark is left alone", () => {
  const values = { id: "1", pics: ` ${JSON.stringify([item(1, "png", " A "), item(1)])} `, pics__gallery: G.galleryMark(["image"], 3, 0), other: "x" };
  assert.deepEqual(G.checkGalleryValues(values), {});
  assert.equal(values.pics, JSON.stringify([item(1, "png", "A")]));
  assert.ok(!("pics__gallery" in values));
  assert.equal(values.other, "x");
  const bad = { pics: JSON.stringify([{ src: "https://evil.example/a.png" }]), pics__gallery: G.galleryMark(["image"], 3, 0), s: JSON.stringify([uid(1, "mp3")]), s__gallery: G.galleryMark(["video"], 3, 0), few: "[]", few__gallery: G.galleryMark(["image"], 3, 2), many: JSON.stringify([uid(1), uid(2), uid(3)]), many__gallery: G.galleryMark(["image"], 2, 0) };
  const problems = G.checkGalleryValues(bad);
  assert.equal(problems.pics.key, "gallery.error.address");
  assert.equal(problems.s.key, "gallery.error.address", "a kind the field does not accept");
  assert.deepEqual(problems.few, { key: "gallery.error.few", vars: { max: 3, min: 2 } });
  assert.deepEqual(problems.many, { key: "gallery.error.many", vars: { max: 2, min: 0 } });
  const free = { pics: "https://evil.example/a.png" };
  assert.deepEqual(G.checkGalleryValues(free), {}, "no mark: the module checks (claim refuses it anyway)");
  assert.deepEqual(G.parseGalleryMark("video,audio|7|2"), { accept: ["video", "audio"], max: 7, min: 2 });
  assert.deepEqual(G.parseGalleryMark("garbage"), { accept: ["image"], max: 12, min: 0 }, "a tampered mark falls back to the strictest default");
});

test("galleryLibrary keeps only named items of an accepted kind with an address of the site", () => {
  const lib = G.galleryLibrary([{ label: "Sunrise", value: uid(1), kind: "image" }, { label: "Sound", value: uid(2, "mp3"), kind: "audio" }, { label: "Outside", value: "https://evil.example/a.png", kind: "image" }, { label: "", value: uid(3), kind: "image" }, { label: "Crop", value: `${uid(4)}?c=1`, kind: "image" }, null, 4], ["image"]);
  assert.deepEqual(lib, [{ label: "Sunrise", value: uid(1), kind: "image" }]);
  assert.equal(G.galleryLibrary(Array.from({ length: 900 }, (_, i) => ({ label: `n${i}`, value: uid(i + 1), kind: "image" })), ["image"]).length, G.GALLERY_LIBRARY_MAX);
  assert.deepEqual(G.galleryLibrary("nope", ["image"]), []);
});

/* ───────────── server: the upload checks the BYTES against the declared kinds ───────────── */

test("saveUpload with `only`: each declared kind passes, every other kind and every spoofed file is refused", async () => {
  const files = { image: F.PNG, video: F.MP4_VIDEO, audio: F.mp3Raw() };
  const ext = { image: /\.png$/, video: /\.mp4$/, audio: /\.mp3$/ };
  for (const [kind, buf] of Object.entries(files)) {
    for (const [other] of Object.entries(files)) {
      const url = await U.saveUpload(buf, { only: [other] });
      if (other === kind) { assert.match(url, ext[kind], `${kind} accepted when declared`); assert.match(url, G.GALLERY_URL_RE[kind]); }
      else assert.equal(url, null, `${kind} refused when only ${other} is declared`);
    }
    assert.match(await U.saveUpload(buf, { only: ["image", "video", "audio"] }), G.GALLERY_URL_RE[kind]);
  }
  assert.match(await U.saveUpload(F.WEBM, { only: ["video"] }), /\.webm$/);
  // Spoofed: a script with an image name, text, an HTML page, an SVG, a truncated sound, zeros.
  for (const [name, buf] of Object.entries({ script: Buffer.from("<script>alert(1)</script>".repeat(5)), html: Buffer.from("<html>" + " ".repeat(40)), svg: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>" + " ".repeat(40)), truncated: F.mp3Frame().subarray(0, 20), zeros: Buffer.alloc(2048), empty: Buffer.alloc(0) })) {
    assert.equal(await U.saveUpload(buf, { only: ["image", "video", "audio"] }), null, name);
    assert.equal(U.uploadProblem(buf, { only: ["image", "video", "audio"] }), "format", name);
  }
  // Without `only` (every other caller): the same as before.
  assert.match(await U.saveUpload(F.PNG), /\.png$/); assert.match(await U.saveUpload(F.mp3Raw()), /\.mp3$/);
  assert.equal(await U.saveUpload(F.PNG, { only: "audio" }), null);
});

test("uploadProblem tells a refused kind from a file that is too large, with the caps of the single upload fields", () => {
  const big = (n) => Buffer.concat([F.PNG, Buffer.alloc(n)]);
  assert.equal(U.uploadProblem(big(U.MAX_UPLOAD_BYTES - 1000), { only: ["image"] }), null);
  assert.equal(U.uploadProblem(big(U.MAX_UPLOAD_BYTES + 1), { only: ["image"] }), "size");
  assert.equal(U.uploadProblem(Buffer.concat([F.mp3Raw(), Buffer.alloc(U.MAX_AUDIO_BYTES)]), { only: ["audio"] }), "size");
  assert.equal(U.uploadProblem(F.PNG, { only: ["audio"] }), "format");
  assert.equal(G.GALLERY_MAX_BYTES.image, 5 * 1048576); assert.equal(G.GALLERY_MAX_BYTES.audio, 10 * 1048576); assert.equal(G.GALLERY_MAX_BYTES.video, 50 * 1048576);
});

test("the upload route reads the declared kinds, nothing else, and the form actions re-check the list", () => {
  const route = read("src/app/api/admin/upload/route.ts");
  assert.match(route, /kind === "gallery" \? \{ only: galleryAccept\(/);
  assert.match(route, /uploadProblem\(buf, opts\)/);
  assert.match(read("src/app/admin/(panel)/instances/module-actions.ts"), /checkGalleryValues\(values\)/);
  assert.match(read("src/core/modules/adminTransferHandlers.ts"), /checkGalleryValues\(values\)/, "the file-field route checks it too");
});

/* ───────────── markup: in a form and in a dialog ───────────── */

const field = (extra = {}) => ({ name: "pics", label: "Pictures", kind: "gallery", ...extra });
const form = (fields, extra = {}) => ({ type: "adminForm", action: "save", title: "Edit alert", submitLabel: "Save the alert", cancelHref: "?", fields: [{ name: "id", kind: "hidden", label: "id", value: "a1" }, ...fields], ...extra });
const render = (block, lang = "en", entry) => renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block, entry, labels: formLabels(makeTranslator(lang), lang, block) }));
const list = (n, ext = "png") => JSON.stringify(Array.from({ length: n }, (_, i) => item(i + 1, ext)));
const hiddenValue = (html) => JSON.parse(/<input[^>]*data-gallery-value[^>]*>/.exec(html)[0].match(/ value="([^"]*)"/)[1].replaceAll("&quot;", '"'));

test("empty: one label, the add tile, the counter; the value is an empty list and the mark carries the rules", () => {
  const html = render(form([field({ accept: ["image", "video"], max: 5, min: 1 })]));
  assert.match(html, /data-gallery=""/);
  assert.match(html, /data-gallery-empty="">No file yet</);
  assert.match(html, /data-gallery-add=""[^>]*>[\s\S]*?Add files/);
  assert.match(html, /data-gallery-counter="">0 of 5</);
  assert.deepEqual(hiddenValue(html), []);
  assert.match(html, /name="pics__gallery" value="image,video\|5\|1"/);
  assert.match(html, /<input[^>]*type="file"[^>]*multiple[^>]*accept="image\/png,image\/jpeg,image\/webp,image\/gif,video\/mp4,video\/webm"|<input[^>]*accept="image\/png[^"]*"[^>]*multiple/);
  assert.equal((html.match(/data-gallery-item=/g) ?? []).length, 0);
});

test("one, three and twelve items: ordered tiles, a remove button and two move buttons each, named for screen readers, 44 px targets, a grid that wraps", () => {
  for (const n of [1, 3, 12]) {
    const html = render(form([field({ value: list(n) })]));
    assert.equal((html.match(/data-gallery-item=/g) ?? []).length, n);
    assert.equal((html.match(/data-gallery-remove=/g) ?? []).length, n);
    assert.equal((html.match(/data-gallery-move=/g) ?? []).length, n * 2);
    assert.match(html, new RegExp(`data-gallery-counter="">${n} of 12<`));
    assert.deepEqual(hiddenValue(html), JSON.parse(list(n)));
    assert.match(html, /aria-label="Remove Image 1"/);
    assert.match(html, /aria-label="Move Image 1 towards the end"/);
    assert.match(html, /aria-label="Image 1, 1 of /);
    assert.match(html, /grid-cols-\[repeat\(auto-fill,minmax\(9\.5rem,1fr\)\)\]/, "wraps: two tiles on a 390 px phone");
    assert.match(html, /h-11 w-11/, "44 px tap targets");
  }
  const three = render(form([field({ value: list(3) })]));
  assert.equal((three.match(/data-gallery-move="[^"]*:earlier"[^>]*aria-disabled="true"/g) ?? []).length, 1, "the first item cannot move earlier (still focusable)");
  assert.equal((three.match(/aria-disabled="true"[^>]*data-gallery-move="[^"]*:later"|data-gallery-move="[^"]*:later"[^>]*aria-disabled="true"/g) ?? []).length, 1);
  assert.match(three, /<ul role="list"/);
  assert.match(three, /role="group" aria-label="Pictures"/);
});

test("kinds: a picture, a video poster and a sound icon, each with its name; a caption field only with `itemLabel`", () => {
  const value = JSON.stringify([item(1, "png"), item(2, "mp4"), item(3, "mp3", "Fanfare")]);
  const html = render(form([field({ accept: ["image", "video", "audio"], value, itemLabel: true })]));
  assert.match(html, /<img src="\/uploads\/00000001[^"]*\.png" alt=""/);
  assert.match(html, /<video src="\/uploads\/00000002[^"]*\.mp4#t=0\.1" muted=""/);
  assert.match(html, />♪</);
  assert.match(html, />Fanfare</);
  assert.match(html, /aria-label="Caption of Image 1"/);
  assert.doesNotMatch(render(form([field({ value })])), /Caption of/);
});

test("maximum reached: the add tile gives way to a message; an unreadable saved value shows an empty gallery, never a crash", () => {
  const full = render(form([field({ value: list(2), max: 2 })]));
  assert.match(full, /data-gallery-full="">Maximum reached</);
  assert.doesNotMatch(full, /data-gallery-add=/);
  const broken = render(form([field({ value: "{oops" })]));
  assert.match(broken, /data-gallery-empty=/);
  assert.match(broken, /data-gallery-add=/);
});

test("library: a list to pick from is behind a button (closed by default); without entries, no button", () => {
  const lib = [{ label: "Sunrise", value: uid(9), kind: "image" }, { label: "Bad", value: "https://evil.example/a.png", kind: "image" }];
  const html = render(form([field({ library: lib })]));
  assert.match(html, /data-gallery-library-toggle=""[^>]*>Choose from the site</);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Sunrise/, "closed: nothing listed");
  assert.doesNotMatch(render(form([field({})])), /library-toggle/);
  assert.doesNotMatch(render(form([field({ library: [lib[1]] })])), /library-toggle/, "an outside address is dropped, so nothing to pick");
});

test("example and help: under the field, the example in full words; the field has a visible label and a name", () => {
  const html = render(form([field({ example: "wave.png", help: "x" })]));
  assert.match(html, /data-field-example="">Par exemple|data-field-example="">For example/);
  assert.match(html, /<label[^>]*>Pictures<\/label>/);
});

test("in a dialog: the same field inside the window, the footer has ONE main button and the extra buttons; in the page too", () => {
  const block = form([field({ value: list(3) })], { presentation: "dialog", extraActions: [{ label: "Test the alert", action: "test" }, { label: "Preview the alert", action: "preview" }, { label: "A third one", action: "third" }] });
  const html = render(block);
  assert.match(html, /role="dialog"/);
  assert.match(html, /data-testid="edit-dialog-form"[^>]*>[\s\S]*data-gallery=""/, "the gallery is in the dialog form");
  assert.equal((html.match(/data-testid="edit-dialog-submit"/g) ?? []).length, 1, "ONE main button");
  assert.match(html, />Test the alert</); assert.match(html, />Preview the alert</);
  assert.doesNotMatch(html, /A third one/, "two extra buttons at most");
  assert.ok(html.indexOf("form-extra-0") < html.indexOf("edit-dialog-submit"), "extra buttons sit before the main button");
  assert.ok(html.indexOf("edit-dialog-cancel") < html.indexOf("form-extra-0"));
  assert.match(html, /<button[^>]*type="button"[^>]*data-testid="form-extra-0"|<button[^>]*data-testid="form-extra-0"[^>]*type="button"/, "an extra button is not a submit button");
  const page = render({ ...block, presentation: undefined });
  assert.doesNotMatch(page, /role="dialog"/);
  assert.match(page, /data-testid="form-extra-1"/);
  assert.doesNotMatch(render(form([field({})], { presentation: "dialog" })), /form-extra/, "no extra buttons unless asked");
});

test("a form with a gallery AND a file field stays valid: the field renders in the file form too", () => {
  const html = render(form([field({}), { name: "csv", label: "List", kind: "file" }]));
  assert.match(html, /data-gallery=""/);
});

test("without the gallery texts (another caller) or in an old core: a plain text field holding the list, nothing lost", () => {
  const block = form([field({ value: list(1) })]);
  const labels = formLabels(makeTranslator("en"), "en", block);
  const html = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block, labels: { ...labels, gallery: undefined } }));
  assert.doesNotMatch(html, /data-gallery=/);
  assert.match(html, /name="pics"/);
  assert.equal(formLabels(makeTranslator("en"), "en", form([{ name: "t", label: "T" }])).gallery, undefined, "the texts only travel with a form that has a gallery");
});

/* ───────────── accessibility and keyboard, as written in the source ───────────── */

test("every control is a real button reachable by keyboard; focus follows a move or a removal; progress and errors are announced", () => {
  const src = read("src/components/admin/GalleryField.tsx");
  assert.match(src, /onClick=\{\(\) => picker\.current\?\.click\(\)\}/, "the add tile is a button that opens the picker (Enter, Space)");
  assert.match(src, /role="progressbar"[^>]*aria-valuenow=\{entry\.pct\}/);
  assert.match(src, /role="alert" data-gallery-error=/);
  assert.match(src, /aria-live="polite"[^>]*data-gallery-live/);
  assert.match(src, /aria-disabled=\{index === 0 \|\| undefined\}/, "boundary move buttons stay focusable");
  assert.match(src, /focusAfter\.current = \{ move:/);
  assert.match(src, /focusAfter\.current = \{ remove: index \}/);
  assert.match(src, /e\.key === "Enter"\) e\.preventDefault\(\)/, "Enter in a caption never saves the form");
  assert.match(src, /e\.key === "Escape"/, "Esc closes the library list");
  assert.match(src, /form\.addEventListener\("submit", guard, true\)/, "saving waits for files still sending");
  assert.match(src, /type="file" multiple/);
  assert.match(src, /onDrop:/);
  assert.match(src, /dataTransfer\?\.types\?\.includes\("Files"\)/);
  assert.match(src, /new Event\("input", \{ bubbles: true \}\)/, "the dialog's discard question hears every change");
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(src, /https?:\/\//, "no outside address in the component");
});

/* ───────────── locales ───────────── */

test("FR and EN have the same gallery keys and the same {variables}; texts follow the tone rules", () => {
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  const keys = (d) => Object.keys(d).filter((k) => k.startsWith("gallery.")).sort();
  assert.deepEqual(keys(en), keys(fr));
  assert.ok(keys(en).length > 40);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys(en)) {
    assert.equal(vars(en[k]), vars(fr[k]), k);
    for (const text of [en[k], fr[k]]) {
      assert.doesNotMatch(text, /!/, k); assert.doesNotMatch(text, /Veuillez|Please/, k);
      assert.ok(text.split(/[.?]\s/).every((s) => s.split(/\s+/).length <= 20), `${k}: sentence of 20 words at most`);
    }
  }
  // Errors under the field say what to do with an example (R22).
  for (const k of ["gallery.error.type", "gallery.error.size", "gallery.error.many", "gallery.error.few", "gallery.error.address"]) {
    assert.match(en[k], /for example|Choose|Remove|Add/, k);
    assert.match(fr[k], /par exemple|Choisissez|Retirez|Ajoutez/, k);
  }
  assert.match(en["gallery.error.type"], /for example \{example\}/); assert.match(fr["gallery.error.type"], /par exemple \{example\}/);
  // The French render has French words.
  assert.match(render(form([field({})]), "fr"), /Ajouter des fichiers/);
  assert.match(render(form([field({ value: list(1) })]), "fr"), /aria-label="Retirer Image 1"/);
});

/* ───────────── the test kit ───────────── */

test("kit: a gallery counts as ONE field (R4); the extra buttons are checked (R3); options are validated", () => {
  const six = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, label: `Field ${i}`, example: "x" }));
  const withGallery = form([...six.slice(0, 4), field({ value: list(12), itemLabel: true, library: [{ label: "A", value: uid(1), kind: "image" }] })]);
  assert.deepEqual(adminPageErgonomicsProblems([withGallery]).filter((p) => p.rule === "R4"), [], "4 fields + a gallery of 12 items = 5 fields");
  assert.equal(adminPageErgonomicsProblems([form([...six, field({})])]).filter((p) => p.rule === "R4").length, 1, "5 fields + a gallery = 6");
  assert.equal(adminPageErgonomicsProblems([form([field({})], { extraActions: [{ label: "OK", action: "t" }] })]).filter((p) => p.rule === "R3").length, 1);
  assert.equal(adminPageErgonomicsProblems([form([field({})], { extraActions: [{ label: "Save the alert", action: "t" }] })]).filter((p) => p.rule === "R3").length, 1, "the label of the main button");
  assert.deepEqual(adminPageErgonomicsProblems([form([field({})], { extraActions: [{ label: "Test the alert", action: "t" }] })]), []);
  assert.deepEqual(galleryProblems(form([field({ accept: ["image", "audio"], max: 8, min: 1, value: list(2), library: [{ label: "A", value: uid(1), kind: "image" }] })])), []);
  for (const bad of [{ accept: ["pdf"] }, { accept: "image" }, { max: 99 }, { max: 0 }, { min: 5, max: 3 }, { library: [{ label: "A", value: "https://evil.example/a.png", kind: "image" }] }, { value: "not json" }, { value: JSON.stringify([{ src: "https://evil.example/a.png" }]) }]) {
    assert.equal(galleryProblems(form([field(bad)])).length, 1, JSON.stringify(bad));
  }
});

test("kit: blocks.valid refuses malformed extraActions and gallery options; probes feed a gallery field a canonical list", () => {
  const rt = read("testsupport/requirements/runtime.mjs");
  assert.match(rt, /adminForm\.extraActions must be a list of two entries at most/);
  assert.match(rt, /galleryProblems\(b\)/);
  assert.match(read("testsupport/probes.mjs"), /kindOf\.get\(n\) === "gallery" \? GALLERY_SAMPLE/);
  assert.match(read("testsupport/requirements/manifest.mjs"), /since: "0\.14\.0", label: "un champ de formulaire « gallery »/);
});
