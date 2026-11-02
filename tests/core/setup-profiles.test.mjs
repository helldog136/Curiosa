import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// PROFILS DE DÉPART (« Vous êtes… ? ») et MODÈLES DE PAGES : le contrat additif du fichier `catalogue/profiles.json`, la lecture sûre côté cœur, l'assistant
// (sauter, retour arrière, « Autre »), les brouillons d'exemple et le bouton « Partir d'un modèle ». Le cœur ne connaît aucun profil ni aucun module par son nom.
const db = await useTestDb();
const cat = createCatalogue();
const P = await import("@/core/modules/profiles");
const S = await import("@/core/modules/starter");
const { parseManifest } = await import("@/core/modules/manifest");
const C = await import("@/app/admin/(auth)/setup/profileChoice");

beforeEach(async () => { await db.reset(); await cat.clear(); });
after(() => { cat.close(); return db.close(); });

const L = (fr, en = fr) => ({ fr, en });
const TPL = (id, extra = {}) => ({ id, name: L(`Modèle ${id}`, `Template ${id}`), title: L(`Titre ${id}`, `Title ${id}`), summary: L("Résumé", "Summary"), body: L(`Texte de ${id}`, `Text of ${id}`), ...extra });
const CONTENT = (templates) => ({ display: "list", clickAction: "detail", features: ["summary", "body"], basePath: "", templates });
const profile = (id, extra = {}) => ({ id, icon: "🎬", name: L(`Profil ${id}`, `Profile ${id}`), description: L("Description", "Description"), modules: ["pages"], samples: ["pages:about"], ...extra });
const offered = async () => { await cat.add("pages", { manifest: { content: CONTENT([TPL("about"), TPL("hours")]) } }); await cat.add("blog"); await cat.suggest(["pages", "blog"]); };

/* ───────────── le fichier de profils : nettoyage ───────────── */
test("profils : un fichier propre est gardé tel quel, dans l'ordre", () => {
  const out = P.sanitizeProfiles({ version: 1, profiles: [profile("aa"), profile("bb", { modules: ["blog", "pages"], samples: [] })] });
  assert.deepEqual(out.map((p) => p.id), ["aa", "bb"]);
  assert.deepEqual(out[1].modules, ["blog", "pages"]);
  assert.equal(out[0].name.fr, "Profil aa");
  assert.deepEqual(P.sanitizeProfiles([profile("liste")]).map((p) => p.id), ["liste"], "une simple liste est acceptée aussi");
});

test("profils : tout ce qui est abîmé est écarté sans gêner les autres (identifiant, texte, rien à proposer, « other » réservé, doublons, plafonds)", () => {
  const bad = [
    null, 42, "x", { id: "Pas Valide", name: L("x"), modules: ["pages"] }, { id: "sans-nom", modules: ["pages"] }, { id: "vide", name: L("Vide"), modules: [], samples: [] },
    { id: "other", name: L("Autre"), modules: ["pages"] }, profile("ok"), profile("ok"),
    { id: "mauvais-modules", name: L("M"), modules: ["BAD", "pages", 3, "pages"], samples: ["pas-une-reference", "pages:about", "pages:../etc"] },
  ];
  const out = P.sanitizeProfiles({ profiles: bad });
  assert.deepEqual(out.map((p) => p.id), ["ok", "mauvais-modules"]);
  assert.deepEqual(out[1].modules, ["pages"], "identifiant invalide, non texte et doublon écartés");
  assert.deepEqual(out[1].samples, ["pages:about"]);
  assert.deepEqual(P.sanitizeProfiles("n'importe quoi"), []);
  assert.deepEqual(P.sanitizeProfiles({ profiles: "non" }), []);
  const many = P.sanitizeProfiles({ profiles: Array.from({ length: 12 }, (_, i) => profile(`p${i}`)) });
  assert.equal(many.length, P.MAX_PROFILES, "5 profils au plus (+ « Autre » du cœur : 6 cartes)");
  const big = P.sanitizeProfiles({ profiles: [profile("gros", { modules: Array.from({ length: 30 }, (_, i) => `m${i}x`), name: L("N".repeat(500)), description: L("D".repeat(500)) })] })[0];
  assert.equal(big.modules.length, P.MAX_PROFILE_MODULES);
  assert.ok(big.name.fr.length <= 60 && big.description.fr.length <= 140);
});

test("profils : les textes sont du texte, jamais du balisage interprété (React les échappe) et une langue inconnue de forme est ignorée", () => {
  const [p] = P.sanitizeProfiles({ profiles: [profile("xx", { name: { fr: "<b>Gras</b>", "pas une langue": "x", en: 5 } })] });
  assert.deepEqual(Object.keys(p.name), ["fr"]);
  assert.equal(p.name.fr, "<b>Gras</b>", "gardé comme texte : le composant l'affiche échappé");
});

test("profils : resolveProfiles ne garde que les extensions proposées et les modèles déclarés ; un profil qui ne propose plus rien disparaît", () => {
  const offeredModules = [{ id: "pages", templates: [{ id: "about", name: "A" }] }, { id: "blog", templates: [] }];
  const out = P.resolveProfiles([
    profile("a", { modules: ["pages", "inconnu"], samples: ["pages:about", "pages:fantome", "inconnu:about"] }),
    profile("b", { modules: ["inconnu"], samples: ["pages:fantome"] }),
    profile("c", { modules: [], samples: ["pages:about"] }),
  ], offeredModules);
  assert.deepEqual(out.map((p) => [p.id, p.modules, p.samples]), [["a", ["pages"], ["pages:about"]], ["c", [], ["pages:about"]]]);
  assert.deepEqual(P.parseSampleRef("pages:about"), { module: "pages", template: "about" });
  assert.equal(P.parseSampleRef("pages"), null);
  assert.equal(P.pickLocalized({ fr: "Salut", en: "Hi" }, "fr-BE"), "Salut");
  assert.equal(P.pickLocalized({ en: "Hi" }, "de"), "Hi");
});

/* ───────────── lecture depuis le dépôt du catalogue ───────────── */
test("catalogue : les profils viennent de catalogue/profiles.json ; sans ce fichier (ancien dépôt) aucune question n'est posée et le reste marche comme avant", async () => {
  await offered();
  assert.deepEqual((await S.setupModules()).profiles, [], "dépôt sans profiles.json");
  assert.deepEqual((await S.setupModules()).modules.map((m) => m.id).sort(), ["blog", "pages"]);
  await cat.profiles({ version: 1, profiles: [profile("asso", { modules: ["pages", "blog"], samples: ["pages:about", "pages:hours"] })] });
  const got = await S.setupModules();
  assert.deepEqual(got.profiles.map((p) => [p.id, p.modules, p.samples]), [["asso", ["pages", "blog"], ["pages:about", "pages:hours"]]]);
  assert.equal(await db.prisma.module.count(), 0, "lire les profils n'installe rien");
});

test("catalogue : un fichier de profils illisible ou absurde ne casse ni l'assistant ni les extensions suggérées", async () => {
  await offered();
  await cat.profiles("{pas du json", { raw: true });
  const a = await S.setupModules();
  assert.deepEqual([a.profiles, a.modules.length, a.unreachable], [[], 2, false]);
  await cat.profiles({ profiles: [{ id: "xx", name: "X", modules: ["pages"] }] });
  assert.equal((await S.setupModules()).profiles.length, 1);
  await cat.profiles(null);
  assert.deepEqual((await S.setupModules()).profiles, []);
});

test("catalogue : un profil ne peut proposer ni une extension non suggérée ni un modèle que son manifeste ne déclare pas", async () => {
  await offered();
  await cat.add("cache"); // dans l'index, mais pas suggéré à l'assistant
  await cat.profiles({ profiles: [profile("malin", { modules: ["cache", "pages"], samples: ["pages:about", "pages:inexistant", "cache:about"] })] });
  const [p] = (await S.setupModules()).profiles;
  assert.deepEqual([p.modules, p.samples], [["pages"], ["pages:about"]]);
});

test("catalogue : la dernière copie reçue garde les profils (panne passagère), et sans copie il n'y en a plus", async () => {
  await offered();
  await cat.profiles({ profiles: [profile("asso")] });
  assert.equal((await S.setupModules()).profiles.length, 1);
  await cat.down();
  assert.equal((await S.setupModules()).profiles.length, 1, "copie reçue : profils gardés");
  await cat.down({ forget: true });
  const none = await S.setupModules();
  assert.deepEqual([none.profiles, none.modules.length, none.unreachable], [[], 0, true], "catalogue injoignable : pas de question, le site se crée quand même");
});

test("compatibilité : suggested.json garde sa forme (une liste) — un ancien cœur lit le même dépôt sans rien perdre", async () => {
  await offered();
  await cat.profiles({ profiles: [profile("asso")] });
  const suggested = JSON.parse(fs.readFileSync(`${cat.dir}/catalogue/suggested.json`, "utf8"));
  assert.ok(Array.isArray(suggested) && suggested.every((x) => typeof x === "string"));
  assert.ok(!fs.readFileSync(`${cat.dir}/catalogue/index.json`, "utf8").includes("profile"), "l'index ne change pas");
});

/* ───────────── modèles déclarés par un module ───────────── */
test("modèles : content.templates est lu par le manifeste ; l'assistant voit les noms mais pas les textes ; un cœur sans la clé l'ignorerait", async () => {
  const ok = parseManifest({ apiVersion: 2, id: "pages", name: L("Pages"), version: "1.0.0", content: CONTENT([TPL("aa"), TPL("bb")]) });
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  assert.deepEqual(S.templatesOf(ok.manifest).map((t) => t.id), ["aa", "bb"]);
  assert.ok(!("body" in S.templatesOf(ok.manifest)[0]), "le contenu n'est pas copié dans l'offre de l'assistant");
  assert.deepEqual(S.templatesOf(null), []);
  assert.deepEqual(S.templatesOf({ content: undefined }), []);
  // bornes : 8 modèles au plus, identifiant valide, texte borné
  assert.ok(!parseManifest({ apiVersion: 2, id: "pages", name: "P", version: "1.0.0", content: CONTENT(Array.from({ length: 9 }, (_, i) => TPL(`t${i}x`))) }).ok);
  assert.ok(!parseManifest({ apiVersion: 2, id: "pages", name: "P", version: "1.0.0", content: CONTENT([TPL("Pas Valide")]) }).ok);
  assert.ok(!parseManifest({ apiVersion: 2, id: "pages", name: "P", version: "1.0.0", content: CONTENT([TPL("ok", { body: "x".repeat(6001) })]) }).ok);
  assert.ok(parseManifest({ apiVersion: 2, id: "pages", name: "P", version: "1.0.0", content: { display: "list", clickAction: "detail", features: [] } }).ok, "un module sans modèle marche comme avant");
});

test("assistant : les extensions suggérées portent leurs modèles, lus dans le manifeste sans rien installer", async () => {
  await offered();
  const pages = (await S.setupModules()).modules.find((m) => m.id === "pages");
  assert.deepEqual(pages.templates.map((t) => t.id), ["about", "hours"]);
  assert.deepEqual((await S.setupModules()).modules.find((m) => m.id === "blog").templates, []);
});

/* ───────────── pages d'exemple : brouillons, relus côté serveur ───────────── */
const manifestWith = (id, templates) => { const r = parseManifest({ apiVersion: 2, id, name: L(id), version: "1.0.0", content: CONTENT(templates) }); assert.ok(r.ok); return r.manifest; };

test("pages d'exemple : seules celles dont l'extension est installée ET qui déclare le modèle sont créées, sans doublon, dans la langue du site", () => {
  const pages = manifestWith("pages", [TPL("about"), TPL("hours")]);
  const out = S.chosenSamples(["pages:about", "pages:about", "pages:fantome", "blog:about", "n'importe quoi", "pages:hours"], [pages], "en");
  assert.deepEqual(out.map((s) => [s.moduleId, s.template, s.title, s.body]), [["pages", "about", "Title about", "Text of about"], ["pages", "hours", "Title hours", "Text of hours"]]);
  assert.equal(S.chosenSamples(["pages:about"], [pages], "fr")[0].title, "Titre about");
  assert.deepEqual(S.chosenSamples(["pages:about"], [], "fr"), [], "extension non installée : rien");
  assert.equal(S.chosenSamples(Array.from({ length: 30 }, (_, i) => `pages:t${i}`), [pages], "fr").length, 0);
});

test("pages d'exemple : créées en BROUILLON (jamais publiées), dans l'instance de l'extension, et modifiables", async () => {
  const { prisma } = db;
  const { createInstance } = await import("@/core/instanceService");
  const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
  await db.fixture("pages");
  const base = FIXTURE_MODULES.find((b) => b.manifest.id === "pages").manifest;
  const pages = { ...base, content: { ...base.content, templates: [TPL("about"), TPL("hours")] } };
  const owner = await prisma.user.create({ data: { email: "a@b.c", name: "A", role: "owner", passwordHash: "x", locale: "fr" } });
  const instance = await createInstance(prisma, { manifest: pages, names: { fr: "Pages", en: "Pages" } });
  const n = await S.createSampleDrafts(prisma, ["pages:about", "pages:hours", "pages:fantome"], [{ manifest: pages, instance }], "fr", owner.id);
  assert.equal(n, 2);
  const entries = await prisma.entry.findMany({ where: { instanceId: instance.id }, include: { translations: true }, orderBy: { position: "asc" } });
  assert.deepEqual(entries.map((e) => [e.status, e.publishedAt, e.translations[0].title]), [["draft", null, "Titre about"], ["draft", null, "Titre hours"]]);
  assert.equal(await S.createSampleDrafts(prisma, ["pages:about"], [], "fr", owner.id), 0, "sans instance créée : rien");
});

/* ───────────── le choix du profil : pré-cocher, sauter, revenir en arrière ───────────── */
const asso = { modules: ["pages", "blog"], samples: ["pages:about", "pages:hours"] };
const solo = { modules: ["links"], samples: ["pages:me"] };

test("choix d'un profil : coche les extensions et propose les exemples ; sauter ne coche rien", () => {
  const start = { chosen: [], samples: [] };
  assert.deepEqual(C.applyProfile(start, null, asso), { chosen: ["pages", "blog"], samples: ["pages:about", "pages:hours"] });
  assert.deepEqual(C.applyProfile(start, null, null), start, "sauter (ou « Autre ») ne change rien");
});

test("retour arrière : changer de profil remplace ce que l'ancien avait coché, garde ce que la personne a coché elle-même ; revenir à « aucun » défait le profil", () => {
  const afterAsso = C.applyProfile({ chosen: ["links"], samples: [] }, null, asso);
  assert.deepEqual(afterAsso.chosen, ["links", "pages", "blog"]);
  const afterSolo = C.applyProfile(afterAsso, asso, solo);
  assert.deepEqual(afterSolo, { chosen: ["links"], samples: ["pages:me"] }, "pages et blog retirés, « links » (coché à la main) gardé");
  assert.deepEqual(C.applyProfile(afterAsso, asso, null), { chosen: ["links"], samples: [] });
  assert.deepEqual(C.applyProfile({ chosen: ["pages"], samples: ["pages:about"] }, asso, asso).chosen, ["pages", "blog"], "même profil : stable, sans doublon");
});

test("pages d'exemple proposées : seulement tant que leur extension est cochée", () => {
  assert.deepEqual(C.profileSamples(asso, ["pages", "blog"]), ["pages:about", "pages:hours"]);
  assert.deepEqual(C.profileSamples(asso, ["blog"]), [], "« pages » décoché : plus d'exemple de pages");
  assert.deepEqual(C.profileSamples(null, ["pages"]), []);
});

/* ───────────── l'écran : budgets, sauter, mots, parité ───────────── */
const read = (p) => fs.readFileSync(p, "utf8");
const wizard = read("src/app/admin/(auth)/setup/SetupWizard.tsx");

test("assistant : la question est une étape facultative (sauter = chemin par défaut), 6 cartes au plus dont « Autre », rien n'est obligatoire", () => {
  assert.match(wizard, /"profile"/);
  assert.match(wizard, /profiles\.length > 0/, "pas de profil dans le dépôt : la question n'est pas posée");
  assert.match(wizard, /data-testid="profile-skip"/);
  assert.match(wizard, /setup\.profile\.skipButton/);
  assert.match(wizard, /id: "other"/, "« Autre » est celui du cœur, il ne change rien");
  assert.match(wizard, /type="radio" name="profile"/, "de vrais boutons radio : clavier et lecteur d'écran");
  assert.ok(P.MAX_PROFILES + 1 <= 6);
  assert.doesNotMatch(wizard, /preselected|always/);
  assert.match(wizard, /<MoreOptions[^>]*setup\.samples\.title/, "les pages d'exemple sont repliées avec un résumé (R7)");
  assert.match(wizard, /name="samples"/);
  assert.match(wizard, /min-h-11/, "cibles d'au moins 44 px");
  const actions = read("src/app/admin/(auth)/setup/actions.ts");
  assert.match(actions, /createSampleDrafts\(tx, sampleRefs/, "les exemples sont créés avec le site, en brouillon");
  assert.doesNotMatch(actions, /formData\.get\("profile"\)/, "le serveur ne se fie qu'aux modules et aux modèles, jamais au profil envoyé");
});

test("assistant : la progression n'affiche toujours aucun total et ne recule jamais avec l'étape du profil", async () => {
  const prog = await import("@/app/admin/(auth)/setup/progress");
  assert.equal(prog.MAX_STEPS, 6);
  const seq = [0, 1, 2, 3, 4, 5].map((s) => prog.progressPercent(s, s === 5));
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
  assert.equal(seq.at(-1), 100);
});

const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
const KEYS = ["setup.profile.title", "setup.profile.help", "setup.profile.other", "setup.profile.otherHelp", "setup.profile.skip", "setup.profile.skipButton", "setup.samples.title", "setup.samples.help", "setup.samples.summary", "setup.samples.summary.one",
  "entries.templates.title", "entries.templates.intro", "entries.templates.use", "entries.templates.open", "entries.createdFromTemplate"];

test("textes : FR et EN à parité (mêmes clés, mêmes {variables}), avant le groupe final theme.custom … settings.contrast.accent2", () => {
  const vars = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");
  for (const k of KEYS) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k); }
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    for (const k of KEYS) assert.ok(all.indexOf(k) < all.indexOf("theme.custom"), `${k} doit précéder theme.custom`);
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
  const strings = read("src/app/admin/(auth)/setup/strings.ts");
  for (const k of KEYS.filter((k) => k.startsWith("setup."))) assert.ok(strings.includes(`"${k}"`), `${k} est envoyée à l'assistant`);
});

test("textes : mots interdits (R9), libellés courts sans deux-points (R10), ton (R13) — pas de point d'exclamation, de « Veuillez » ni de majuscules criées", async () => {
  const { forbiddenWords, labelProblems, toneProblems } = await import("../../testsupport/ergonomics.mjs");
  for (const lang of [fr, en]) for (const k of KEYS) {
    assert.deepEqual(forbiddenWords(lang[k]), [], `${k} : ${lang[k]}`);
    assert.doesNotMatch(lang[k], /!|veuillez/i, k);
    assert.deepEqual(toneProblems(lang[k]), [], k);
  }
  for (const k of ["setup.profile.title", "setup.profile.other", "setup.profile.skipButton", "setup.samples.title", "entries.templates.title", "entries.templates.use", "entries.templates.open"])
    for (const lang of [fr, en]) assert.deepEqual(labelProblems(lang[k]), [], k);
});

test("liste d'entrées : « Partir d'un modèle » dans l'état vide ET dans l'en-tête, seulement si le module déclare des modèles ; un seul bouton principal", () => {
  const list = read("src/app/admin/(panel)/entries/page.tsx");
  assert.equal((list.match(/entries\.templates\.open/g) ?? []).length, 2);
  assert.match(list, /content\?\.templates/);
  assert.match(list, /templatesHref && /);
  assert.equal((list.match(/ui\.btnPrimary/g) ?? []).length, 2, "le bouton principal de l'état vide et celui de l'en-tête (jamais ensemble) ; le modèle est secondaire");
  const tpl = read("src/app/admin/(panel)/entries/templates/page.tsx");
  assert.match(tpl, /content\?\.templates/);
  assert.match(tpl, /notFound\(\)/, "sans modèle déclaré, la page n'existe pas");
  const act = read("src/app/admin/(panel)/entries/actions.ts");
  assert.match(act, /status: "draft"/, "un modèle crée toujours un brouillon");
  assert.match(act, /adminCtx\("editor"\)/);
  assert.match(act, /templates \?\? \[\]\)?\.?find|\.find\(\(x\) => x\.id === String\(formData\.get\("template"\)/, "le modèle est relu dans le manifeste, jamais pris du formulaire");
  const edit = read("src/app/admin/(panel)/entries/[id]/page.tsx");
  assert.match(edit, /created === "template"/);
});
