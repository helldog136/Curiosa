// Page Apparence, côté serveur (lot S7, docs/SKINS.md §3.3, §3.7, §10) : choisir un skin (retouches mises de côté), « Revenir au skin », « Annuler »,
// enregistrement des retouches (sur basic : EXACTEMENT les écritures d'avant les skins ; sur un skin : seulement ce qui diffère), deux modes, options,
// aperçu par jeton signé, installation / mise à jour / retrait par les actions, rôles. De vrais dépôts git locaux jetables, aucun réseau.
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
const S = await import("@/core/skins/service");
const A = await import("@/core/skins/appearance");
const V = await import("@/core/skins/appearanceView");
const P = await import("@/core/skins/previewToken");
const { skinCacheGeneration } = await import("@/core/skins/invalidate");
const { setSetting, getSetting } = await import("@/core/settings");
const actions = await import("@/app/admin/(panel)/appearance/actions");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");

async function keys(prefix = "") {
  const rows = await db.prisma.setting.findMany({ where: { locale: "" } });
  return Object.fromEntries(rows.filter((r) => r.key.startsWith(prefix) && r.key !== "i18n.default").map((r) => [r.key, JSON.parse(r.value)]));
}
const retouchKeys = async () => Object.keys(await keys()).filter((k) => A.RETOUCH_SETTINGS.includes(k)).sort();
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, String(v)); return f; };
const asAdmin = async (role = "owner") => {
  const email = `${role}@example.org`;
  const u = (await db.prisma.user.findUnique({ where: { email } })) ?? (await db.prisma.user.create({ data: { email, name: role, role, passwordHash: "x" } }));
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
  return u;
};

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.setServiceHooksForTests({});
  S.clearSkinCaches();
  delete process.env.SKINS_INDEX_URL;
  globalThis.curiosaTestSession = null;
  await asAdmin("owner");
});
after(() => { db.close(); cat.close(); });

const install = async (id, from) => {
  await cat.publish(id, { from });
  const r = await S.installFromCatalogue(id);
  assert.equal(r.ok, true, JSON.stringify(r));
};

/** Les retouches d'un site existant : ce que l'ancienne page de réglages écrivait. */
async function legacyRetouches() {
  await setSetting("theme.background", "#0b1220");
  await setSetting("theme.accent", "#38bdf8");
  await setSetting("theme.accent2", "#fb7185");
  await setSetting("theme.surface", "#142035");
  await setSetting("theme.text", "#e6edf7");
  await setSetting("theme.font", "serif");
  await setSetting("theme.glow", "soft");
  await setSetting("theme.bgPreset", "grid");
  await setSetting("header.layout", "twoRows");
  await setSetting("theme.admin", "dark");              // le thème de l'administration n'est PAS une retouche
}

test("choisir un skin : retouches copiées dans skin.snapshot puis supprimées, options effacées, thème de l'administration intact, audit, rendu invalidé", async () => {
  await install("plain-light", "plain-light");
  await legacyRetouches();
  await setSetting("skin.options", { density: "airy" });
  const g0 = skinCacheGeneration();
  const r = await A.chooseSkin("plain-light", { actor: "owner@example.org" });
  assert.deepEqual(r, { ok: true, changed: true, keptSnapshot: true });
  assert.equal(await getSetting("skin.active"), "plain-light");
  assert.deepEqual(await retouchKeys(), [], "le skin donne les valeurs de départ : plus aucune retouche");
  assert.equal(await getSetting("theme.admin"), "dark", "l'administration garde son thème");
  assert.equal(await getSetting("skin.options"), undefined);
  const snap = await A.readSnapshot();
  assert.equal(snap.kind, "choose");
  assert.equal(snap.fromSkin, "basic");
  assert.equal(snap.values["theme.accent"], "#38bdf8");
  assert.equal(snap.values["header.layout"], "twoRows");
  assert.equal(snap.values["theme.admin"], undefined, "theme.admin n'est jamais mis de côté");
  assert.deepEqual(snap.fromOptions, { density: "airy" });
  assert.ok(skinCacheGeneration() > g0, "la feuille du site public est recomposée");
  const audit = (await db.prisma.auditLog.findMany()).filter((a) => a.action === "skin.activate");
  assert.deepEqual(audit.map((a) => [a.actor, a.target]), [["owner@example.org", "plain-light"]]);
  // le même skin deux fois : rien ne change, le « Annuler » d'avant reste possible
  assert.deepEqual(await A.chooseSkin("plain-light"), { ok: true, changed: false, keptSnapshot: true });
});

test("choisir : un skin inconnu, un id douteux ou un skin dont les fichiers ont disparu est refusé SANS rien changer", async () => {
  await install("plain-light", "plain-light");
  await legacyRetouches();
  for (const id of ["nope", "../x", "BASIC", "", "a".repeat(80)]) {
    const r = await A.chooseSkin(id);
    assert.equal(r.ok, false, id);
  }
  assert.equal(await getSetting("skin.active"), undefined);
  assert.equal((await retouchKeys()).length, 9);
  assert.equal(await A.readSnapshot(), null);
  fs.rmSync(path.join(SKINS, "plain-light"), { recursive: true });
  S.clearSkinCaches();
  const gone = await A.chooseSkin("plain-light");
  assert.equal(gone.ok, false);
  assert.equal(gone.error, "skins.error.invalid");
  assert.equal(await getSetting("skin.active"), undefined);
});

test("annuler : skin, retouches et options d'avant reviennent exactement ; le skin d'avant a disparu → basic mais les retouches reviennent", async () => {
  await install("plain-light", "plain-light");
  await install("duo", "duo");
  await legacyRetouches();
  const before = await keys("theme.");
  await A.chooseSkin("plain-light");
  assert.equal((await A.undoLastChange({ actor: "owner@example.org" })).ok, true);
  assert.equal(await getSetting("skin.active"), "basic");
  assert.deepEqual(await keys("theme."), before, "tout est comme avant, clé pour clé");
  assert.equal(await getSetting("header.layout"), "twoRows");
  assert.equal(await A.readSnapshot(), null);
  assert.equal((await A.undoLastChange()).error, "skins.error.nosnapshot");

  // d'un skin à un autre, avec options
  await A.chooseSkin("duo");
  await A.saveSkinOptions([{ id: "density", default: "normal", values: [{ id: "normal" }, { id: "airy" }] }], { density: "airy" });
  assert.deepEqual(await getSetting("skin.options"), { density: "airy" });
  await A.chooseSkin("plain-light");
  assert.equal(await getSetting("skin.options"), undefined);
  await A.undoLastChange();
  assert.equal(await getSetting("skin.active"), "duo");
  assert.deepEqual(await getSetting("skin.options"), { density: "airy" }, "les options du skin d'avant reviennent");

  // le skin d'avant a été retiré entre-temps
  await A.chooseSkin("plain-light");
  assert.equal((await S.remove("duo")).ok, true);
  await A.undoLastChange();
  assert.equal(await getSetting("skin.active"), "basic");
  assert.equal(await getSetting("theme.accent"), undefined, "ici le snapshot n'avait pas de retouches");
});

test("revenir au skin : retouches mises de côté (avec « Annuler »), rien à remettre quand rien n'est retouché, thème de l'administration intact", async () => {
  await install("plain-light", "plain-light");
  await A.chooseSkin("plain-light");
  assert.deepEqual(await A.resetToSkin(), { ok: true, changed: false });
  await setSetting("theme.accent", "#112233");
  await setSetting("header.layout", "minimal");
  await setSetting("theme.admin", "light");
  const r = await A.resetToSkin({ actor: "owner@example.org" });
  assert.deepEqual(r, { ok: true, changed: true });
  assert.deepEqual(await retouchKeys(), []);
  assert.equal(await getSetting("theme.admin"), "light");
  const snap = await A.readSnapshot();
  assert.equal(snap.kind, "reset");
  assert.equal(snap.fromSkin, "plain-light");
  assert.equal((await A.undoLastChange()).skin, "plain-light");
  assert.equal(await getSetting("theme.accent"), "#112233");
  assert.equal(await getSetting("header.layout"), "minimal");
  assert.equal(await getSetting("skin.active"), "plain-light");
});

// ── enregistrement des retouches : sur basic, comme avant les skins

test("NON-RÉGRESSION : un site sans skin se règle comme avant (mêmes clés, mêmes valeurs qu'avec l'ancienne page de réglages)", async () => {
  const base = { background: "#0B1220", accent: "#38BDF8", accent2: "#FB7185", surface: "#142035", text: "#E6EDF7", glow: "soft", bgPreset: "grid", headerLayout: "twoRows" };
  // version simple : ni police, ni réglage technique envoyés
  let r = await actions.saveAppearance(null, form(base));
  assert.equal(r.ok !== undefined, true, JSON.stringify(r));
  assert.deepEqual(await keys("theme."), {
    "theme.background": "#0B1220", "theme.accent": "#38BDF8", "theme.accent2": "#fb7185", "theme.surface": "#142035", "theme.text": "#e6edf7",
    "theme.glow": "soft", "theme.bgPreset": "grid",
  }, "fond et accent gardent leur casse d'origine, les autres sont en minuscules, comme avant");
  assert.equal(await getSetting("header.layout"), "twoRows");
  assert.equal(await getSetting("theme.font"), undefined, "version simple : la police n'est pas touchée");
  assert.equal(await getSetting("skin.active"), undefined, "sur basic, aucune clé de skin n'est écrite");
  assert.equal(await getSetting("theme.palette"), undefined);

  // accent2 / surface / texte vides = retour au dérivé (clé supprimée) ; version avancée : police, halo personnalisé, fond SVG
  r = await actions.saveAppearance(null, form({ ...base, accent2: "", surface: "", text: "", __adv: "1", font: "mono", glow: "custom", glow_count: "3", glow_followAccent: "on", bgPreset: "custom", bgCustom: '[{"type":"radial","x":50,"y":0,"w":80,"h":50,"stops":[{"color":"accent","a":22},{"color":"accent","at":100,"a":0}]}]', bgSvg: "", bgSvgFit: "tile", bgSvgAlign: "right", bgSvgTile: "300" }));
  assert.ok(r.ok, JSON.stringify(r));
  const k = await keys("theme.");
  assert.equal(k["theme.accent2"], undefined);
  assert.equal(k["theme.surface"], undefined);
  assert.equal(k["theme.text"], undefined);
  assert.equal(k["theme.font"], "mono");
  assert.equal(k["theme.glow"], "custom");
  assert.equal(k["theme.glow.custom"].count, 3);
  assert.equal(k["theme.bgPreset"], "custom");
  assert.match(k["theme.bgCustom"], /radial/);
  assert.deepEqual([k["theme.bgSvgFit"], k["theme.bgSvgAlign"], k["theme.bgSvgTile"]], ["tile", "right", 300]);
  assert.equal(k["theme.bgImage"], undefined);
  // les valeurs par défaut sont ÉCRITES sur basic (comme avant)
  await db.prisma.setting.deleteMany({});
  assert.ok((await actions.saveAppearance(null, form({ background: "#121214", accent: "#e8a23b", glow: "none", bgPreset: "none", headerLayout: "classic" }))).ok);
  assert.deepEqual(await keys(), { "theme.background": "#121214", "theme.accent": "#e8a23b", "theme.glow": "none", "theme.bgPreset": "none", "header.layout": "classic" });
});

test("enregistrement : une couleur invalide, une image ou un fond refusés n'écrivent RIEN et le disent sous le champ", async () => {
  assert.equal((await actions.saveAppearance(null, form({ background: "rouge", accent: "#e8a23b" }))).error !== undefined, true);
  assert.equal((await actions.saveAppearance(null, form({ background: "#121214", accent: "#e8a23b", accent2: "pas-une-couleur" }))).error !== undefined, true);
  const img = await actions.saveAppearance(null, form({ background: "#121214", accent: "#e8a23b", bgImage: "http://example.org/x.png" }));
  assert.ok(img.errors?.bgImage, "message sous le champ de l'image");
  const bad = await actions.saveAppearance(null, form({ background: "#121214", accent: "#e8a23b", __adv: "1", bgPreset: "custom", bgCustom: "{pas du json" }));
  assert.match(bad.error, /./);
  assert.deepEqual(await keys(), {});
});

// ── enregistrement sur un skin : seulement ce qui diffère

test("sur un skin : rien n'est écrit tant qu'on ne change rien ; une retouche n'écrit QUE la clé touchée ; la remettre à la valeur du skin supprime la clé", async () => {
  await install("plain-light", "plain-light");
  await A.chooseSkin("plain-light");
  const view = await V.loadAppearanceView();
  const sv = view.skinColors.light;
  assert.equal(view.activeId, "plain-light");
  assert.deepEqual(view.modes, ["light"]);
  assert.equal(sv.background, "#fafaf7");
  const same = { palette: "single", background: sv.background, accent: sv.accent, accent2: sv.accent2, surface: sv.surface, text: sv.text, glow: "skin", bgPreset: "skin", headerLayout: view.skinDefaults.headerLayout };
  assert.ok((await actions.saveAppearance(null, form(same))).ok);
  assert.deepEqual(await retouchKeys(), [], "le formulaire envoie tout, mais seul ce qui diffère du skin est gardé");

  assert.ok((await actions.saveAppearance(null, form({ ...same, accent: "#0a7a3c" }))).ok);
  assert.deepEqual(await retouchKeys(), ["theme.accent"]);
  assert.equal(await getSetting("theme.accent"), "#0a7a3c");
  assert.ok((await actions.saveAppearance(null, form({ ...same, accent: sv.accent }))).ok);
  assert.deepEqual(await retouchKeys(), [], "« ↺ valeur du skin » : la clé disparaît");

  // halo, fond, en-tête : « celui du skin » ne retouche rien ; un autre choix oui
  assert.ok((await actions.saveAppearance(null, form({ ...same, glow: "strong", bgPreset: "dusk", headerLayout: "minimal" }))).ok);
  assert.deepEqual(await retouchKeys(), ["header.layout", "theme.bgPreset", "theme.glow"]);
  assert.ok((await actions.saveAppearance(null, form(same))).ok);
  assert.deepEqual(await retouchKeys(), []);
});

test("enregistrer une vraie retouche supprime le « Annuler » du dernier changement de skin ; un enregistrement sans changement le garde", async () => {
  await install("plain-light", "plain-light");
  await A.chooseSkin("plain-light");
  const sv = (await V.loadAppearanceView()).skinColors.light;
  const same = { background: sv.background, accent: sv.accent, accent2: "", surface: sv.surface, text: sv.text, glow: "skin", bgPreset: "skin", headerLayout: "classic" };
  await actions.saveAppearance(null, form(same));
  assert.notEqual(await A.readSnapshot(), null, "rien n'a changé : on peut encore annuler");
  await actions.saveAppearance(null, form({ ...same, accent: "#123456" }));
  assert.equal(await A.readSnapshot(), null, "tant qu'on n'a pas changé autre chose (§3.3)");
});

// ── deux modes

test("deux modes : « clair et sombre » écrit theme.palette et theme.light.* / theme.dark.* (différences seulement) ; les anciennes clés sont gardées", async () => {
  await install("duo", "duo");
  await A.chooseSkin("duo");
  let view = await V.loadAppearanceView();
  assert.deepEqual(view.modes, ["light", "dark"]);
  assert.equal(view.palette, "single");
  assert.equal(view.switchAvailable, true, "le skin a les deux modes : la bascule existe");
  const L = view.skinColors.light, D = view.skinColors.dark;
  assert.deepEqual([L.background, D.background], ["#f4efe4", "#14110d"]);
  await setSetting("theme.accent", "#00aa00");                         // une ancienne retouche « un seul mode »
  const same = {
    palette: "both", glow: "skin", bgPreset: "skin", headerLayout: "centered",
    ...Object.fromEntries(Object.entries(L).map(([k, v]) => [`light_${k}`, v])), ...Object.fromEntries(Object.entries(D).map(([k, v]) => [`dark_${k}`, v])),
  };
  assert.ok((await actions.saveAppearance(null, form({ ...same, dark_accent: "#aaccff", light_text: "#222222" }))).ok);
  assert.deepEqual(await retouchKeys(), ["theme.accent", "theme.dark.accent", "theme.light.text", "theme.palette"]);
  assert.equal(await getSetting("theme.palette"), "both");
  assert.equal(await getSetting("theme.dark.accent"), "#aaccff");
  assert.equal(await getSetting("theme.light.text"), "#222222");
  assert.equal(await getSetting("theme.accent"), "#00aa00", "l'ancien jeu « un seul mode » est gardé pour y revenir sans perte");
  view = await V.loadAppearanceView();
  assert.equal(view.palette, "both");
  assert.equal(view.both.dark.accent, "#aaccff");
  assert.equal(view.both.light.accent, L.accent);
  assert.equal(view.switchAvailable, true, "clair ET sombre : la bascule du visiteur reste");
  assert.equal(view.retouched, true);
  // retour à « un seul mode » : theme.palette disparaît, les jeux par mode restent
  assert.ok((await actions.saveAppearance(null, form({ ...same, palette: "single", background: L.background, accent: L.accent, accent2: "", surface: L.surface, text: L.text }))).ok);
  assert.equal(await getSetting("theme.palette"), undefined);
  assert.equal(await getSetting("theme.dark.accent"), "#aaccff");
});

test("deux modes, « un seul mode » avec un autre fond : le site n'a plus qu'un mode et la bascule disparaît (le mode vient de la luminance du fond)", async () => {
  await install("duo", "duo");
  await A.chooseSkin("duo");
  const L = (await V.loadAppearanceView()).skinColors.light;
  const same = { palette: "single", background: L.background, accent: L.accent, accent2: "", surface: L.surface, text: L.text, glow: "skin", bgPreset: "skin", headerLayout: "centered" };
  assert.ok((await actions.saveAppearance(null, form({ ...same, background: "#101018" }))).ok);
  const view = await V.loadAppearanceView();
  assert.equal(view.switchAvailable, false);
  assert.deepEqual(view.retouches.single.background, "#101018");
});

test("options du skin : seules les valeurs déclarées sont gardées, la valeur par défaut n'est pas écrite", async () => {
  await install("duo", "duo");
  await A.chooseSkin("duo");
  let view = await V.loadAppearanceView();
  assert.deepEqual(view.options.map((o) => [o.id, o.default, o.chosen, o.values.map((v) => v.id)]), [["density", "normal", "normal", ["normal", "airy"]]]);
  assert.ok((await actions.saveOptionsAction(null, form({ option_density: "airy" }))).ok);
  assert.deepEqual(await getSetting("skin.options"), { density: "airy" });
  assert.ok((await actions.saveOptionsAction(null, form({ option_density: "inventé" }))).ok);
  assert.equal(await getSetting("skin.options"), undefined, "une valeur inconnue retombe sur le défaut, rien n'est écrit");
  assert.ok((await actions.saveOptionsAction(null, form({ option_density: "normal" }))).ok);
  assert.equal(await getSetting("skin.options"), undefined);
  view = await V.loadAppearanceView();
  assert.equal(view.options[0].chosen, "normal");
});

// ── le modèle de la page

test("modèle : sans skin, basic seul, un mode (sombre), pas de bascule, valeurs d'avant les skins ; avec des retouches, elles s'affichent", async () => {
  const v = await V.loadAppearanceView();
  assert.deepEqual([v.activeId, v.activeProblem, v.modes, v.palette, v.switchAvailable, v.retouched, v.snapshot], ["basic", false, ["dark"], "single", false, false, null]);
  assert.deepEqual(v.cards.map((c) => [c.id, c.source, c.active]), [["basic", "basic", true]]);
  assert.equal(v.active.name.fr, "Skin de base");
  assert.equal(v.single.background, "#121214");
  await setSetting("theme.background", "#0b1220");
  await setSetting("theme.accent", "#38bdf8");
  const v2 = await V.loadAppearanceView();
  assert.equal(v2.single.background, "#0b1220");
  assert.equal(v2.retouched, true);
});

test("modèle : un skin dont les fichiers ont disparu ne casse pas la page (basic s'applique, le problème est dit, rien n'est perdu)", async () => {
  await install("plain-light", "plain-light");
  await A.chooseSkin("plain-light");
  fs.rmSync(path.join(SKINS, "plain-light"), { recursive: true });
  S.clearSkinCaches();
  const v = await V.loadAppearanceView();
  assert.equal(v.activeProblem, true);
  assert.equal(v.activeId, "basic");
  assert.equal(v.cards.find((c) => c.id === "plain-light").status, "missing");
  assert.equal(await getSetting("skin.active"), "plain-light", "le choix est gardé : il se réactive à la réinstallation");
});

test("modèle : « nous avons ajusté une couleur » (notices de composition) pour des retouches illisibles ; la retouche est enregistrée quand même", async () => {
  await install("plain-light", "plain-light");
  await A.chooseSkin("plain-light");
  const sv = (await V.loadAppearanceView()).skinColors.light;
  const r = await actions.saveAppearance(null, form({ palette: "single", background: "#ffffff", accent: sv.accent, accent2: "", surface: sv.surface, text: "#f4f4f5", glow: "skin", bgPreset: "skin", headerLayout: "classic" }));
  assert.ok(r.ok, "jamais bloquant");
  assert.equal(await getSetting("theme.text"), "#f4f4f5");
  const v = await V.loadAppearanceView();
  assert.ok(v.notices.length > 0, "le rendu a corrigé le texte pâle sur fond blanc");
  assert.ok(v.notices.every((n) => n.fr && n.en));
});

// ── aperçu

test("aperçu : jeton signé de 15 minutes ; falsifié, expiré, autre secret, forme douteuse → refusé", () => {
  const secret = "secret-de-test";
  const now = 1_700_000_000_000;
  const t = P.signPreview("duo", secret, now);
  assert.match(t, P.PREVIEW_TOKEN_RE);
  assert.equal(P.verifyPreview(t, secret, now + 60_000), "duo");
  assert.equal(P.verifyPreview(P.signPreview("basic", secret, now), secret, now), "basic");
  assert.equal(P.verifyPreview(t, secret, now + P.PREVIEW_TTL_MS + 5_000), null, "expiré");
  assert.equal(P.verifyPreview(t, "autre", now), null, "autre secret");
  const [id, exp, sig] = t.split(".");
  assert.equal(P.verifyPreview(`autre.${exp}.${sig}`, secret, now), null, "le skin ne peut pas être changé");
  assert.equal(P.verifyPreview(`${id}.${(parseInt(exp, 36) + 99999999).toString(36)}.${sig}`, secret, now), null, "la date ne peut pas être prolongée");
  for (const bad of [undefined, null, 5, "", "a.b.c", "x".repeat(300), `${t}.x`, t.toUpperCase(), `../x.${exp}.${sig}`]) assert.equal(P.verifyPreview(bad, secret, now), null, String(bad));
  assert.throws(() => P.signPreview("../x", secret));
  assert.equal(P.previewUrl("/blog?a=1", t), `/blog?a=1&curiosa_skin_preview=${t}`);
  assert.equal(P.previewUrl("//evil.example", t), `/?curiosa_skin_preview=${t}`, "jamais une adresse extérieure");
});

test("aperçu : le skin demandé s'applique SANS les retouches ni les options de la personne, et rien n'est enregistré ; basic aussi", async () => {
  await install("duo", "duo");
  await legacyRetouches();
  await setSetting("theme.accent", "#ff00ff");
  const { resolveLook } = await import("@/core/skins/render");
  const { getSiteConfig } = await import("@/core/settings");
  const before = JSON.stringify(await keys());
  const config = await getSiteConfig();
  const current = await resolveLook(config);
  assert.equal(current.composed.skinId, "basic");
  assert.match(current.sheet, /#ff00ff/i, "le site actuel a la retouche");
  const look = await resolveLook(config, { previewSkinId: "duo" });
  assert.equal(look.composed.skinId, "duo");
  assert.ok(look.sheet.includes(':root[data-skin="duo"]'));
  assert.ok(!/#ff00ff/i.test(look.sheet), "les retouches ne s'appliquent pas à l'aperçu");
  assert.equal(look.headerLayout, "centered", "l'en-tête de départ du skin, pas la retouche");
  assert.equal(look.composed.switchAvailable, true);
  const basicLook = await resolveLook(config, { previewSkinId: "basic" });
  assert.ok(!/#ff00ff/i.test(basicLook.sheet) && basicLook.headerLayout === "classic");
  const unknown = await resolveLook(config, { previewSkinId: "pas-installe" });
  assert.equal(unknown.composed.skinId, "basic", "un skin absent n'est jamais appliqué");
  assert.equal(JSON.stringify(await keys()), before, "aucun réglage n'a changé");
  // la page du site relit le skin actif ensuite, comme avant
  assert.equal((await resolveLook(config)).composed.skinId, "basic");
});

test("aperçu : l'action fabrique le lien pour un skin installé ou basic, refuse un inconnu, réservée aux administrateurs", async () => {
  await install("duo", "duo");
  const ok = await actions.previewLinkAction("duo", "/blog");
  assert.equal(ok.ok, true);
  assert.match(ok.url, /^\/blog\?curiosa_skin_preview=duo\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
  assert.equal((await actions.previewLinkAction("basic")).ok, true);
  assert.equal((await actions.previewLinkAction("inconnu")).ok, false);
  await asAdmin("editor");
  await assert.rejects(() => actions.previewLinkAction("duo"), "un éditeur n'a pas accès à l'apparence");
  globalThis.curiosaTestSession = null;
  await assert.rejects(() => actions.previewLinkAction("duo"), "personne de connecté : refusé");
});

// ── skins : ajouter, mettre à jour, retirer par les actions

test("actions : catalogue → installer et utiliser en un envoi ; dépôt personnel → case « je comprends » obligatoire, message sous le champ ; mise à jour, retour arrière, retrait", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  let r = await actions.installFromCatalogueAction(null, form({ id: "plain-light", activate: "1" }));
  assert.ok(r.ok && !r.error, JSON.stringify(r));
  assert.equal(await getSetting("skin.active"), "plain-light");
  assert.notEqual(await A.readSnapshot(), null);

  await cat.publish("mien", { from: "duo", listed: false });
  const url = `${cat.url}#mien-v1.0.0:skins/mien`;
  r = await actions.installPersonalAction(null, form({ url }));
  assert.ok(r.errors?.understood, "pas de case cochée : refusé, sous le champ");
  assert.equal((await S.installed()).length, 1);
  r = await actions.installPersonalAction(null, form({ url: "http://exemple.org/x/y", understood: "on" }));
  assert.ok(r.errors?.url, "adresse refusée : message sous le champ");
  r = await actions.installPersonalAction(null, form({ url, understood: "on" }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await S.installed()).find((s) => s.id === "mien").source, "personal");
  assert.equal(await getSetting("skin.active"), "plain-light", "installé, pas activé");

  // mise à jour (le catalogue publie 1.1.0) puis retour arrière
  await cat.publish("plain-light", { from: "plain-light", version: "1.1.0" });
  const check = await actions.checkUpdateAction("plain-light");
  assert.deepEqual([check.ok, check.available, check.target], [true, true, "1.1.0"]);
  r = await actions.updateSkinAction(null, form({ id: "plain-light" }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await S.installed()).find((s) => s.id === "plain-light").version, "1.1.0");
  r = await actions.revertSkinAction(null, form({ id: "plain-light" }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await S.installed()).find((s) => s.id === "plain-light").version, "1.0.0");

  // retrait du skin actif : basic le remplace, les retouches restent, le contenu ne change pas
  await setSetting("theme.accent", "#abcdef");
  await setSetting("home.sections", [{ id: "s1" }]);
  r = await actions.removeSkinAction(null, form({ id: "plain-light" }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(await getSetting("skin.active"), "basic");
  assert.equal(await getSetting("theme.accent"), "#abcdef");
  assert.deepEqual(await getSetting("home.sections"), [{ id: "s1" }]);
  assert.equal((await actions.removeSkinAction(null, form({ id: "plain-light" }))).error !== undefined, true);
});

test("actions : un refus de lisibilité ou de règles arrive en mots simples (FR et EN), avec ce qui est refusé ; rien n'est installé", async () => {
  await cat.publish("pale", { from: "faded-grey" });
  const r = await actions.installFromCatalogueAction(null, form({ id: "pale" }));
  assert.ok(r.error, "refusé");
  assert.match(r.error, /lisible|readable/i);
  assert.equal((await S.installed()).length, 0);
  const view = await actions.inspectSkinAction(`${cat.url}#pale-v1.0.0:skins/pale`);
  assert.equal(view.ok, true);
  assert.ok(view.unreadable.length > 0, "la lisibilité est dite SANS installer");
  assert.equal(view.installable, false);
});

test("actions : inspecter un dépôt personnel ne l'installe pas (README, licences, aperçus), plusieurs skins → la liste à choisir", async () => {
  await cat.publish("mien", { from: "duo", listed: false });
  const v = await actions.inspectSkinAction(`${cat.url}#mien-v1.0.0:skins/mien`);
  assert.equal(v.ok, true);
  assert.equal(v.mode, "summary");
  assert.equal(v.origin, "personal");
  assert.equal(v.name.fr, "Duo de test");
  assert.deepEqual(v.modes, ["light", "dark"]);
  assert.ok(v.readme === null || typeof v.readme === "string");
  assert.equal(v.previews.length, 1);
  assert.match(v.previews[0].dataUrl, /^data:image\/webp;base64,/);
  assert.equal((await S.installed()).length, 0, "rien n'a été installé");
  await cat.publish("autre", { from: "plain-light", listed: false });
  const several = await actions.inspectSkinAction(cat.url);
  assert.equal(several.ok, true);
  assert.equal(several.mode, "candidates");
  assert.deepEqual(several.candidates.map((c) => c.id).sort(), ["autre", "mien"]);
  assert.equal((await actions.inspectSkinAction("pas une adresse")).ok, false);
});

test("rôles : un administrateur règle l'apparence mais n'ajoute, ne met à jour ni ne retire un skin (propriétaire seulement, comme les modules)", async () => {
  await install("plain-light", "plain-light");
  await asAdmin("admin");
  assert.ok((await actions.chooseSkinAction(null, form({ id: "plain-light" }))).ok);
  assert.ok((await actions.saveAppearance(null, form({ background: "#121214", accent: "#e8a23b" }))).ok !== undefined);
  for (const call of [
    () => actions.installFromCatalogueAction(null, form({ id: "x" })),
    () => actions.installPersonalAction(null, form({ url: "x", understood: "on" })),
    () => actions.inspectSkinAction("https://github.com/a/b"),
    () => actions.checkUpdateAction("plain-light"),
    () => actions.updateSkinAction(null, form({ id: "plain-light" })),
    () => actions.revertSkinAction(null, form({ id: "plain-light" })),
    () => actions.removeSkinAction(null, form({ id: "plain-light" })),
  ]) await assert.rejects(call);
  assert.equal((await S.installed()).length, 1);
});

test("mise à jour majeure : signalée, refusée sans « Je comprends », acceptée avec ; retour à la version d'avant ensuite", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  assert.equal((await actions.installFromCatalogueAction(null, form({ id: "plain-light" }))).ok !== undefined, true);
  await cat.publish("plain-light", { from: "plain-light", version: "2.0.0" });
  const check = await actions.checkUpdateAction("plain-light");
  assert.deepEqual([check.available, check.target, check.level], [true, "2.0.0", "major"]);
  const refused = await actions.updateSkinAction(null, form({ id: "plain-light" }));
  assert.match(refused.error, /grosse mise à jour|big update/i, "dit en mots simples qu'il faut confirmer");
  assert.equal((await S.installed())[0].version, "1.0.0", "rien n'a changé");
  const ok = await actions.updateSkinAction(null, form({ id: "plain-light", acceptMajor: "on" }));
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal((await S.installed())[0].version, "2.0.0");
  assert.equal((await S.installed())[0].previous.version, "1.0.0");
  assert.ok((await actions.revertSkinAction(null, form({ id: "plain-light" }))).ok);
  assert.equal((await S.installed())[0].version, "1.0.0");
  // une mise à jour dont le skin n'est plus lisible est refusée et laisse tout comme avant
  await cat.publish("plain-light", { from: "faded-grey", version: "2.1.0" });
  const bad = await actions.updateSkinAction(null, form({ id: "plain-light", acceptMajor: "on" }));
  assert.ok(bad.error, JSON.stringify(bad));
  assert.equal((await S.installed())[0].version, "1.0.0");
});

test("messages d'erreur : chaque refus du service des skins a une phrase simple en français ET en anglais (jamais une clé brute)", async () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const src = ["service.ts", "registry.ts", "source.ts", "catalogue.ts"].map((f) => fs.readFileSync(`src/core/skins/${f}`, "utf8")).join("\n") + fs.readFileSync("src/core/skins/appearance.ts", "utf8");
  const codes = new Set([...src.matchAll(/["'](skins\.error\.[A-Za-z]+)["']/g)].map((m) => m[1]));
  assert.ok(codes.size >= 15);
  for (const c of codes) { assert.ok(fr[c] && en[c], c); assert.doesNotMatch(fr[c], /\b(stderr|exception|stack|ENOENT|git)\b/i, `${c} : jargon`); }
  const { failureText } = await import("@/app/admin/(panel)/appearance/actions");
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  const issue = (await S.inspect("pas une adresse")).error;
  assert.ok(issue);
  for (const locale of ["fr", "en"]) {
    const text = await failureText({ error: "skins.error.core", needsCore: "9.9.9" }, makeTranslator(locale), locale);
    assert.ok(!text.includes("skins.error"), text);
  }
  assert.match(await failureText({ error: "skins.error.url" }, makeTranslator("fr"), "fr"), /Exemple : https:\/\/github\.com/);
  assert.match(await failureText({ error: "skins.error.url" }, makeTranslator("en"), "en"), /Example: https:\/\/github\.com/);
});
