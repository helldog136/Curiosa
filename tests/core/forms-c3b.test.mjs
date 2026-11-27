// Phase C3b : formulaires. Validation « du navigateur » dite sous le champ dans la langue du site (F-FEED-003), bouton de choix de fichier traduit (F-LANG-001),
// boutons segmentés qui ne coupent jamais un mot (F-SET-005), barre d'action collée en bas partagée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const { collectNativeErrors, messageFor, INVALID_KEYS } = await import("@/components/admin/nativeValidation");
const { PROGRESS_LABEL_KEYS } = await import("@/components/admin/progressLabelKeys");
const { ProgressLabelsProvider } = await import("@/components/admin/ProgressLabels");
const { FileField } = await import("@/components/admin/FileField");
const { Segmented } = await import("@/components/admin/Segmented");
const { StickyActionBar } = await import("@/components/admin/StickyActionBar");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const labelsFor = (lang) => { const t = makeTranslator(lang); return Object.fromEntries(PROGRESS_LABEL_KEYS.map((k) => [k, t(`progress.${k}`)])); };
const textFor = (lang) => { const t = makeTranslator(lang); return (k, v) => t(`progress.invalid.${k}`, v); };
const field = (o) => ({ name: "f", validity: { valid: false }, ...o, validity: { valid: false, ...o.validity } });

test("chaque motif de refus a un texte FR et EN, avec un exemple pour une adresse, un lien et un nombre", () => {
  for (const lang of ["fr", "en"]) {
    const t = makeTranslator(lang);
    for (const k of INVALID_KEYS) assert.notEqual(t(`progress.invalid.${k}`), `progress.invalid.${k}`, `${lang} ${k}`);
    for (const k of ["email", "url", "number"]) assert.match(t(`progress.invalid.${k}`), /(par exemple|for example)/, `${lang} ${k} : un exemple`);
    for (const k of ["fileChoose", "fileChange", "fileNone"]) assert.notEqual(t(`progress.${k}`), `progress.${k}`);
  }
  for (const k of INVALID_KEYS) assert.ok(PROGRESS_LABEL_KEYS.includes(`invalid.${k}`), `${k} est transmis aux écrans`);
});

test("messageFor : un champ valide n'a pas de message ; les motifs donnent le bon texte, dans la langue du site", () => {
  const fr = textFor("fr");
  assert.equal(messageFor({ name: "a", validity: { valid: true } }, fr), null);
  assert.equal(messageFor(field({ type: "text", validity: { valueMissing: true } }), fr), "Remplissez ce champ.");
  assert.match(messageFor(field({ type: "email", validity: { typeMismatch: true } }), fr), /adresse complète, par exemple camille@example\.test/);
  assert.match(messageFor(field({ type: "url", validity: { typeMismatch: true } }), fr), /https:\/\/example\.test/);
  assert.equal(messageFor(field({ type: "file", validity: { valueMissing: true } }), fr), "Choisissez un fichier.");
  assert.equal(messageFor(field({ type: "checkbox", validity: { valueMissing: true } }), fr), "Cochez cette case pour continuer.");
  assert.equal(messageFor(field({ type: "radio", validity: { valueMissing: true } }), fr), "Faites un choix dans la liste.");
  assert.equal(messageFor(field({ tagName: "SELECT", validity: { valueMissing: true } }), fr), "Faites un choix dans la liste.");
  assert.equal(messageFor(field({ type: "number", min: "5", max: "3600", validity: { rangeUnderflow: true } }), fr), "Écrivez un nombre entre 5 et 3600.");
  assert.equal(messageFor(field({ type: "number", min: "5", validity: { rangeUnderflow: true } }), fr), "Écrivez un nombre d'au moins 5.");
  assert.equal(messageFor(field({ type: "number", max: "9", validity: { rangeOverflow: true } }), fr), "Écrivez un nombre d'au plus 9.");
  assert.equal(messageFor(field({ type: "text", minLength: 12, validity: { tooShort: true } }), fr), "Écrivez au moins 12 caractères.");
  assert.equal(messageFor(field({ type: "text", pattern: "x", title: "Lettres et chiffres, par exemple etoile_nord", validity: { patternMismatch: true } }), fr), "Lettres et chiffres, par exemple etoile_nord");
  assert.match(messageFor(field({ type: "text", validity: { patternMismatch: true } }), fr), /format/);
  const en = textFor("en");
  assert.equal(messageFor(field({ type: "text", validity: { valueMissing: true } }), en), "Fill in this field.");
  assert.match(messageFor(field({ type: "email", validity: { typeMismatch: true } }), en), /for example camille@example\.test/);
});

test("collectNativeErrors : un message par champ nommé (le premier d'un groupe de radios), dans l'ordre du formulaire ; les champs sans nom sont ignorés", () => {
  const fr = textFor("fr");
  const out = collectNativeErrors([
    field({ name: "email", type: "email", validity: { typeMismatch: true } }),
    field({ name: "level", type: "radio", validity: { valueMissing: true } }),
    field({ name: "level", type: "radio", validity: { valueMissing: true } }),
    field({ name: "", type: "text", validity: { valueMissing: true } }),
    { name: "ok", validity: { valid: true } },
  ], fr);
  assert.deepEqual(Object.keys(out), ["email", "level"]);
});

test("ActionForm : formulaire envoyé avec noValidate, validation du cœur avant l'envoi, aucune bulle du navigateur", () => {
  const src = fs.readFileSync("src/components/admin/ActionForm.tsx", "utf8");
  assert.match(src, /<form id=\{formId\} ref=\{ref\} method="post" noValidate onSubmit=\{onSubmit\}/);
  assert.match(src, /collectNativeErrors\(validatableFields\(form\)/);
  assert.match(src, /if \(Object\.keys\(invalid\)\.length\) \{ setClientErrors\(invalid\); return; \}/, "rien n'est envoyé tant qu'un champ est en erreur ; la saisie reste");
  assert.match(src, /useFieldErrorsDom\(ref, clientErrors \?\? state\?\.errors/, "même affichage que les erreurs du serveur : sous le champ, focus sur le premier");
  assert.ok(src.indexOf("collectNativeErrors(validatableFields") < src.indexOf("askConfirm(confirmMessage)"), "on valide avant de demander confirmation");
});

test("champ fichier : un bouton dans la langue du site, le vrai champ reste (clavier, required, envoi)", () => {
  const f = { name: "list", label: "Fichier CSV", kind: "file", accept: ".csv", required: true };
  for (const lang of ["fr", "en"]) {
    const out = html(h(ProgressLabelsProvider, { labels: labelsFor(lang) }, h(FileField, { f })));
    const t = makeTranslator(lang);
    assert.match(out, /type="file"/);
    assert.match(out, /class="peer sr-only"/, "le champ natif est caché visuellement, pas retiré de l'ordre de tabulation");
    assert.match(out, /required/);
    assert.ok(out.includes(`>${t("progress.fileChoose")}</label>`), "bouton");
    assert.ok(out.includes(t("progress.fileNone")), "aucun fichier choisi");
    assert.match(out, /min-h-11/, "cible de 44 px");
    assert.doesNotMatch(out, /Choose File/);
  }
});

test("boutons segmentés : un bouton ne coupe jamais un mot, c'est le bouton entier qui passe à la ligne", () => {
  const out = html(h(Segmented, { label: "Style des textes", name: "style", defaultValue: "thanks", options: [{ value: "simple", label: "Simple" }, { value: "short", label: "Court" }, { value: "thanks", label: "Remerciements" }] }));
  assert.match(out, /min-w-fit/, "au moins la largeur du plus long mot");
  assert.match(out, /flex-auto/);
  assert.match(out, /flex-wrap/);
  assert.doesNotMatch(out, /overflow-wrap:anywhere/, "pas de coupure au milieu d'un mot");
  assert.match(out, /min-h-11/);
});

test("barre d'action collée : région nommée, au-dessus des fenêtres, jamais plus large que l'écran", () => {
  const out = html(h(StickyActionBar, { label: "Modifications non enregistrées" }, h("button", null, "Enregistrer")));
  assert.match(out, /role="region"/);
  assert.match(out, /aria-label="Modifications non enregistrées"/);
  assert.match(out, /data-sticky-bar/);
  assert.match(out, /z-\[60\]/);
  assert.match(out, /max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(fs.readFileSync("src/app/globals.css", "utf8"), /html:has\(\[data-sticky-bar\]\) \{ scroll-padding-bottom/, "un champ qui prend le focus ne se glisse pas sous la barre");
});

test("formulaires de module (adminForm) : les trois formulaires du bloc passent par la même validation, sous le champ", () => {
  const src = fs.readFileSync("src/components/admin/AdminBlocks.tsx", "utf8");
  assert.equal((src.match(/useClientChecks\(formRef\)/g) ?? []).length, 3, "action, fenêtre, fichier");
  assert.equal((src.match(/noValidate/g) ?? []).length, 3);
  assert.equal((src.match(/if \(!check\(e\.currentTarget\)\)/g) ?? []).length, 2, "action et fenêtre ; le formulaire fichier valide dans son envoi");
  assert.match(src, /if \(!check\(form\)\) return;/);
  const hook = fs.readFileSync("src/components/admin/useClientChecks.ts", "utf8");
  assert.match(hook, /^"use client";/);
  assert.match(hook, /useFieldErrorsDom\(form, errors \?\? undefined, errors\)/);
});
