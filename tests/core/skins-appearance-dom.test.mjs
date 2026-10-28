// Page Apparence, côté écran (lot S7, docs/SKINS.md §10) : les vrais composants rendus avec react-dom/server (les .tsx sont transpilés à la volée par
// tests/helpers/alias-hooks.mjs) : structure, accessibilité (cibles de 44 px, rôles, liens étiquette/champ), FR/EN en parité, avertissements de lisibilité
// sous le champ, un site sans skin inchangé. La page entière est rendue avec de vraies données (base jetable, vrais dépôts git locaux).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { appearanceLabels } = await import("@/app/admin/(panel)/appearance/labels");
const { AppearanceLabelsProvider } = await import("@/app/admin/(panel)/appearance/AppearanceLabels");
const { ColorSection } = await import("@/app/admin/(panel)/appearance/ColorSection");
const { InspectPanel } = await import("@/app/admin/(panel)/appearance/InspectPanel");
const { SkinCards } = await import("@/app/admin/(panel)/appearance/SkinCards");
const S = await import("@/core/skins/service");
const A = await import("@/core/skins/appearance");
const { setSetting } = await import("@/core/settings");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");
const read = (p) => fs.readFileSync(p, "utf8");
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
  globalThis.curiosaTestSession = null;
});
after(() => { db.close(); cat.close(); });

const labelsOf = (locale) => appearanceLabels(makeTranslator(locale));
const render = (el, locale = "fr") => renderToStaticMarkup(React.createElement(AppearanceLabelsProvider, { labels: labelsOf(locale) }, el));
const count = (html, re) => (html.match(re) ?? []).length;

const LIGHT = { background: "#f4efe4", accent: "#a8231b", accent2: "", surface: "#ffffff", text: "#16130f" };
const DARK = { background: "#14110d", accent: "#ff9a8b", accent2: "", surface: "#1f1a14", text: "#f4efe4" };
const pickerLabels = (t) => ({ background: t("settings.background"), accent: t("settings.accent"), accent2: t("settings.accent2"), surface: t("settings.surface"), text: t("settings.text"), addSecond: t("settings.accent2.add"), removeSecond: t("settings.accent2.remove"), optionalHint: t("settings.colorOptionalHint"), invalid: t("settings.colorInvalid"), warnText: t("settings.contrast.text"), warnAccent: t("settings.contrast.accent"), warnAccent2: t("settings.contrast.accent2"), resetField: t("appearance.resetField"), details: t("appearance.details.short") });
const colorSection = (over = {}, locale = "fr") => {
  const t = makeTranslator(locale);
  return React.createElement(ColorSection, { locale, modes: ["light", "dark"], palette: "both", legacy: false, advanced: true, single: LIGHT, both: { light: LIGHT, dark: DARK }, skinColors: { light: LIGHT, dark: DARK }, names: {}, labels: pickerLabels(t), skinBackgrounds: { light: LIGHT.background, dark: DARK.background }, ...over });
};

// ── dictionnaires

test("textes : chaque clé « appearance.* » / « skins.error.* » utilisée dans le code existe en français ET en anglais, avec les mêmes {variables}", () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
  walk("src/app/admin/(panel)/appearance"); walk("src/app/admin/(panel)/settings");
  files.push("src/components/admin/ThemePicker.tsx", "src/app/admin/(panel)/layout.tsx");
  const used = new Set();
  for (const f of files) for (const m of read(f).matchAll(/["'`]((?:appearance|nav\.appearance|settings\.appearance[A-Za-z]*|settings\.headerLinks|audit\.action\.(?:skin|appearance)\.[a-z.]+)[A-Za-z0-9_.]*)["'`]/g)) used.add(m[1]);
  assert.ok(used.size > 60, `clés repérées : ${used.size}`);
  const dynamic = ["appearance.palette.", "appearance.preview.", "appearance.mode.", "appearance.modes.", "appearance.status."];
  for (const k of used) {
    if (dynamic.includes(k) || k.endsWith(".") || !k.includes(".")) continue;
    assert.ok(k in fr, `fr : ${k}`);
    assert.ok(k in en, `en : ${k}`);
  }
  for (const k of Object.keys(fr)) if (k.startsWith("appearance.")) {
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(vars(fr[k]), vars(en[k]), k);
  }
  // les clés construites : toutes leurs variantes existent
  for (const k of ["appearance.palette.single", "appearance.palette.singleHelp", "appearance.palette.both", "appearance.palette.bothHelp", "appearance.preview.phone", "appearance.preview.desktop", "appearance.mode.light", "appearance.mode.dark", "appearance.mode.auto", "appearance.modes.both", "appearance.modes.lightOnly", "appearance.modes.darkOnly", "appearance.status.missing", "appearance.status.modified", "appearance.status.invalid"]) assert.ok(fr[k] && en[k], k);
});

test("textes : le mot « skin » partout (jamais « thème » ni « apparence » pour l'objet choisi), phrases simples, aucun jargon dans la page", () => {
  for (const [k, v] of Object.entries(fr)) {
    if (!k.startsWith("appearance.")) continue;
    assert.ok(!/\bthème\b/i.test(v), `fr ${k} : « thème »`);
    assert.ok(!/\b(jeton|token|sélecteur|CSS|dépôt git|checksum|empreinte)\b/i.test(v), `fr ${k} : jargon`);
  }
  for (const [k, v] of Object.entries(en)) if (k.startsWith("appearance.")) assert.ok(!/\btheme\b/i.test(v), `en ${k}: “theme”`);
  assert.equal(fr["nav.appearance"], "Apparence", "le titre de la page reste « Apparence »");
  assert.equal(en["nav.appearance"], "Appearance");
});

// ── couleurs : un seul mode / clair et sombre

test("couleurs, clair et sombre : choix en deux grandes cases, onglets Clair / Sombre reliés à leurs panneaux, deux jeux de champs, maquette des deux modes", () => {
  const html = render(colorSection());
  assert.match(html, /<fieldset[^>]*><legend[^>]*>Comment choisir vos couleurs \?<\/legend>/);
  assert.equal(count(html, /<input type="radio"[^>]*name="palette"/g), 2);
  assert.match(html, /<input type="radio"[^>]*name="palette" checked="" value="both"/);
  assert.match(html, /role="tablist"[^>]*aria-label="Couleurs de chaque mode"/);
  assert.equal(count(html, /role="tab"/g), 2);
  assert.match(html, /id="tab-light"[^>]*aria-selected="true"[^>]*aria-controls="panel-light"[^>]*tabindex="0"/);
  assert.match(html, /id="tab-dark"[^>]*aria-selected="false"[^>]*aria-controls="panel-dark"[^>]*tabindex="-1"/);
  assert.match(html, /role="tabpanel" id="panel-light" aria-labelledby="tab-light"/);
  assert.match(html, /role="tabpanel" id="panel-dark" aria-labelledby="tab-dark" hidden=""/, "le panneau Sombre est caché mais ses champs partent avec le formulaire");
  for (const set of ["light_", "dark_"]) for (const f of ["background", "accent", "accent2", "surface", "text"]) assert.match(html, new RegExp(`name="${set}${f}"`), `${set}${f}`);
  assert.doesNotMatch(html, /name="background"/, "pas de jeu « un seul mode » en même temps");
  assert.equal(count(html, /data-testid="color-mock"/g), 2, "l'aperçu des deux modes");
  assert.match(html, /Aperçu des deux modes/);
  assert.match(html, /data-testid="switch-note" data-switch="on"[^>]*>Vos visiteurs verront un bouton Clair \/ Sombre\./);
  // chaque champ de couleur a son étiquette
  assert.ok(count(html, /<label for="light_background-color"/g) === 1 && count(html, /<label for="dark_accent-color"/g) === 1);
  // cibles tactiles
  for (const m of html.matchAll(/<button[^>]*role="tab"[^>]*class="([^"]*)"/g)) assert.match(m[1], /min-h-11/);
  assert.equal(count(html, /<button[^>]*role="tab"/g), 2);
});

test("couleurs, un seul mode : les champs gardent EXACTEMENT leurs noms d'avant (background, accent, accent2, surface, text) ; le choix « mode » n'est proposé qu'avec deux modes", () => {
  const one = render(colorSection({ modes: ["dark"], palette: "single", legacy: true, single: DARK, both: {}, skinColors: {}, skinBackgrounds: {} }));
  for (const f of ["background", "accent", "accent2", "surface", "text"]) assert.match(one, new RegExp(`name="${f}"`), f);
  assert.doesNotMatch(one, /name="palette" value="both"/);
  assert.match(one, /<input type="hidden" name="palette" value="single"\/>/);
  assert.doesNotMatch(one, /role="tablist"/);
  assert.doesNotMatch(one, /data-testid="switch-note"/, "sur basic (site existant) : pas de note sur le bouton Clair / Sombre");
  const duoSingle = render(colorSection({ palette: "single" }));
  assert.match(duoSingle, /name="palette" checked="" value="single"/);
  assert.match(duoSingle, /data-switch="on"/, "un seul mode sans changer de fond : les deux modes du skin restent");
  const changed = render(colorSection({ palette: "single", single: { ...LIGHT, background: "#101018" } }));
  assert.match(changed, /data-switch="off"[^>]*>Avec ce fond, votre site n&#x27;a plus qu&#x27;un seul mode/);
  const oneModeSkin = render(colorSection({ modes: ["light"], palette: "single", single: LIGHT, both: {}, skinColors: { light: LIGHT }, skinBackgrounds: { light: LIGHT.background } }));
  assert.match(oneModeSkin, /data-switch="off"[^>]*>Ce skin n&#x27;a qu&#x27;un seul mode/);
});

test("lisibilité en direct : un texte pâle donne un avertissement SOUS le champ, en mots simples avec un exemple, jamais un blocage ; les chiffres sont dans « Détails » (replié)", () => {
  const bad = { ...DARK, text: "#2a2a30" };
  const html = render(colorSection({ both: { light: LIGHT, dark: bad }, skinColors: { light: LIGHT, dark: DARK } }));
  const dark = html.slice(html.indexOf('id="panel-dark"'));
  assert.match(dark, /data-testid="warn-text"/);
  assert.match(dark, /Dans le mode sombre, le texte serait difficile à lire sur ce fond/);
  assert.match(dark, /par exemple[^<]*#[0-9a-f]{6}/i, "un exemple de couleur");
  assert.match(dark, /<details[^>]*><summary[^>]*>Détails<\/summary><span[^>]*>[^<]*\d[^<]*<\/span>/, "les chiffres sont repliés");
  const light = html.slice(html.indexOf('id="panel-light"'), html.indexOf('id="panel-dark"'));
  assert.doesNotMatch(light, /data-testid="warn-/, "le mode clair est lisible : aucun avertissement");
  assert.doesNotMatch(html, /disabled/, "rien ne bloque l'enregistrement");
  // en anglais : même avertissement, en anglais
  const e = render(colorSection({ both: { light: LIGHT, dark: bad } }, "en"), "en");
  assert.match(e, /In dark mode, the text would be hard to read on this background/);
  // « ↺ valeur du skin » seulement quand le champ est retouché
  assert.match(html, /data-testid="reset-dark_text"[^>]*>↺ Valeur du skin/);
  assert.doesNotMatch(html, /data-testid="reset-light_/);
});

test("sur basic (site existant), les avertissements de contraste sont ceux d'avant, en liste", () => {
  const html = render(colorSection({ modes: ["dark"], palette: "single", legacy: true, advanced: false, single: { ...DARK, text: "" , background: "#808080", accent: "#838383" }, both: {}, skinColors: {}, skinBackgrounds: {} }));
  assert.match(html, /data-testid="theme-contrast-warning"/);
  assert.match(html, /L&#x27;accent se distingue mal du fond \(contraste/);
});

// ── cartes, détails

const card = (over) => ({ id: "duo", name: { fr: "Duo de test", en: "Test duo" }, description: { fr: "Deux modes.", en: "Two modes." }, version: "1.0.0", author: "Équipe Curiosa", license: "MIT", modes: ["light", "dark"], tags: [], source: "catalogue", active: false, status: "ok", previews: [], swatches: { light: { background: "#fff", surface: "#eee", text: "#111", accent: "#a00", accent2: "#a00" }, dark: { background: "#000", surface: "#111", text: "#eee", accent: "#f99", accent2: "#f99" } }, ...over });

test("cartes de skins : nom, phrase, clair/sombre, auteur, licence, skin actuel signalé, aperçu et « Utiliser ce skin » seulement pour les autres, vignette de couleurs sans image", () => {
  const cards = [card({ id: "basic", source: "basic", name: { fr: "Skin de base", en: "Basic skin" }, modes: ["dark"], author: undefined, license: undefined, active: true }), card({}), card({ id: "p", name: { fr: "Photo", en: "Photo" }, previews: [{ file: "previews/home.webp", mode: "light", alt: { fr: "Page d'accueil", en: "Home page" } }], source: "personal" }), card({ id: "casse", status: "missing" })];
  const html = render(React.createElement(SkinCards, { cards, locale: "fr", pages: [{ label: "Accueil", path: "/" }], canChoose: true }));
  assert.equal(count(html, /<li [^>]*data-skin-card=/g), 4);
  assert.match(html, /data-skin-card="basic" aria-current="true"/);
  assert.match(html, /Skin actuel/);
  assert.match(html, /Skin de base/);
  assert.match(html, /Fourni avec Curiosa/);
  assert.match(html, /Par Équipe Curiosa · Licence MIT/);
  assert.match(html, /Hors liste vérifiée/, "un dépôt personnel est signalé");
  assert.match(html, /<img src="\/api\/admin\/skins\/preview\/p\/1\.0\.0\/home\.webp" alt="Page d&#x27;accueil"/);
  assert.equal(count(html, /aria-hidden="true"><div class="relative flex-1"/g) >= 1, true, "vignette de couleurs");
  assert.equal(count(html, /data-testid="preview-/g), 3, "pas d'aperçu pour un skin cassé");
  assert.equal(count(html, /name="id" value="(duo|p)"/g), 4, "« Utiliser ce skin » (sur la carte et dans la fenêtre d'aperçu) pour les skins utilisables qui ne sont pas déjà choisis");
  assert.doesNotMatch(html, /name="id" value="basic"/);
  assert.match(html, /Les fichiers de ce skin sont introuvables/);
  for (const m of html.matchAll(/<button[^>]*data-testid="preview-[^"]*"[^>]*class="([^"]*)"/g)) assert.match(m[1], /min-h-11/);
  const en = render(React.createElement(SkinCards, { cards, locale: "en", pages: [], canChoose: true }), "en");
  assert.match(en, /Test duo/);
  assert.match(en, /By Équipe Curiosa · License MIT/);
  assert.match(en, /Use this skin/);
  const noChoose = render(React.createElement(SkinCards, { cards, locale: "fr", pages: [], canChoose: false }));
  assert.doesNotMatch(noChoose, /name="id" value="duo"/);
});

test("détails d'un dépôt : ce que le skin ne peut PAS faire, licences, lisibilité refusée dite avant d'installer, README en texte (jamais de HTML)", () => {
  const data = { ok: true, mode: "summary", url: "https://x/y", origin: "personal", compatible: true, installable: false, name: { fr: "Pâle", en: "Pale" }, description: { fr: "Trop pâle.", en: "Too pale." }, version: "1.0.0", author: "Moi", license: "MIT", modes: ["light"], sizeKb: 12,
    assets: [{ file: "fonts/a.woff2", kind: "font", license: "OFL-1.1", author: "Fonderie" }], readme: "# Titre\n<script>alert(1)</script> **gras**", licenseText: "MIT License", previews: [{ alt: "Accueil", dataUrl: "data:image/webp;base64,AAAA" }], issues: ["Une remarque."], unreadable: ["Le texte serait trop pâle sur le fond (rapport 2,1 ; il faut au moins 4,5)."] };
  const html = render(React.createElement(InspectPanel, { data, locale: "fr" }));
  assert.match(html, /data-testid="inspect-permissions"[^>]*>✓ Ce skin ne peut changer que l&#x27;apparence : il ne peut ni faire tourner de programme/);
  assert.match(html, /role="alert"[^>]*>[\s\S]*Ce skin n&#x27;est pas assez lisible, il ne sera pas installé :[\s\S]*trop pâle/);
  assert.match(html, /fonts\/a\.woff2<\/span> · OFL-1\.1 · Fonderie/);
  assert.match(html, /<pre[^>]*>[^<]*&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "le README est du texte : rien n'est interprété");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<img src="data:image\/webp;base64,AAAA" alt="Accueil"/);
  assert.match(html, /<details[^>]*><summary[^>]*>Lire la licence<\/summary>/);
  assert.match(html, /Par Moi · Licence MIT · 12 Ko/);
  assert.equal(render(React.createElement(InspectPanel, { data: { ...data, name: { fr: "Pâle", en: "Pale" } }, locale: "en" }), "en").includes("By Moi · License MIT · 12 KB"), true);
});

// ── la page entière

const resolveAsync = async (node) => {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync));
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") return resolveAsync(await node.type(node.props));
  const children = node.props?.children;
  if (children === undefined) return node;
  return React.cloneElement(node, undefined, ...(Array.isArray(children) ? await Promise.all(children.map(resolveAsync)) : [await resolveAsync(children)]));
};
async function page(locale = "fr", role = "owner") {
  const email = `${role}-${locale}@example.org`;
  const u = (await db.prisma.user.findUnique({ where: { email } })) ?? (await db.prisma.user.create({ data: { email, name: role, role, passwordHash: "x", locale } }));
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
  const { default: Page } = await import("@/app/admin/(panel)/appearance/page");
  return renderToStaticMarkup(await resolveAsync(await Page()));
}
const install = async (id, from) => { await cat.publish(id, { from }); assert.equal((await S.installFromCatalogue(id)).ok, true); };

test("page, site existant sans skin : titre « Apparence », skin de base seul, aucune retouche à annuler, couleurs et fond comme avant, pas de bouton Revenir au skin", async () => {
  process.env.CURIOSA_SKINS_REPO = "file:///nonexistent/curiosa-skins";
  const html = await page("fr");
  assert.match(html, /<h1[^>]*>Apparence<\/h1>/);
  assert.match(html, /data-testid="current-skin"[\s\S]*Skin de base/);
  assert.equal(count(html, /<li [^>]*data-skin-card=/g), 1);
  assert.doesNotMatch(html, /data-testid="undo-banner"|data-testid="adjusted-notice"|data-testid="active-problem"|data-testid="reset-card"/);
  for (const f of ["background", "accent", "accent2", "surface", "text", "glow", "bgPreset", "headerLayout"]) assert.match(html, new RegExp(`name="${f}"`), f);
  assert.match(html, /data-testid="bg-layers"/);
  assert.match(html, /data-testid="visitor-switch"[\s\S]*Ce skin n&#x27;a qu&#x27;un seul mode/);
  assert.doesNotMatch(html, /name="palette" value="both"/, "basic n'a qu'un mode");
  assert.match(html, /La liste des skins est injoignable pour le moment/, "catalogue injoignable : message simple, la page s'affiche");
  assert.doesNotMatch(html, /\bappearance\.[a-z]+\.?[A-Za-z.]*|settings\.[a-z]+\.[a-z]+/, "aucune clé de traduction affichée telle quelle");
  assert.match(html, /data-testid="personal-repo"/, "le propriétaire voit l'ajout par adresse (replié)");
  assert.match(html, /<details[^>]*data-testid="personal-repo"/);
  assert.doesNotMatch(html, /<details[^>]*data-testid="personal-repo"[^>]*open/);
});

test("page, avec un skin à deux modes choisi : skin actuel, « Annuler », Revenir au skin, options, onglets Clair/Sombre, bouton Clair/Sombre pour les visiteurs, gestion du skin (mise à jour, retrait)", async () => {
  process.env.CURIOSA_SKINS_REPO = cat.url;
  await install("duo", "duo");
  await setSetting("theme.accent", "#00aa00");
  await A.chooseSkin("duo");
  await setSetting("theme.dark.accent", "#aaccff");
  await setSetting("theme.palette", "both");
  const html = await page("fr");
  assert.match(html, /data-testid="current-skin"[\s\S]*Duo de test/);
  assert.match(html, /data-testid="undo-banner"[^>]*>[\s\S]*Vous venez de changer de skin[\s\S]*Skin de base/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-testid="reset-card"[\s\S]*Remet les couleurs, la police, le halo, le fond et l&#x27;en-tête de « Duo de test »/);
  assert.match(html, /data-testid="skin-options"[\s\S]*Densité/);
  assert.match(html, /data-testid="visitor-switch"[\s\S]*data-switch="on"[^>]*>Vos visiteurs peuvent choisir Clair, Sombre ou Automatique/);
  assert.match(html, /data-testid="manage-skins"[\s\S]*data-manage="duo"/);
  assert.match(html, /data-catalogue-skin="duo"[\s\S]*Installé/, "le catalogue dit ce qui est installé");
  assert.match(html, /<option value="skin"[^>]*>Celui du skin<\/option>/, "halo et fond : « celui du skin »");
  assert.match(html, /name="light_background"[\s\S]*name="dark_accent"/);
  // anglais : même structure
  const en = await page("en");
  assert.match(en, /<h1[^>]*>Appearance<\/h1>/);
  assert.match(en, /Your visitors can pick Light, Dark or Automatic/);
  const shape = (h) => [...h.matchAll(/data-testid="([a-z-]+)"/g)].map((m) => m[1]).join(",");
  assert.equal(shape(en), shape(html), "mêmes blocs en français et en anglais");
  assert.doesNotMatch(en, /\bappearance\.[a-z]+\.?[A-Za-z.]*/);
});

test("page, un skin cassé : l'encadré le dit, le skin de base s'applique, rien n'est perdu ; les couleurs ajustées pour être lues sont signalées", async () => {
  process.env.CURIOSA_SKINS_REPO = cat.url;
  await install("plain-light", "plain-light");
  await A.chooseSkin("plain-light");
  await setSetting("theme.text", "#f4f4f5");
  await setSetting("theme.background", "#ffffff");
  let html = await page("fr");
  assert.match(html, /data-testid="adjusted-notice"[^>]*>[\s\S]*Nous avons ajusté une couleur pour qu&#x27;on puisse la lire\./);
  assert.match(html, /« Revenir au skin » remet les couleurs d&#x27;origine/);
  fs.rmSync(path.join(SKINS, "plain-light"), { recursive: true });
  S.clearSkinCaches();
  html = await page("fr");
  assert.match(html, /data-testid="active-problem"[^>]*>Le skin choisi n&#x27;est plus utilisable/);
  assert.match(html, /Les fichiers de ce skin sont introuvables/);
});

test("page, un administrateur (pas propriétaire) : il règle l'apparence, mais ni ajout par adresse ni gestion des skins ; le catalogue le dit", async () => {
  process.env.CURIOSA_SKINS_REPO = cat.url;
  await install("plain-light", "plain-light");
  const html = await page("fr", "admin");
  assert.doesNotMatch(html, /data-testid="personal-repo"|data-testid="manage-skins"/);
  assert.match(html, /Seule la personne propriétaire du site peut ajouter ou retirer un skin\./);
  assert.doesNotMatch(html, /name="id" value="plain-light"[\s\S]{0,200}Installer/);
});

// ── Réglages : ce qui a bougé

test("Réglages : l'onglet garde un lien vers Apparence et le lien / bouton de l'en-tête ; plus de couleurs, de police, de fond ni de disposition dans ce formulaire ; le menu a l'entrée Apparence", () => {
  const settings = read("src/app/admin/(panel)/settings/page.tsx");
  assert.match(settings, /href="\/admin\/appearance"/);
  assert.match(settings, /name="headerSecondaryHref"/);
  assert.match(settings, /name="headerButtonHref"/);
  for (const gone of ["ThemePicker", "HeaderLayoutPicker", "bgPreset", "name=\"font\"", "name=\"glow\"", "data-testid=\"bg-layers\""]) assert.ok(!settings.includes(gone), `Réglages ne doit plus contenir ${gone}`);
  const actions = read("src/app/admin/(panel)/settings/actions.ts");
  for (const gone of ["theme.background", "theme.accent", "theme.glow", "theme.bgPreset", "header.layout", "theme.font"]) assert.ok(!actions.includes(gone), `saveSettings ne doit plus écrire ${gone}`);
  assert.match(actions, /header\.socials/);
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /<NavLink href="\/admin\/appearance">\{t\("nav\.appearance"\)\}<\/NavLink>/);
  assert.ok(layout.indexOf("/admin/appearance") < layout.indexOf("/admin/settings"));
  const appearance = read("src/app/admin/(panel)/appearance/page.tsx");
  assert.match(appearance, /<ThemePicker|<ColorSection/);
  assert.match(appearance, /text=\{config\.textColor\}|textColor/);
});

test("administration jamais restylée : aucune page ni composant d'administration n'importe le rendu des skins ni ne pose data-skin", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const f of [...walk("src/app/admin"), ...walk("src/components/admin")].filter((f) => /\.(ts|tsx)$/.test(f))) {
    const s = read(f);
    assert.ok(!/skins\/render|resolveLook|data-skin=/.test(s) || f.includes("appearance/"), `${f} ne doit pas habiller l'administration`);
  }
  const appearance = walk("src/app/admin/(panel)/appearance").map(read).join("\n");
  assert.ok(!/<html|data-skin=\{|dangerouslySetInnerHTML/.test(appearance), "la page ne pose aucun data-skin ni feuille de skin");
});

// ── aperçu dans l'éditeur d'entrée

test("éditeur d'entrée : l'aperçu porte les jetons EFFECTIFS du skin (retouches comprises) sur UN conteneur ; rien d'autre n'est restylé ; aucune adresse dans les valeurs", async () => {
  await install("duo", "duo");
  await A.chooseSkin("duo");
  await setSetting("theme.palette", "both");
  await setSetting("theme.dark.accent", "#aaccff");
  const { activePreviewTokens } = await import("@/core/skins/appearanceView");
  const p = await activePreviewTokens();
  assert.equal(p.skinId, "duo");
  assert.deepEqual(p.modes.map((m) => m.mode), ["light", "dark"]);
  const dark = p.modes[1].tokens;
  assert.equal(dark["--v-bg"], "#14110d");
  assert.equal(dark["--v-accent"], "#aaccff", "les retouches de la personne comptent");
  for (const m of p.modes) for (const [k, v] of Object.entries(m.tokens)) {
    assert.match(k, /^--(v|sk)-[a-z0-9-]+$/);
    assert.ok(!k.startsWith("--sk-m-") && !/url\s*\(/i.test(v) && v.length <= 300, `${k}`);
  }
  const { EntryPreview } = await import("@/components/admin/EntryPreview");
  const html = render(React.createElement(EntryPreview, { modes: p.modes, href: "/admin/appearance", labels: { title: "Voir avec mon skin", help: "Aide", empty: "Écrivez…", light: "Clair", dark: "Sombre", change: "Changer", modes: "Modes" } }));
  assert.match(html, /<details[^>]*data-testid="entry-preview"/);
  assert.doesNotMatch(html, /<details[^>]*open/, "replié d'office");
  assert.match(html, /data-testid="entry-preview-box"[^>]*style="[^"]*--v-bg:#f4efe4/);
  assert.equal(count(html, /aria-pressed=/g), 2, "clair / sombre");
  for (const m of html.matchAll(/<button[^>]*class="([^"]*)"/g)) assert.match(m[1], /min-h-11/);
  assert.doesNotMatch(html, /<style|data-skin=/, "aucune feuille de skin : l'administration n'est jamais restylée");
  assert.match(html, /Écrivez…/);
  // le formulaire d'entrée l'inclut, et seulement si l'entrée a un texte
  const form = read("src/app/admin/(panel)/entries/EntryForm.tsx");
  assert.match(form, /has\("body"\) && <EntryPreviewBox t=\{t\} locale=\{adminLocale\} \/>/);
});

test("actions « Revenir au skin » et « Annuler » : réservées aux administrateurs, rien ne part sans le marqueur du formulaire, le message dit ce qui s'est passé", async () => {
  await install("plain-light", "plain-light");
  const actions = await import("@/app/admin/(panel)/appearance/actions");
  const u = await db.prisma.user.create({ data: { email: "o@example.org", name: "o", role: "owner", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
  const f = (o) => { const x = new FormData(); for (const [k, v] of Object.entries(o)) x.set(k, v); return x; };
  assert.ok((await actions.chooseSkinAction(null, f({ id: "plain-light" }))).ok);
  assert.ok((await actions.chooseSkinAction(null, f({ id: "plain-light" }))).ok, "déjà choisi : un message, pas une erreur");
  await setSetting("theme.accent", "#123456");
  assert.ok((await actions.resetSkinAction(null, f({}))).error, "sans le marqueur du formulaire : refusé");
  assert.equal((await db.prisma.setting.findUnique({ where: { key_locale: { key: "theme.accent", locale: "" } } })) !== null, true);
  const r = await actions.resetSkinAction(null, f({ what: "reset" }));
  assert.match(r.ok, /valeurs du skin|skin's values/i);
  assert.equal((await db.prisma.setting.findUnique({ where: { key_locale: { key: "theme.accent", locale: "" } } })), null);
  assert.match((await actions.resetSkinAction(null, f({ what: "reset" }))).ok, /Rien à remettre|Nothing to put back/);
  assert.ok((await actions.undoSkinAction(null, f({ what: "undo" }))).ok);
  assert.equal((await db.prisma.setting.findUnique({ where: { key_locale: { key: "theme.accent", locale: "" } } })) !== null, true, "annulé : la retouche est revenue");
  assert.ok((await actions.undoSkinAction(null, f({ what: "undo" }))).error, "plus rien à annuler : un message");
  assert.ok((await actions.undoSkinAction(null, f({}))).error);
});
