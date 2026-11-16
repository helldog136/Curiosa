// The inline preview of a reaction (core 0.27.0): under the files of a gallery that places text, the alert drawn by the SAME engine as the overlay. The markup
// (shown only with files, one button per file when there are several, the sentence under a file without text, the three grounds, the play button), the sentence
// that follows a field of the form (`phraseField`), the light still picture of a video (first picture only), and the engine in a REAL Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const M = await import("@/core/compose/model");
const R = await import("@/core/compose/render");
const O = await import("@/core/compose/option");
const { fillPhrase } = await import("@/components/admin/ReactionPreview");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const SRC = "/uploads/00000001-0000-4000-8000-000000000000.png";
const GIF = "/uploads/00000002-0000-4000-8000-000000000000.gif";
const VID = "/uploads/00000003-0000-4000-8000-000000000000.webm";
const SND = "/uploads/00000004-0000-4000-8000-000000000000.mp3";
const t = makeTranslator("fr");
const option = { variables: [{ token: "name", label: "Pseudo", sample: "etoile_nord" }, { token: "amount", label: "Montant", sample: "500" }], phrase: { label: "La phrase de la réaction", sample: "etoile_nord vous suit" }, testAction: "testReaction", video: true, phraseField: "text" };
const block = (value, compose = option) => ({ type: "adminForm", action: "save", submitLabel: "Enregistrer la réaction", fields: [{ name: "variants", kind: "gallery", accept: ["image", "video"], label: "Images, GIF ou vidéos", value, ...(compose ? { compose } : {}) }, { name: "text", label: "Phrase", value: "" }] });
const render = (b) => renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i", block: b, labels: formLabels(t, "fr", b) }));

test("option: phraseField is a field name or nothing", () => {
  assert.equal(O.composeOption({ phraseField: "text" }).phraseField, "text");
  assert.equal(O.composeOption({ phraseField: "a b" }).phraseField, undefined);
  assert.equal(O.composeOption({ phraseField: "<x>" }).phraseField, undefined);
  assert.equal(O.composeOption({}).phraseField, undefined, "an older module: the sample sentence");
});

test("the sentence of the preview: what is typed, its words filled with the samples; empty: the module's sample", () => {
  const o = O.composeOption(option);
  assert.equal(fillPhrase(null, o), "etoile_nord vous suit");
  assert.equal(fillPhrase("   ", o), "etoile_nord vous suit");
  assert.equal(fillPhrase("Merci {name} pour {amount} points", o), "Merci etoile_nord pour 500 points");
  assert.equal(fillPhrase("Merci {name} {months}", o), "Merci etoile_nord", "a word without a sample gives nothing, never braces");
  assert.equal(fillPhrase("<b>{name}</b>", o), "<b>etoile_nord</b>", "plain text: the engine sets it with textContent");
  assert.ok(fillPhrase("x".repeat(500), o).length <= 200);
});

test("markup: the preview shows under the files, one button per file when there are several, the play button, the three grounds; nothing without files or without the option", () => {
  const one = render(block(JSON.stringify([{ src: SRC, compose: M.defaultComposition(SRC) }])));
  assert.match(one, /data-reaction-preview=""/);
  assert.match(one, />Aperçu de l&#x27;alerte</);
  assert.match(one, /data-testid="rpv-play"[^>]*aria-label="Lire"/);
  for (const k of ["checker", "dark", "light"]) assert.match(one, new RegExp(`data-testid="rpv-bg-${k}"`));
  assert.match(one, /data-testid="rpv-bg-checker"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="rpv-bg-checker"/);
  assert.doesNotMatch(one, /data-testid="rpv-files"/, "one file: no chooser");
  assert.doesNotMatch(one, /data-testid="rpv-phrase"/, "a placed text: the sentence is in the frame");
  assert.doesNotMatch(one, /data-testid="rpv-sound"/, "a picture has no sound button");
  // several files: a chooser with a name for each button; a file without text: the sentence under the frame
  const many = render(block(JSON.stringify([{ src: GIF }, { src: VID }, { src: SRC }])));
  assert.equal((many.match(/data-rpv-file=/g) ?? []).length, 3);
  assert.match(many, /aria-label="Montrer [^"]+"/);
  assert.match(many, /data-testid="rpv-phrase"[^>]*>etoile_nord vous suit</);
  // the files a gallery has are what the preview offers: a sound is not shown
  const sound = render({ ...block(JSON.stringify([{ src: SND }])), fields: [{ name: "variants", kind: "gallery", accept: ["image", "video", "audio"], label: "Fichiers", value: JSON.stringify([{ src: SND }]), compose: option }] });
  assert.doesNotMatch(sound, /data-reaction-preview/);
  assert.doesNotMatch(render(block("[]")), /data-reaction-preview/, "no file: no preview");
  assert.doesNotMatch(render(block(JSON.stringify([{ src: SRC }]), null)), /data-reaction-preview/, "without compose: the field is what it was");
});

test("texts: FR and EN parity, glossary words, labels short, the preview reuses the editor's words", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of Object.keys(en).filter((x) => x.startsWith("compose.pv."))) {
    assert.ok(fr[k], k);
    assert.deepEqual((fr[k].match(/\{\w+\}/g) ?? []).sort(), (en[k].match(/\{\w+\}/g) ?? []).sort(), k);
    if (!k.endsWith(".help")) assert.ok(fr[k].length <= 60 && en[k].length <= 60 && !fr[k].endsWith(":"), k);
  }
  const glossary = fs.readFileSync("docs/TRANSLATING.md", "utf8");
  for (const w of ["| alert preview | aperçu de l'alerte |", "| play again | rejouer |"]) assert.ok(glossary.includes(w), w);
});

/* ───────────── the light still picture in a real Chromium ───────────── */

let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

test("real browser: the still picture of a video asks for its first picture only; playing asks for all of it, one video at a time", { skip: skipBrowser, timeout: 60000 }, async () => {
  const page = `<!doctype html><meta charset="utf-8"><style>#a,#b{position:relative;width:320px;height:180px}${R.COMPOSE_CSS}</style><div id="a"></div><div id="b"></div><script>${R.composeScript()}</script>`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/uploads/")) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", "text/html; charset=utf-8"); res.end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext()).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    const c = M.resolveComposition(M.defaultVideoComposition(VID, { seconds: 4 }), { phrase: "Merci etoile_nord" });
    const r = await p.evaluate((c) => {
      const E = window.CuriosaCompose;
      const still = E.mount(document.getElementById("a"), c, { still: true, motion: false, light: true });
      const v1 = still.querySelector("video");
      const out = { stillPreload: v1.preload, stillAuto: v1.autoplay, text: still.querySelector(".cmp-txt").textContent };
      const editor = E.mount(document.getElementById("b"), c, { still: true, motion: false });
      out.editorPreload = editor.querySelector("video").preload;
      E.unmount(editor);
      const play = E.mount(document.getElementById("b"), c, { seconds: 4, muted: true });
      out.playPreload = play.querySelector("video").preload; out.playMuted = play.querySelector("video").muted; out.playAuto = play.querySelector("video").autoplay;
      return out;
    }, c);
    assert.equal(r.stillPreload, "metadata");
    assert.equal(r.stillAuto, false);
    assert.equal(r.text, "Merci etoile_nord");
    assert.equal(r.editorPreload, "auto", "the editor keeps its own behaviour");
    assert.equal(r.playPreload, "auto");
    assert.equal(r.playMuted, true);
    assert.equal(r.playAuto, true);
  } finally { await browser.close(); server.close(); }
});
