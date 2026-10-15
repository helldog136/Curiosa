import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const M = await import("@/core/modules/missingSettings");
const P = await import("@/core/modules/menuPlacement");
const { fieldSpan, SPAN_CLASS } = await import("@/core/modules/settingsLayout");
const { MODAL_WIDTH } = await import("../../src/components/admin/modalWidth.ts");
const { manifestSchema } = await import("@/core/modules/manifest");

const read = (p) => fs.readFileSync(p, "utf8");
const keys = (fields) => fields.map((f) => f.key);

// Les réglages du module Planning tels que son manifeste les déclare (adresse iCal secrète, lien de chaîne « facultatif » dans l'aide, réglages avec défaut, réglages avancés).
const PLANNING = [
  { key: "icsUrl", type: "secret", label: "Adresse du calendrier (iCal, secrète)" },
  { key: "channelUrl", type: "url", label: "Lien de votre chaîne" },
  { key: "days", type: "number", default: 7, advanced: true },
  { key: "timezone", type: "text", default: "UTC", advanced: true },
  { key: "appearance", type: "select", default: "original", group: "appearance" },
  { key: "showCovers", type: "boolean", default: true, group: "appearance" },
];

test("réglages manquants : champ vide, sans défaut, de type texte / adresse / lien / secret, dans l'ordre du manifeste", () => {
  assert.deepEqual(keys(M.missingSettings(PLANNING, new Set(), {})), ["icsUrl", "channelUrl"]);
  assert.deepEqual(keys(M.missingSettings(PLANNING, new Set(), { icsUrl: { "": "x" } })), ["channelUrl"]);
  assert.deepEqual(M.missingSettings([], new Set(), {}), []);
});

test("réglages manquants : un secret enregistré compte comme rempli ; une valeur vide ou absente non", () => {
  const f = [{ key: "token", type: "secret" }];
  assert.equal(M.missingSettings(f, new Set(), { token: { "": "chiffré" } }).length, 0);
  assert.equal(M.missingSettings(f, new Set(), { token: { "": "" } }).length, 1);
  assert.equal(M.missingSettings(f, new Set(), { token: {} }).length, 1);
  assert.equal(M.missingSettings(f, new Set(), { token: undefined }).length, 1);
});

test("réglages manquants : facultatif, technique, groupe facultatif, traduisible, valeur par défaut, types toujours remplis → jamais exigés", () => {
  const f = [
    { key: "a", type: "url", optional: true },
    { key: "b", type: "text", advanced: true },
    { key: "c", type: "url" },
    { key: "d", type: "text", translatable: true },
    { key: "e", type: "text", default: "" },
    { key: "f", type: "boolean" }, { key: "g", type: "number" }, { key: "h", type: "select" }, { key: "i", type: "color" }, { key: "j", type: "textarea" }, { key: "k", type: "image" },
  ];
  assert.deepEqual(keys(M.missingSettings(f, new Set(["c"]), {})), [], "c est dans un groupe facultatif");
  assert.deepEqual(keys(M.missingSettings(f, new Set(), {})), ["c"]);
  assert.deepEqual(keys(M.missingSettings(f, new Set(), { c: { "": "https://x.org" } })), []);
});

test("réglages manquants : une valeur dans n'importe quelle langue suffit", () => {
  const f = [{ key: "t", type: "text" }];
  assert.equal(M.missingSettings(f, new Set(), { t: { fr: "", en: "ok" } }).length, 0);
});

test("« à configurer » : settingsToFill s'appuie sur la même règle (facultatif et technique ne comptent pas)", () => {
  assert.equal(P.settingsToFill(PLANNING, new Set(), {}), true);
  assert.equal(P.settingsToFill(PLANNING, new Set(), { icsUrl: { "": "x" }, channelUrl: { "": "https://t.tv/me" } }), false);
  const withOptional = PLANNING.map((f) => (f.key === "channelUrl" ? { ...f, optional: true } : f));
  assert.equal(P.settingsToFill(withOptional, new Set(), { icsUrl: { "": "x" } }), false, "le lien de chaîne déclaré facultatif ne bloque plus");
  assert.equal(P.settingsToFill(withOptional, new Set(), {}), true, "l'adresse du calendrier reste obligatoire");
  assert.deepEqual(keys(M.missingSettings(withOptional, new Set(), {})), ["icsUrl"]);
});

test("le manifeste accepte « optional » (et le conserve)", () => {
  const base = { apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", settings: [{ key: "u", type: "url", label: "U", optional: true }] };
  const parsed = manifestSchema.safeParse(base);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.settings[0].optional, true);
});

test("libellé court : sans la précision entre parenthèses finale", () => {
  assert.equal(M.shortLabel("Adresse du calendrier (iCal, secrète)"), "Adresse du calendrier");
  assert.equal(M.shortLabel("Lien (a) de la chaîne"), "Lien (a) de la chaîne", "une parenthèse au milieu reste");
  assert.equal(M.shortLabel("(seul)"), "(seul)", "jamais de libellé vide");
  assert.equal(M.shortLabel("  Clé  "), "Clé");
});

test("pastille : rien, un réglage nommé, ou leur nombre", () => {
  assert.deepEqual(M.summarizeMissing([]), { kind: "none" });
  assert.deepEqual(M.summarizeMissing(["Adresse du calendrier (iCal, secrète)"]), { kind: "one", label: "Adresse du calendrier" });
  assert.deepEqual(M.summarizeMissing(["A", "B"]), { kind: "many", count: 2 });
});

test("pastille d'un module à plusieurs instances : une seule à régler → son motif ; plusieurs → le total", () => {
  assert.deepEqual(M.summarizeMissingAcross([[], ["Clé"]]), { kind: "one", label: "Clé" });
  assert.deepEqual(M.summarizeMissingAcross([["Clé"], ["Clé"]]), { kind: "many", count: 2 });
  assert.deepEqual(M.summarizeMissingAcross([["A", "B"], []]), { kind: "many", count: 2 });
  assert.deepEqual(M.summarizeMissingAcross([[], []]), { kind: "none" });
});

test("liens « Il reste à renseigner » : une ancre par champ, qui est l'identifiant de la saisie", () => {
  assert.equal(M.settingFieldId("icsUrl"), "s__icsUrl");
  const links = M.missingLinks([{ key: "icsUrl" }, { key: "channelUrl" }], (k) => ({ icsUrl: "Adresse du calendrier (iCal, secrète)", channelUrl: "Lien" })[k]);
  assert.deepEqual(links.map((l) => [l.key, l.label, l.href, l.id]), [["icsUrl", "Adresse du calendrier (iCal, secrète)", "#s__icsUrl", "s__icsUrl"], ["channelUrl", "Lien", "#s__channelUrl", "s__channelUrl"]]);
  const settings = read("src/components/admin/ModuleSettings.tsx");
  assert.match(settings, /settingFieldId\(f\.key\)/, "la saisie porte bien cet identifiant");
});

test("mise en page des réglages : adresses, secrets, textes longs et réglages traduisibles sur toute la ligne ; le reste à moitié", () => {
  for (const type of ["url", "link", "secret", "textarea", "image", "video"]) assert.equal(fieldSpan({ type }), "full", type);
  for (const type of ["text", "number", "boolean", "select", "color"]) assert.equal(fieldSpan({ type }), "half", type);
  assert.equal(fieldSpan({ type: "text", translatable: true }), "full");
  assert.match(SPAN_CLASS.full, /col-span-2/);
  assert.doesNotMatch(SPAN_CLASS.half, /col-span/);
});

test("fenêtre de réglages : elle suit la largeur du navigateur (94 %), plafonnée ; la fiche du catalogue reste plus étroite ; mobile plein écran", () => {
  assert.match(MODAL_WIDTH.wide, /^sm:max-w-\[min\(94vw,\d{4}px\)\]$/);
  assert.match(MODAL_WIDTH.medium, /^sm:max-w-\[min\(94vw,\d{3,4}px\)\]$/);
  const cap = (s) => Number(/(\d+)px/.exec(s)[1]);
  assert.ok(cap(MODAL_WIDTH.wide) >= 1200 && cap(MODAL_WIDTH.wide) <= 1400);
  assert.ok(cap(MODAL_WIDTH.medium) < cap(MODAL_WIDTH.wide));
  const modal = read("src/components/admin/RouteModal.tsx");
  assert.doesNotMatch(modal, /max-w-3xl/, "plus de largeur fixe étroite");
  assert.match(modal, /h-full w-full \$\{MODAL_WIDTH\[size\]\}/, "pleine largeur sur mobile, plafonnée seulement à partir de « sm »");
  assert.match(modal, /overflow-x-hidden/, "pas de défilement horizontal");
  assert.match(read("src/app/admin/(panel)/extensions/add/@modal/(.)details/page.tsx"), /size="medium"/);
});

test("encadré « Il reste à renseigner » : présent dans la vue des réglages, avec le marquage « à remplir » des champs, en français et en anglais", () => {
  const view = read("src/app/admin/(panel)/instances/[id]/InstanceView.tsx");
  assert.match(view, /<MissingBox title=\{t\("missing\.title"\)\}/);
  assert.match(view, /missingSettings\(mod\.manifest\.settings/);
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  for (const k of ["missing.title", "missing.field", "integrations.state.setupOne", "integrations.state.setupMany", "nav.badge.setupFor"]) {
    assert.ok(fr[k] && en[k], k);
  }
  assert.match(fr["integrations.state.setupOne"], /^À configurer : \{label\}$/);
  assert.match(fr["missing.title"], /Il reste à renseigner/);
});
