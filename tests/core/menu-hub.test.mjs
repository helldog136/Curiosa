import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const P = await import("@/core/modules/menuPlacement");
const { getAdminNav } = await import("@/core/modules/adminNav");
const { loadInstanceStatuses } = await import("@/core/modules/integrations");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { moduleSearchText, matchesQuery } = await import("@/core/modules/installedList");
const { isCurrent } = await import("../../src/components/admin/navCurrent.ts");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
const PANEL = "src/app/admin/(panel)";

// ─── Règle par défaut, sur les 21 modules de extras/modules ─────────────────────────────────────────────────────
// Ce que la règle lit de chaque manifeste (type, contenu, nombre d'actions MCP / services offerts / requis). Si le dossier extras/ est présent
// (récupéré par `npm run extras:fetch`), le test vérifie aussi que ce tableau est fidèle aux vrais manifestes.
const EXTRAS = [
  { id: "alerts-overlay", type: "overlay" },
  { id: "blog", content: { display: "cards", clickAction: "detail" } },
  { id: "codes", content: { display: "codes", clickAction: "external" } },
  { id: "collection", content: { display: "cards", clickAction: "detail" } },
  { id: "contact-form", requires: 1 },
  { id: "contacts", type: "utility", mcp: 6, offers: 1 },
  { id: "discord-announcer", type: "utility" },
  { id: "game-suggestions", type: "widget", mcp: 2 },
  { id: "hero" },
  { id: "links", content: { display: "links", clickAction: "external" } },
  { id: "live-status" },
  { id: "maze-overlay", type: "overlay" },
  { id: "pages", content: { display: "list", clickAction: "detail" } },
  { id: "partnerships", type: "utility", mcp: 10 },
  { id: "planning", type: "widget", mcp: 1 },
  { id: "press-kit", type: "widget" },
  { id: "sponsor-ticker", type: "overlay" },
  { id: "sponsors", type: "content", content: { display: "codes", clickAction: "detail" } },
  { id: "ticker-overlay", type: "overlay" },
  { id: "twitch-channel", type: "utility" },
  { id: "youtube-channel", type: "utility" },
];
const asManifest = (e) => ({ type: e.type, content: e.content, mcp: Array(e.mcp ?? 0).fill({}), offers: Array(e.offers ?? 0).fill({}), requires: Array(e.requires ?? 0).fill({}) });
const MENU = ["blog", "codes", "collection", "contact-form", "contacts", "game-suggestions", "pages", "partnerships", "planning", "sponsors"];
const INTEGRATIONS = ["alerts-overlay", "discord-announcer", "hero", "links", "live-status", "maze-overlay", "press-kit", "sponsor-ticker", "ticker-overlay", "twitch-channel", "youtube-channel"];

test("rangement par défaut : les 21 modules d'extras se répartissent en « de travail » (menu) et « réglés une fois » (Intégrations)", () => {
  assert.equal(EXTRAS.length, 21);
  const placed = (family) => EXTRAS.filter((e) => P.defaultPlacement(asManifest(e)) === family).map((e) => e.id).sort();
  assert.deepEqual(placed("menu"), MENU);
  assert.deepEqual(placed("integrations"), INTEGRATIONS);
});

test("rangement par défaut : le tableau ci-dessus correspond aux vrais manifestes quand extras/ est présent", { skip: !fs.existsSync("extras/modules") }, () => {
  const ids = fs.readdirSync("extras/modules").filter((id) => fs.existsSync(`extras/modules/${id}/module.json`)).sort();
  for (const id of ids) {
    const m = JSON.parse(read(`extras/modules/${id}/module.json`));
    const expected = MENU.includes(id) ? "menu" : "integrations";
    assert.equal(P.defaultPlacement(m), expected, `${id} : rangement par défaut`);
  }
  assert.deepEqual(ids, EXTRAS.map((e) => e.id).sort(), "un nouveau module livré doit être ajouté au tableau");
});

test("rangement par défaut : règle déterministe lue dans le manifeste (catégorie, contenu, données gérables)", () => {
  for (const type of ["overlay", "social", "integration"]) assert.equal(P.defaultPlacement({ type, mcp: [{}] }), "integrations", `${type} : réglé une fois, même avec des actions MCP`);
  assert.equal(P.defaultPlacement({ content: { display: "cards", clickAction: "detail" } }), "menu");
  assert.equal(P.defaultPlacement({ content: { display: "links", clickAction: "detail" } }), "menu", "des liens qui s'ouvrent dans le site : on y travaille");
  assert.equal(P.defaultPlacement({ content: { display: "links", clickAction: "external" } }), "integrations", "une liste de liens vers l'extérieur : réseaux, chaînes");
  assert.equal(P.defaultPlacement({ type: "content" }), "menu");
  assert.equal(P.defaultPlacement({}), "integrations", "module tiers sans rien de déclaré : rien à entretenir");
  assert.equal(P.defaultPlacement({ type: "widget", requires: [{}] }), "menu");
  assert.equal(P.defaultPlacement({ type: "utility", offers: [{}] }), "menu");
  assert.equal(P.defaultPlacement({ type: "utility", mcp: [] }), "integrations");
  assert.equal(P.defaultPlacement({ type: "inconnu" }), "integrations");
});

test("épinglage : le choix de l'utilisateur l'emporte dans les deux sens ; une valeur invalide est ignorée", () => {
  const blog = { content: { display: "cards", clickAction: "detail" } };
  const twitch = { type: "utility" };
  assert.equal(P.resolvePlacement(blog, null), "menu");
  assert.equal(P.resolvePlacement(blog, "integrations"), "integrations");
  assert.equal(P.resolvePlacement(twitch, undefined), "integrations");
  assert.equal(P.resolvePlacement(twitch, "menu"), "menu");
  assert.equal(P.resolvePlacement(twitch, "n'importe quoi"), "integrations");
  assert.equal(P.parsePlacement("menu"), "menu");
  assert.equal(P.parsePlacement(42), null);
  assert.equal(P.placementSettingKey("abc"), "instance.abc.__placement", "stocké avec l'instance (réglage du cœur), pas dans le module");
});

// ─── Groupes et ordre ───────────────────────────────────────────────────────────────────────────────────────────
const item = (id, type, over = {}) => ({ id, type, placement: "menu", enabled: true, error: false, badge: 0, content: type === "content", ...over });

test("menu : contenu à part, puis des groupes dans l'ordre fixe ; les groupes vides n'existent pas ; catégorie inconnue → « Autres »", () => {
  const layout = P.buildMenuLayout([
    item("tiers", "zzz"), item("plan", "widget"), item("blog", "content"), item("contacts", "utility"), item("form", "widget"), item("sans-type", undefined),
  ]);
  assert.deepEqual(layout.content.map((i) => i.id), ["blog"]);
  assert.deepEqual(layout.groups.map((g) => g.id), ["utility", "widget", "other"]);
  assert.deepEqual(layout.groups.map((g) => g.items.map((i) => i.id)), [["contacts"], ["plan", "form"], ["tiers", "sans-type"]], "l'ordre d'arrivée est conservé dans un groupe");
  assert.deepEqual(P.buildMenuLayout([item("blog", "content")]).groups, []);
  assert.equal(P.menuGroupOf("social"), "other");
});

test("menu : seules les instances qui tournent y figurent ; Intégrations compte toutes celles qui y sont rangées et cumule leurs pastilles", () => {
  const layout = P.buildMenuLayout([
    item("a", "utility", { enabled: false }), item("b", "utility", { error: true }), item("c", "widget", { badge: 2 }),
    item("t", "utility", { placement: "integrations", badge: 3 }), item("o", "overlay", { placement: "integrations", enabled: false, badge: 9 }), item("e", "utility", { placement: "integrations", error: true, badge: 4 }),
  ]);
  assert.deepEqual(layout.groups.flatMap((g) => g.items.map((i) => i.id)), ["c"], "désactivée ou en erreur : pas dans le menu");
  assert.equal(layout.integrations.count, 3, "la page Intégrations les liste toutes (désactivée et en erreur comprises)");
  assert.equal(layout.integrations.badge, 3, "seule une pastille d'instance qui tourne remonte sur l'entrée");
  assert.equal(P.buildMenuLayout([]).integrations.count, 0);
});

test("menu : la pastille d'un contenu épinglé reste sur son lien (Contacts : 5)", () => {
  const layout = P.buildMenuLayout([item("contacts", "utility", { badge: 5 })]);
  assert.equal(layout.groups[0].items[0].badge, 5);
});

// ─── Plié / déplié ──────────────────────────────────────────────────────────────────────────────────────────────
test("plié mémorisé : cookie lisible côté serveur, valeurs illisibles ignorées, aller-retour fidèle", () => {
  assert.deepEqual(P.parseNavState("utility:1,widget:0"), { utility: true, widget: false });
  assert.deepEqual(P.parseNavState(undefined), {});
  assert.deepEqual(P.parseNavState("x:2,:1,utility:1,<script>:1,other:0"), { utility: true, other: false });
  const state = { utility: false, widget: true };
  assert.deepEqual(P.parseNavState(P.serializeNavState(state)), state);
  assert.equal(P.serializeNavState({ "mauvais id": true, ok: false }), "ok:0");
  assert.equal(P.NAV_STATE_COOKIE, "curiosa_nav_groups");
});

test("plié par défaut : dépliés jusqu'à 6 instances épinglées, repliés au-delà ; le choix mémorisé et la page courante priment", () => {
  assert.equal(P.groupOpenByDefault(0), true);
  assert.equal(P.groupOpenByDefault(6), true);
  assert.equal(P.groupOpenByDefault(7), false);
  assert.equal(P.isGroupOpen("utility", {}, true, false), true);
  assert.equal(P.isGroupOpen("utility", {}, false, false), false);
  assert.equal(P.isGroupOpen("utility", { utility: true }, false, false), true, "dernier choix : déplié");
  assert.equal(P.isGroupOpen("utility", { utility: false }, true, false), false, "dernier choix : plié");
  assert.equal(P.isGroupOpen("utility", { utility: false }, false, true), true, "l'adresse courante déplie toujours son groupe");
});

test("plié mémorisé : le serveur lit le cookie (pas de clignotement) et le groupe suit la page courante", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /parseNavState\(\(await cookies\(\)\)\.get\(NAV_STATE_COOKIE\)\?\.value\)/);
  assert.match(layout, /<NavGroup key=\{g\.id\} id=\{g\.id\}[^]*?stored=\{navState\[g\.id\]\} openByDefault=\{openByDefault\}/);
  assert.match(layout, /groupOpenByDefault\(/);
  const group = read("src/components/admin/NavGroup.tsx");
  assert.match(group, /<details open=\{open\}/, "rendu côté serveur déjà dans le bon état");
  assert.match(group, /isCurrent\(t, path, search\)/, "la page ouverte déplie son groupe");
  assert.match(group, /isGroupOpen\(id,/);
  assert.match(group, /document\.cookie = `\$\{NAV_STATE_COOKIE\}=/);
  assert.match(group, /badge > 0/, "la pastille d'un groupe plié reste visible");
});

// ─── Intégrations : états, recherche, page ──────────────────────────────────────────────────────────────────────
test("états d'une carte : erreur > désactivée > à configurer > active", () => {
  const base = { enabled: true, moduleEnabled: true, error: false, toFill: false };
  assert.equal(P.integrationState(base), "on");
  assert.equal(P.integrationState({ ...base, toFill: true }), "setup");
  assert.equal(P.integrationState({ ...base, enabled: false, toFill: true }), "off");
  assert.equal(P.integrationState({ ...base, moduleEnabled: false }), "off");
  assert.equal(P.integrationState({ ...base, error: true, enabled: false, toFill: true }), "error");
});

test("« à configurer » : un réglage à remplir, vide et sans valeur par défaut, hors groupes facultatifs et textes traduisibles", () => {
  const fields = [{ key: "channel", type: "text" }, { key: "title", type: "text", translatable: true }, { key: "on", type: "boolean" }, { key: "color", type: "text", default: "x" }];
  assert.equal(P.settingsToFill(fields, new Set(), {}), true);
  assert.equal(P.settingsToFill(fields, new Set(), { channel: { "": "machaine" } }), false);
  assert.equal(P.settingsToFill(fields, new Set(["channel"]), {}), false, "un groupe facultatif n'est pas exigé");
  assert.equal(P.settingsToFill(fields, new Set(), { channel: { "": "" } }), true, "une valeur vide ne compte pas");
  assert.equal(P.settingsToFill([], new Set(), {}), false);
});

test("page Intégrations : cherchable avec le même champ que la page Modules, par nom, module, état ou clé", () => {
  const page = read(`${PANEL}/integrations/page.tsx`);
  assert.match(page, /<CatalogueSearch/);
  assert.match(page, /data-catalogue-item data-search=\{c\.search\}/);
  assert.match(page, /data-catalogue-section/);
  assert.match(page, /moduleSearchText\(\[i\.name, moduleName, i\.key/);
  const cards = [
    { name: "Chaîne Twitch", mod: "Twitch channel", state: "setup" },
    { name: "Instagram", mod: "Social links", state: "on" },
    { name: "Annonces Discord", mod: "Discord announcements", state: "off" },
  ].map((c) => ({ ...c, search: moduleSearchText([c.name, c.mod, `integrations.state.${c.state}`]) }));
  const find = (q) => cards.filter((c) => matchesQuery(c.search, q)).map((c) => c.name);
  assert.deepEqual(find("twitch"), ["Chaîne Twitch"]);
  assert.deepEqual(find("CHAINE"), ["Chaîne Twitch"], "sans accents ni majuscules");
  assert.deepEqual(find("social links"), ["Instagram"]);
  assert.deepEqual(find("zzz"), []);
  assert.equal(find("").length, 3);
});

test("page Intégrations : une carte par instance rangée, avec nom, état, réglages, interrupteur et choix d'épinglage", () => {
  const page = read(`${PANEL}/integrations/page.tsx`);
  assert.match(page, /\.filter\(\(i\) => i\.placement === "integrations"\)/);
  assert.match(page, /<InstanceState t=\{t\} state=\{c\.state\}/);
  assert.match(page, /href=\{`\/admin\/instances\/\$\{c\.id\}`\}/, "lien vers les réglages");
  assert.match(page, /toggleInstanceAction\.bind\(null, c\.id, !c\.enabled\)/);
  assert.match(page, /setPlacementAction\.bind\(null, c\.id, "menu"\)/);
  assert.match(page, /adminCtx\("admin"\)/);
  const actions = read(`${PANEL}/integrations/actions.ts`);
  for (const fn of ["setPlacementAction", "toggleInstanceAction"]) assert.match(actions, new RegExp(`export async function ${fn}[^]*?adminCtx\\("admin"\\)`));
  assert.match(actions, /deleteSetting\(placementSettingKey/, "revenir à la règle par défaut efface le choix");
  // la page de réglages d'une instance propose le même choix
  assert.match(read(`${PANEL}/instances/[id]/page.tsx`), /name="placement"/);
  assert.match(read(`${PANEL}/instances/actions.ts`), /placementSettingKey\(id\)/);
});

test("états et épinglage de bout en bout : instances réelles, état par instance, choix mémorisé avec l'instance", async () => {
  await db.fixture("hero");
  await db.fixture("blog");
  const manifest = (id) => FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
  const hero = await createInstance(db.prisma, { manifest: manifest("hero"), names: { en: "Hero" } });
  const blog = await createInstance(db.prisma, { manifest: manifest("blog"), names: { en: "Blog" } });
  const nav = async () => Object.fromEntries((await getAdminNav("en", "en")).map((i) => [i.key, i]));
  let n = await nav();
  assert.equal(n[hero.key].placement, "integrations");
  assert.equal(n[blog.key].placement, "menu");
  assert.equal(n[hero.key].pinned, null);
  assert.equal(n[hero.key].defaultPlacement, "integrations");

  // épingler Hero au menu, ranger le blog : le choix l'emporte sur la règle
  await setSetting(P.placementSettingKey(hero.id), "menu");
  await setSetting(P.placementSettingKey(blog.id), "integrations");
  n = await nav();
  assert.equal(n[hero.key].placement, "menu");
  assert.equal(n[hero.key].pinned, "menu");
  assert.equal(n[blog.key].placement, "integrations");
  assert.equal(n[blog.key].defaultPlacement, "menu");

  // états
  let s = await loadInstanceStatuses();
  assert.equal(s.get(hero.id).state, "setup", "un réglage à remplir manque");
  await setSetting(`instance.${hero.id}.buttonUrl`, "https://example.org");
  s = await loadInstanceStatuses();
  assert.equal(s.get(hero.id).state, "on");
  await db.prisma.moduleInstance.update({ where: { id: hero.id }, data: { enabled: false } });
  assert.equal((await loadInstanceStatuses()).get(hero.id).state, "off");
  await setSetting(`instance.${hero.id}.__dataStatus`, { status: "failed", error: "boom" });
  assert.equal((await loadInstanceStatuses()).get(hero.id).state, "error", "le module signale une erreur (migration de données échouée)");
  assert.equal((await getAdminNav("en", "en")).find((i) => i.key === hero.key).error, true);
  assert.equal(s.get(blog.id).state, "on");
});

// ─── Hub Modules : onglets, anciennes adresses, entrée de menu ──────────────────────────────────────────────────
test("hub Modules : trois onglets (Installés, Catalogue, Mises à jour), l'onglet des mises à jour compte les modules en retard", () => {
  const tabs = read("src/components/admin/FeatureTabs.tsx");
  assert.match(tabs, /updates: "\/admin\/modules\?tab=updates"/);
  assert.match(tabs, /data-testid="tab-badge"/);
  assert.match(tabs, /peekModulesReport\(\)\?\.outdated\.length/, "compteur sans réseau");
  assert.match(tabs, /isOwner \? t\("hub\.tab\.updates"\) : undefined/, "réservé au propriétaire");
  const modules = read(`${PANEL}/modules/page.tsx`);
  assert.match(modules, /tab === "updates" && !isOwner\) redirect\("\/admin\/modules"\)/);
  assert.match(modules, /<ModulesUpdatesSection/);
  assert.match(modules, /instances\.length > 1/, "un module à plusieurs instances se déplie");
  assert.match(modules, /<InstanceState/);
  assert.match(modules, /CatalogueSearch/);
  const section = read("src/components/admin/ModulesUpdatesSection.tsx");
  assert.match(section, /updates\.modules\.all/, "« Tout mettre à jour »");
  assert.match(section, /data-testid="modules-updates"/);
  // la page Mises à jour du site garde le cœur et renvoie vers l'onglet
  const updates = read(`${PANEL}/updates/page.tsx`);
  assert.match(updates, /href="\/admin\/modules\?tab=updates"/);
  assert.ok(!updates.includes("<ModulesUpdates "), "la liste des modules en retard n'est plus dupliquée ici");
  assert.match(updates, /data-testid="update-journey"/);
});

test("anciennes adresses : /admin/catalogue, /admin/catalogue/details, /admin/updates et /admin/modules/[id] existent toujours", () => {
  for (const f of ["catalogue/page.tsx", "catalogue/details/page.tsx", "catalogue/@modal/(.)details/page.tsx", "updates/page.tsx", "modules/[id]/page.tsx", "modules/page.tsx", "integrations/page.tsx"]) assert.ok(fs.existsSync(`${PANEL}/${f}`), f);
  // les anciens liens d'un résultat de recherche de mise à jour redirigent encore vers la page du module
  assert.match(read(`${PANEL}/modules/page.tsx`), /redirect\(`\/admin\/modules\/\$\{encodeURIComponent\(checked\)\}\?/);
  assert.match(read(`${PANEL}/catalogue/page.tsx`), /<FeatureTabs current="add"/);
});

test("entrée de menu « Modules » : active sur le hub (3 onglets), le catalogue, ses fiches et la page d'un module ; « Intégrations » sur ses instances", () => {
  const modules = { href: "/admin/modules", also: ["/admin/catalogue"] };
  const here = (path, search = "") => isCurrent(modules.href, path, search, modules);
  assert.ok(here("/admin/modules"));
  assert.ok(here("/admin/modules", "?tab=updates"));
  assert.ok(here("/admin/modules/blog"));
  assert.ok(here("/admin/catalogue"));
  assert.ok(here("/admin/catalogue/details", "?id=blog"));
  assert.ok(!here("/admin/integrations"));
  assert.ok(!here("/admin/updates"), "la page Mises à jour du site garde sa propre entrée");
  const integrations = { href: "/admin/integrations", also: ["/admin/instances/i-twitch", "/admin/entries?c=links-1"] };
  const inInt = (path, search = "") => isCurrent(integrations.href, path, search, integrations);
  assert.ok(inInt("/admin/integrations"));
  assert.ok(inInt("/admin/instances/i-twitch"));
  assert.ok(inInt("/admin/entries", "?c=links-1"));
  assert.ok(!inInt("/admin/entries", "?c=blog"));
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /href="\/admin\/modules" also=\{\["\/admin\/catalogue"\]\} prominent/);
  assert.match(layout, /href="\/admin\/integrations"/);
  assert.match(layout, /nav\.integrations/);
  assert.match(layout, /badge=\{menu\.integrations\.badge\}/, "la pastille des intégrations remonte sur l'entrée");
});

// ─── i18n ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("i18n : toutes les clés utilisées par le menu, les intégrations et le hub existent en français et en anglais", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  const files = [
    `${PANEL}/layout.tsx`, `${PANEL}/integrations/page.tsx`, `${PANEL}/modules/page.tsx`, `${PANEL}/updates/page.tsx`, `${PANEL}/instances/[id]/page.tsx`,
    "src/components/admin/FeatureTabs.tsx", "src/components/admin/InstanceState.tsx", "src/components/admin/ModulesUpdatesSection.tsx", "src/components/admin/NavGroup.tsx",
  ];
  const keys = new Set();
  for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*(?:advanced \? )?"([a-zA-Z][\w.]*)"/g)) keys.add(m[1]);
  for (const g of P.MENU_GROUPS) keys.add(`navgroup.${g}`);
  for (const s of ["on", "off", "setup", "error"]) keys.add(`integrations.state.${s}`);
  assert.ok(keys.size > 30);
  for (const k of keys) { assert.ok(fr[k], `fr : clé manquante ${k}`); assert.ok(en[k], `en : clé manquante ${k}`); }
  // les clés de thème restent en fin de fichier : les nouvelles sont insérées avant
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    assert.ok(all.indexOf("hub.tab.installed") < all.indexOf("theme.custom"), "nouvelles clés avant les clés de thème");
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
});
