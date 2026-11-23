// "Add a skin from a file" on the screen (core 0.46.1): the real component rendered with react-dom/server, in FR and EN. The path of a non-technical person
// (call her Camille): drop, Add this skin, Use this skin = 0 fields to fill, 3 clicks. R1-R33 as automatic checks on the component and on every sentence written for it.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
after(() => db.close());
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { appearanceLabels } = await import("@/app/admin/(panel)/appearance/labels");
const { AppearanceLabelsProvider } = await import("@/app/admin/(panel)/appearance/AppearanceLabels");
const { UploadSkin } = await import("@/app/admin/(panel)/appearance/UploadSkin");
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));

const READY = { ok: true, token: "a".repeat(64), id: "etoile-nord", name: "Etoile du nord", description: "Un vitrail.", version: "1.0.0", author: "Camille", modes: ["light", "dark"], kb: 350, files: 17, previewable: true,
  previews: [{ alt: "Accueil", dataUrl: "data:image/webp;base64,AAAA", mode: "light" }], notes: [] };
const render = (locale, initial) => renderToStaticMarkup(React.createElement(AppearanceLabelsProvider, { labels: appearanceLabels(makeTranslator(locale)) }, React.createElement(UploadSkin, { initial })));
const esc = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const count = (html, re) => (html.match(re) ?? []).length;

for (const locale of ["fr", "en"]) {
  const t = makeTranslator(locale);
  test(`[${locale}] start: one sentence for the page, one big drop zone, one real file button, no field to fill, no Check button`, () => {
    const html = render(locale);
    assert.ok(html.includes(esc(t("appearance.file.intro"))), "R1");
    assert.ok(html.includes('data-testid="upload-drop"') && html.includes(esc(t("appearance.file.drop"))));
    assert.equal(count(html, /<input[^>]*type="file"/g), 1, "the keyboard and touch way (R28)");
    assert.match(html, /<input[^>]*type="file"[^>]*accept="[^"]*\.zip/);
    assert.ok(new RegExp(`<label[^>]*for="skinFile"[^>]*>${esc(t("appearance.file.choose"))}</label>`).test(html), "a labelled button for the file input");
    assert.equal(count(html, /<input[^>]*type="(text|url|checkbox|password)"/g), 0, "0 fields, 0 tick boxes");
    assert.ok(!html.includes(esc(t("appearance.address.check"))), "no separate Check button");
    assert.ok(html.includes(esc(t("appearance.file.help"))), "example under the drop zone (R11)");
  });

  test(`[${locale}] checked: the skin is shown, ONE primary button, a quiet Cancel, a plain sentence instead of a tick box`, () => {
    const html = render(locale, { view: READY });
    assert.ok(html.includes("Etoile du nord") && html.includes('data-testid="upload-ready"'));
    assert.equal(count(html, new RegExp(`>${esc(t("appearance.personal.add"))}<`, "g")), 1, "Add this skin, once");
    assert.ok(html.includes(esc(t("appearance.file.cancel"))));
    assert.ok(html.includes('data-testid="upload-trust"') && html.includes(esc(t("appearance.file.trust"))));
    assert.equal(count(html, /type="checkbox"/g), 0, "no blocking tick");
        assert.equal(count(html, /btn-primary|bg-accent/g) >= 1, true);
    assert.ok(!html.includes("<label") || !html.includes('for="skinFile"'), "the drop zone is gone while the skin waits");
  });

  test(`[${locale}] a refusal is under the file field, in words, and the drop zone stays so the file can be dropped again`, () => {
    const msg = t("skins.upload.nomanifest");
    const html = render(locale, { error: msg });
    assert.ok(html.includes(esc(msg)));
    assert.ok(html.includes('aria-invalid="true"') && /aria-describedby="[^"]*skinFileError/.test(html));
    assert.ok(html.includes('data-testid="upload-drop"'));
    assert.doesNotMatch(html, /manifest-|\bat .*\.ts|Error:|stack/i);
  });

  test(`[${locale}] added: Use this skin (primary) and Keep as is`, () => {
    const html = render(locale, { added: { id: "etoile-nord", name: "Etoile du nord" } });
    assert.ok(html.includes(esc(t("appearance.file.added", { name: "Etoile du nord" }))));
    assert.ok(html.includes(`>${esc(t("appearance.file.use"))}<`) && html.includes(`>${esc(t("appearance.file.keep"))}<`));
  });
}

const FORBIDDEN = /\b(clé|clef|slug|instance|topic|token|jeton|webhook|route|service|identifiant|payload|api|json|cache|hash|sse|oauth|manifest|manifeste|validateur|validator|sha|repository|dépôt|subdir)\b/i;
const mine = (d) => Object.entries(d).filter(([k]) => /^(appearance\.file\.|skins\.upload\.|skins\.error\.uploaded$|backup\.status\.skinUpload$)/.test(k));

test("words: the same keys in both languages, no forbidden word, no exclamation, no 'Please', short sentences, short labels (R9, R10, R11, R13, R29)", () => {
  assert.deepEqual(mine(en).map(([k]) => k), mine(fr).map(([k]) => k));
  assert.ok(mine(en).length >= 40);
  for (const [lang, dict] of [["en", en], ["fr", fr]]) {
    for (const [key, text] of mine(dict)) {
      const plain = text.replace(/skin\.json|skin\.css|tokens\.json|my-skin|mon-skin|"[a-z]+": "[^"]*",?/g, "");
      assert.doesNotMatch(plain, FORBIDDEN, `${lang} ${key}`);
      assert.ok(!/[!]|Veuillez|\bPlease\b/.test(text), `${lang} ${key}`);
      assert.equal(text, text.trim());
      assert.ok(!/\{(?!file\}|id\}|version\}|name\}|date\}|print\})[a-z]+\}/.test(text), `${lang} ${key}: unexplained braces`);
      for (const sentence of text.split(/(?<=[.?])\s+(?=[A-ZÉ])/)) assert.ok(sentence.split(/\s+/).length <= 20, `${lang} ${key}: a sentence of ${sentence.split(/\s+/).length} words`);
    }
    for (const key of ["appearance.file.title", "appearance.file.drop", "appearance.file.choose", "appearance.file.cancel", "appearance.file.use", "appearance.file.keep", "appearance.file.checking"]) {
      assert.ok(dict[key].length <= 60 && !/:\s*$/.test(dict[key]), `${lang} ${key}: short label without a colon`);
    }
    assert.ok(dict["appearance.file.help"].length <= 60, "help of at most 60 characters with an example (R11)");
    assert.match(dict["appearance.file.help"], /my-skin\.zip|mon-skin\.zip/);
  }
});

test("every refusal says what to do: it contains an action or an example (R22)", () => {
  for (const [lang, dict] of [["en", en], ["fr", fr]]) {
    for (const [key, text] of mine(dict).filter(([k]) => /^skins\.upload\.[a-z-]+$/.test(k) && !/\.(file|rate|expired)$/.test(k))) {
      assert.match(text, lang === "en" ? /(Example|Make|Remove|Keep|Put|Use|Choose|Add|Wait|Check|raise|Drop|Give|Save|Allègez)/i : /(Exemple|Faites|Refaites|Retirez|Gardez|Mettez|Utilisez|Choisissez|Ajoutez|Patientez|Vérifiez|augmentez|Déposez|Allégez|Enregistrez|Indiquez)/i, `${lang} ${key}`);
    }
  }
});
