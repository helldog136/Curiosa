import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Pages de module en onglets (cœur 0.2.2) : classement automatique, contrat additif du manifeste (`tabs`, `settings[].tab`), onglet initial, `?tab=`,
// onglet vide masqué, erreur dans un onglet caché, clavier, avertissement avant de quitter, enregistrement par onglet, non-régression des droits.
const db = await useTestDb();
const { prisma } = db;
const T = await import("@/core/modules/tabs");
const M = await import("@/components/admin/pageTabsModel");
const { parseManifest } = await import("@/core/modules/manifest");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { instanceSettingKey } = await import("@/core/modules/context");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { FEATURES } = await import("../../testsupport/requirements/manifest.mjs");

after(() => db.close());
const read = (f) => fs.readFileSync(f, "utf8");
const VIEW = "src/app/admin/(panel)/instances/[id]/InstanceView.tsx";
const base = { apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0" };
const parse = (extra) => parseManifest({ ...base, ...extra });
const ids = (tabs) => tabs.map((t) => t.id);

/* ───────────── classement automatique ───────────── */

test("classement : sans rien déclarer, Utiliser · Réglages · Sources · Général, et chaque zone dans son onglet", () => {
  const plan = T.planTabs(undefined);
  assert.deepEqual(ids(plan.order), ["use", "settings", "sources", "general"]);
  for (const a of ["use", "settings", "sources", "general"]) assert.equal(plan.target(a), a);
  assert.equal(T.settingTab(plan, { key: "x" }), "settings", "un réglage va dans Réglages");
  assert.equal(T.settingTab(plan, { key: "x", tab: "general" }), "general");
  assert.equal(plan.target("inconnu"), "settings", "zone inconnue : Réglages (jamais perdue)");
});

test("onglet vide non affiché : connecteur sans panneau → pas d'Utiliser ; module sans consumes → pas de Sources ; un seul onglet possible", () => {
  const plan = T.planTabs(undefined);
  assert.deepEqual(ids(T.visibleTabs(plan, ["settings", "general"])), ["settings", "general"]);
  assert.deepEqual(ids(T.visibleTabs(plan, ["use", "settings", "general"])), ["use", "settings", "general"]);
  assert.deepEqual(ids(T.visibleTabs(plan, ["general"])), ["general"]);
  assert.deepEqual(ids(T.visibleTabs(plan, ["use"])), ["use"], "personne qui n'a que le droit d'ouvrir : seulement Utiliser");
  assert.deepEqual(ids(T.visibleTabs(plan, [])), []);
});

test("ajouter, renommer, retirer : ordre, fusion du contenu d'un onglet retiré (rien n'est perdu)", () => {
  const plan = T.planTabs([{ id: "use", label: { fr: "Fabriquer la vidéo", en: "Make the video" } }, { id: "look", label: { fr: "Apparence", en: "Look" } }, { id: "sources", hidden: true }]);
  assert.deepEqual(ids(plan.order), ["use", "settings", "look", "general"]);
  assert.deepEqual(plan.order[0].label, { fr: "Fabriquer la vidéo", en: "Make the video" });
  assert.equal(plan.target("sources"), "settings", "Sources retiré : son contenu va dans Réglages");
  assert.equal(T.settingTab(plan, { tab: "look" }), "look");
  assert.deepEqual(ids(T.visibleTabs(plan, ["use", "sources", "look", "general"])), ["use", "settings", "look", "general"], "Réglages apparaît pour recevoir les sources");

  const connector = T.planTabs([{ id: "use", hidden: true }]);
  assert.deepEqual(ids(T.visibleTabs(connector, ["use", "settings", "general"])), ["settings", "general"], "connecteur : l'état de connexion rejoint Réglages");
  assert.equal(connector.target("use"), "settings");

  const chain = T.planTabs([{ id: "use", hidden: true }, { id: "settings", hidden: true }, { id: "general", hidden: true }]);
  assert.equal(chain.target("use"), "general", "retraits en chaîne : Utiliser → Réglages → Général");
  assert.ok(ids(chain.order).includes("general"), "Général ne disparaît jamais");
});

test("onglet initial : ?tab= s'il est affiché, sinon l'onglet du réglage à remplir, sinon le premier (panneau, ou Réglages sans panneau)", () => {
  const vis = [{ id: "use" }, { id: "settings" }, { id: "general" }];
  assert.equal(T.initialTab(vis), "use", "le panneau (ce qu'on utilise souvent) d'abord");
  assert.equal(T.initialTab([{ id: "settings" }, { id: "general" }]), "settings", "sans panneau : Réglages");
  assert.equal(T.initialTab(vis, { requested: "general" }), "general", "?tab=general");
  assert.equal(T.initialTab(vis, { requested: "sources" }), "use", "?tab= d'un onglet masqué : ignoré");
  assert.equal(T.initialTab(vis, { requested: "<script>" }), "use");
  assert.equal(T.initialTab(vis, { toFill: "settings" }), "settings", "un réglage à remplir ouvre son onglet");
  assert.equal(T.initialTab(vis, { requested: "general", toFill: "settings" }), "general", "l'adresse l'emporte");
  assert.equal(T.initialTab([]), null);
});

/* ───────────── manifeste : contrat additif, strict et borné ───────────── */

test("manifeste : sans tabs ni tab, inchangé (rétrocompatible) ; tabs et settings[].tab valides acceptés", () => {
  const plain = parse({ settings: [{ key: "a", type: "text", label: "A" }] });
  assert.equal(plain.ok, true);
  assert.equal(plain.manifest.tabs, undefined);
  const r = parse({
    tabs: [{ id: "use", label: { fr: "Ma liste", en: "My list" } }, { id: "look", label: { fr: "Apparence", en: "Look" } }, { id: "sources", hidden: true }],
    settings: [{ key: "a", type: "text", label: "A" }, { key: "c", type: "color", label: "C", tab: "look" }, { key: "g", type: "boolean", label: "G", tab: "general" }],
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.manifest.settings[1].tab, "look");
});

test("manifeste : refus clairs (onglet inconnu, Général retiré ou renommé, onglet ajouté sans nom ou sans réglage, doublon, trop d'onglets, clé inconnue, nom trop long, groupe coupé)", () => {
  const bad = [
    [{ settings: [{ key: "a", type: "text", label: "A", tab: "nowhere" }] }, /unknown tab/],
    [{ settings: [{ key: "a", type: "text", label: "A", tab: "use" }] }, /unknown tab/],
    [{ tabs: [{ id: "general", hidden: true }] }, /general/],
    [{ tabs: [{ id: "general", label: "Autre" }] }, /general/],
    [{ tabs: [{ id: "extra" }], settings: [{ key: "a", type: "text", label: "A", tab: "extra" }] }, /needs a label/],
    [{ tabs: [{ id: "extra", label: "X" }] }, /has no setting/],
    [{ tabs: [{ id: "extra", label: "X", hidden: true }], settings: [{ key: "a", type: "text", label: "A", tab: "extra" }] }, /only a default tab/],
    [{ tabs: [{ id: "use", label: "A" }, { id: "use", label: "B" }] }, /duplicate tab/],
    [{ tabs: [{ id: "use", hidden: true, label: "A" }] }, /hidden tab has no label/],
    [{ tabs: ["t1", "t2", "t3", "t4", "t5"].map((id) => ({ id, label: id })), settings: ["t1", "t2", "t3", "t4", "t5"].map((tab) => ({ key: `k${tab}`, type: "text", label: "K", tab })) }, /at most 4 added tabs/],
    [{ tabs: [{ id: "use", label: "A", color: "red" }] }, /tabs/],
    [{ tabs: [{ id: "use", label: "x".repeat(41) }] }, /tabs/],
    [{ tabs: [{ id: "Use", label: "A" }] }, /tabs/],
    [{ tabs: [{ id: "use", hidden: false }] }, /tabs/],
    [{ tabs: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}x`, label: "x" })) }, /tabs/],
    [{ settings: [{ key: "a", type: "text", label: "A" }, { key: "b", type: "text", label: "B", tab: "general" }], optionalGroups: [{ id: "g", label: "G", addLabel: "+", fields: ["a", "b"] }] }, /same tab/],
    [{ sections: [{ id: "s", label: "S", options: [{ key: "o", type: "text", label: "O", tab: "settings" }] }] }, /only for instance settings/],
  ];
  for (const [extra, re] of bad) {
    const r = parse(extra);
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.match(r.error, re, JSON.stringify(extra));
  }
});

test("kit : utiliser des onglets demande minCore 0.2.2 (compat.minCore) ; tabIssues ne dit rien d'un manifeste sans onglets", () => {
  const f = FEATURES.find((x) => x.since === "0.2.2");
  assert.ok(f);
  assert.equal(f.test({ code: "" }, { tabs: [{ id: "use", hidden: true }] }), true);
  assert.equal(f.test({ code: "" }, { settings: [{ key: "a", tab: "general" }] }), true);
  assert.equal(f.test({ code: "" }, { settings: [{ key: "a" }] }), false);
  assert.deepEqual(T.tabIssues(undefined, [{ key: "a" }]), []);
});

/* ───────────── navigateur : décisions pures de PageTabs ───────────── */

test("clavier (WAI-ARIA) : flèches gauche/droite en boucle, Début, Fin ; autres touches ignorées", () => {
  assert.equal(M.keyTarget("ArrowRight", 0, 4), 1);
  assert.equal(M.keyTarget("ArrowRight", 3, 4), 0, "boucle");
  assert.equal(M.keyTarget("ArrowLeft", 0, 4), 3, "boucle");
  assert.equal(M.keyTarget("Home", 2, 4), 0);
  assert.equal(M.keyTarget("End", 0, 4), 3);
  assert.equal(M.keyTarget("Enter", 0, 4), null);
  assert.equal(M.keyTarget("ArrowRight", 0, 0), null);
});

test("erreur dans un onglet caché : on y bascule (premier onglet nouvellement en erreur) sauf si l'onglet affiché a lui-même une erreur", () => {
  assert.equal(M.errorTabToShow(new Set(), ["general"], "settings"), "general");
  assert.equal(M.errorTabToShow(new Set(), ["settings", "general"], "use"), "settings", "le premier dans l'ordre des onglets");
  assert.equal(M.errorTabToShow(new Set(), ["settings", "general"], "general"), null, "l'onglet affiché a une erreur : on reste");
  assert.equal(M.errorTabToShow(new Set(["general"]), ["general"], "settings"), null, "erreur déjà connue (la personne est partie ailleurs) : on ne la ramène pas de force");
  assert.equal(M.errorTabToShow(new Set(), [], "use"), null);
});

test("?tab= : adresse partageable, autres paramètres gardés, rien à faire si elle y est déjà", () => {
  assert.equal(M.withTab("https://monsite.be/admin/instances/abc", "general"), "/admin/instances/abc?tab=general");
  assert.equal(M.withTab("https://monsite.be/admin/instances/abc?x=1&tab=use#f", "settings"), "/admin/instances/abc?x=1&tab=settings#f");
  assert.equal(M.withTab("https://monsite.be/admin/instances/abc?tab=use", "use"), null);
});

test("avertissement avant de quitter : seulement pour un lien qui change de page, sans touche, avec des modifications non enregistrées", () => {
  const here = "https://monsite.be/admin/instances/abc?tab=settings";
  const link = (href, extra = {}) => ({ href: new URL(href, here).href, rawHref: href, ...extra });
  const click = { button: 0, modifier: false };
  assert.equal(M.leaveNeedsConfirm(link("/admin"), click, here, true), true);
  assert.equal(M.leaveNeedsConfirm(link("/admin"), click, here, false), false, "rien de modifié");
  assert.equal(M.leaveNeedsConfirm(link("/admin", { target: "_blank" }), click, here, true), false, "nouvel onglet");
  assert.equal(M.leaveNeedsConfirm(link("/admin"), { button: 0, modifier: true }, here, true), false, "Ctrl/Cmd-clic");
  assert.equal(M.leaveNeedsConfirm(link("/admin"), { button: 1, modifier: false }, here, true), false, "clic du milieu");
  assert.equal(M.leaveNeedsConfirm(link("#s__key"), click, here, true), false, "ancre de la page (Il reste à renseigner)");
  assert.equal(M.leaveNeedsConfirm(link("/x.csv", { download: true }), click, here, true), false);
  assert.equal(M.leaveNeedsConfirm(link("https://ailleurs.example/"), click, here, true), false, "autre site : géré par le navigateur (beforeunload)");
  assert.equal(M.leaveNeedsConfirm(link("?tab=settings"), click, here, true), false, "même adresse");
  assert.equal(M.leaveNeedsConfirm(link("?page=2"), click, here, true), true, "lien du panneau qui recharge la page");
});

test("PageTabs : motif ARIA complet, ?tab= via l'historique (Retour) et remplacement dans une fenêtre, rangée collée et défilante, garde de sortie", () => {
  const src = read("src/components/admin/PageTabs.tsx");
  for (const re of [/role="tablist"/, /role="tab"/, /role="tabpanel"/, /aria-selected=\{on\}/, /aria-controls=\{`tabpanel-\$\{t\.id\}`\}/, /aria-labelledby=\{`tab-\$\{id\}`\}/, /tabIndex=\{on \? 0 : -1\}/, /focus-visible:outline/, /min-h-11/])
    assert.match(src, re, String(re));
  assert.match(src, /useSearchParams/);
  assert.match(src, /pushState/);
  assert.match(src, /replaceState/);
  assert.match(src, /sticky/);
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /"invalid", onInvalid, true/, "champ refusé par le navigateur dans un onglet caché");
  assert.match(src, /flushSync/, "bascule AVANT que le navigateur cherche à montrer le champ");
  assert.match(src, /form\[data-dirty="1"\]/, "point sur l'onglet modifié");
  assert.match(src, /aria-invalid="true"/, "point rouge sur l'onglet en erreur");
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(src), "l'onglet n'est retenu que par l'adresse");
  assert.match(read("src/components/admin/ActionForm.tsx"), /data-dirty=\{floating && dirty \? "1" : undefined\}/);
  assert.match(read("src/components/admin/ActionForm.tsx"), /beforeunload/, "fermeture / rechargement de l'onglet du navigateur : gardé");
  assert.match(read("src/components/admin/MissingBox.tsx"), /reveal\(input\)/, "« Il reste à renseigner » ouvre l'onglet du champ");
});

/* ───────────── page de l'instance : droits et actions inchangés ───────────── */

test("page de l'instance : droits inchangés (open, administrateurs, propriétaire), zone sensible dans Général, un Enregistrer par onglet", () => {
  const v = read(VIEW);
  assert.match(v, /if \(!can\(user, `\$\{mod\.manifest\.id\}:open`\)\)/, "droit d'ouvrir le module");
  assert.match(v, /const manage = hasRole\(user, "admin"\)/);
  assert.match(v, /if \(manage\) \{\n\s+for \(const f of shownSettings\) filled\.add\(settingArea\(f\)\);/, "Réglages / Sources / Général : administrateurs seulement");
  assert.match(v, /const showSources = manage && advanced/);
  assert.match(v, /\{manage && here\("general"\) && <>\{generalForm\}\{tasksNode\}\{dangerZone\}<\/>\}/, "zone sensible : en bas de Général");
  assert.match(v, /removalScope\(\{ isOwner: can\(user, "core:modules\.install"\)/, "retirer le module : propriétaire");
  assert.match(v, /<input type="hidden" name="__tab" value=\{tab\} \/>/);
  assert.match(v, /history=\{inModal \? "replace" : "push"\}/, "dans la fenêtre d'Extensions, Fermer (retour) ferme bien la fenêtre");
  assert.match(read("src/app/admin/(panel)/extensions/@modal/(..)instances/[id]/page.tsx"), /<InstanceView id=\{id\} query=\{await searchParams\} inModal \/>/);
  const actions = read("src/app/admin/(panel)/instances/actions.ts");
  for (const fn of ["saveInstance", "saveInstanceSettings", "saveSources"]) assert.match(actions, new RegExp(`export async function ${fn}\\(_prev: ActionState, formData: FormData\\): Promise<ActionState> \\{\\n  const \\{ user, t(, config)? \\} = await adminCtx\\("admin"\\);`), fn);
});

/* ───────────── blocs du panneau placés dans un onglet (0.2.5) ───────────── */

test("bloc du panneau : sans tab → Utiliser ; tab connu → son onglet ; tab inconnu → Utiliser ; sans droit d'administrer → tout reste dans Utiliser", () => {
  const plan = T.planTabs([{ id: "look", label: { fr: "Apparence", en: "Look" } }]);
  assert.equal(T.panelTab(plan, {}), "use", "sans tab : comme avant");
  assert.equal(T.panelTab(plan, { tab: "use" }), "use");
  assert.equal(T.panelTab(plan, { tab: "look" }), "look");
  assert.equal(T.panelTab(plan, { tab: "settings" }), "settings");
  assert.equal(T.panelTab(plan, { tab: "general" }), "general");
  assert.equal(T.panelTab(plan, { tab: "nowhere" }), "use", "id inconnu : jamais perdu, Utiliser");
  assert.equal(T.panelTab(plan, { tab: "look" }, false), "use", "une personne qui ne peut qu'ouvrir le module ne perd aucun bloc");
  // Onglet retiré : le bloc suit le contenu de l'onglet retiré.
  const noSources = T.planTabs([{ id: "sources", hidden: true }]);
  assert.equal(T.panelTab(noSources, { tab: "sources" }), "settings");
  // Un onglet qui ne contient QUE des blocs est affiché ; sans bloc, il ne l'est pas.
  const only = T.planTabs([{ id: "help", label: { fr: "Aide", en: "Help" }, panel: true }]);
  assert.deepEqual(ids(T.visibleTabs(only, ["use", "settings", T.panelTab(only, { tab: "help" })])), ["use", "settings", "help"]);
  assert.deepEqual(ids(T.visibleTabs(only, ["use", "settings"])), ["use", "settings"], "onglet vide : pas affiché");
});

test("manifeste : un onglet ajouté peut n'avoir que des blocs (panel: true) ; panel refusé sur un onglet du cœur ; sans panel ni réglage, toujours refusé", () => {
  const ok = parse({ tabs: [{ id: "help", label: { fr: "Aide", en: "Help" }, panel: true }] });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.manifest.tabs[0].panel, true);
  assert.equal(parse({ tabs: [{ id: "use", panel: true }] }).ok, false);
  assert.match(parse({ tabs: [{ id: "use", panel: true }] }).error, /only for an added tab/);
  assert.match(parse({ tabs: [{ id: "help", label: "Aide" }] }).error, /has no setting/);
  assert.equal(parse({ tabs: [{ id: "help", label: "Aide", panel: false }] }).ok, false, "panel: seulement true");
});

test("kit : placer un bloc dans un onglet demande minCore 0.2.5", () => {
  const f = FEATURES.find((x) => x.since === "0.2.5");
  assert.ok(f);
  assert.equal(f.test({ code: 'return [{ type: "markdown", text: "x", tab: "look" }];' }, { tabs: [{ id: "look" }] }), true);
  assert.equal(f.test({ code: "return [{ type: 'banner', text: 'x', tab: 'settings' }];" }, {}), true);
  assert.equal(f.test({ code: "// tab: \"general\"\nreturn [];" }, {}), false, "un commentaire ne compte pas");
  assert.equal(f.test({ code: 'return [{ type: "markdown", text: "x", tab: "autre" }];' }, {}), false, "un onglet inconnu du module n'est pas le nôtre");
  assert.equal(f.test({ code: "" }, { tabs: [{ id: "help", label: "A", panel: true }] }), true);
  assert.equal(f.test({ code: "return [];" }, {}), false);
});

test("page de l'instance : les blocs d'un onglet s'affichent au-dessus de ses réglages, et comptent pour qu'un onglet ne soit pas vide", () => {
  const v = read(VIEW);
  assert.match(v, /for \(const b of panel\) filled\.add\(panelTab\(plan, b, manage\)\)/);
  assert.match(v, /\{panelFor\(tab\)\}\n\s+\{manage && sourcesFirst && here\("sources"\) && sourcesForm\}\n\s+\{manage && settingsForm\(tab\)\}/, "blocs, puis sources/réglages/général");
  assert.match(read("src/core/blocks.ts"), /export type PanelBlock = Block & \{ tab\?: string \}/);
});

/* ───────────── enregistrement par onglet ───────────── */

let inst;
beforeEach(async () => {
  await db.reset();
  globalThis.curiosaTestSession = null;
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  const manifest = {
    ...base, id: "tabbed", main: "index.mjs", minCore: "0.2.0",
    tabs: [{ id: "look", label: { fr: "Apparence", en: "Look" } }],
    settings: [
      { key: "title", type: "text", label: "Titre", optional: true },
      { key: "flag", type: "boolean", label: "Drapeau", default: true },
      { key: "site", type: "url", label: "Adresse", optional: true, tab: "look" },
      { key: "shade", type: "boolean", label: "Ombre", default: false, tab: "look" },
    ],
  };
  assert.equal((await installModule(makeRepo({ "module.json": manifest, "index.mjs": "export default {};" }).url, { dependencies: false })).ok, true);
  await prisma.moduleInstance.deleteMany({ where: { moduleId: "tabbed" } });
  inst = await createInstance(prisma, { manifest: (await R.getModule("tabbed")).manifest, names: { fr: "Onglets" } });
  const admin = await prisma.user.create({ data: { email: "ada@example.org", name: "Ada", role: "admin", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: admin.id, sv: 0 } };
});

const stored = async (key) => (await getSettingByLocale(instanceSettingKey(inst.id, key)))[""];
const form = (fields) => { const fd = new FormData(); fd.set("id", inst.id); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; };

test("enregistrement : un onglet n'écrit que SES réglages (une case d'un autre onglet n'est pas décochée) ; sans __tab, tout comme avant", async () => {
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  assert.ok((await saveInstanceSettings(null, form({ __tab: "look", s__site: "https://monsite.be", s__shade: "on" }))).ok);
  assert.equal(await stored("site"), "https://monsite.be");
  assert.equal(await stored("shade"), true);
  assert.equal(await stored("flag"), undefined, "la case de Réglages n'a pas été touchée (elle n'était pas dans le formulaire envoyé)");

  assert.ok((await saveInstanceSettings(null, form({ __tab: "settings", s__title: "Bonjour" }))).ok);
  assert.equal(await stored("title"), "Bonjour");
  assert.equal(await stored("flag"), false, "Réglages envoyé sans la case : décochée, comme avant");
  assert.equal(await stored("shade"), true, "Apparence gardée");
  assert.equal(await stored("site"), "https://monsite.be");

  assert.ok((await saveInstanceSettings(null, form({ s__title: "Tout" }))).ok, "ancien formulaire unique");
  assert.equal(await stored("shade"), false, "sans __tab : tous les réglages, comme avant");
});

test("erreur de validation : message PAR CHAMP (affiché sous le champ, l'onglet caché s'ouvre), rien n'est écrit", async () => {
  const { saveInstanceSettings, saveInstance } = await import("@/app/admin/(panel)/instances/actions");
  const r = await saveInstanceSettings(null, form({ __tab: "look", s__site: "pas une adresse" }));
  assert.equal(r.ok, undefined);
  assert.ok(r.errors?.s__site, JSON.stringify(r));
  assert.equal(r.error, undefined, "pas de bandeau loin du champ");
  assert.equal(await stored("site"), undefined);
  const g = await saveInstance(null, form({ name_fr: "", placement: "integrations", placement_was: "integrations" }));
  assert.ok(g.errors?.name_fr, "nom vide : sous le champ nom");
});

test("droits : un éditeur ne peut pas enregistrer les réglages (inchangé)", async () => {
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const ed = await prisma.user.create({ data: { email: "ed@example.org", name: "Ed", role: "editor", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: ed.id, sv: 0 } };
  await assert.rejects(() => saveInstanceSettings(null, form({ __tab: "look", s__site: "https://monsite.be" })));
  assert.equal(await stored("site"), undefined);
});
