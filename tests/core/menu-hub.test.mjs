import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const P = await import("@/core/modules/menuPlacement");
const X = await import("@/core/modules/extensionsLinks");
const F = await import("@/core/modules/extensionFamilies");
const { getAdminNav } = await import("@/core/modules/adminNav");
const { loadInstanceStatuses } = await import("@/core/modules/integrations");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { moduleSearchText, matchesQuery, buildModuleGroups } = await import("@/core/modules/installedList");
const { isCurrent } = await import("../../src/components/admin/navCurrent.ts");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
const PANEL = "src/app/admin/(panel)";

// ─── Règle par défaut, sur les 21 modules du dépôt curiosa-extras ─────────────────────────────────────────────────────
// Ce que la règle lit de chaque manifeste (type, contenu, nombre d'actions MCP / services offerts / requis). Si EXTRAS_CHECKOUT désigne un clone
// de curiosa-extras (le cœur n'en embarque aucun), le test vérifie aussi que ce tableau est fidèle aux vrais manifestes.
const EXTRAS_CHECKOUT = process.env.EXTRAS_CHECKOUT;
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
const INTEGRATIONS = ["discord-announcer", "hero", "links", "live-status", "press-kit", "twitch-channel", "youtube-channel"];
const OVERLAYS = ["alerts-overlay", "maze-overlay", "sponsor-ticker", "ticker-overlay"];

test("rangement par défaut : les 21 modules d'extras se répartissent en « de travail » (menu), « réglés une fois » (Intégrations) et Overlays (famille à part)", () => {
  assert.equal(EXTRAS.length, 21);
  const placed = (family) => EXTRAS.filter((e) => P.defaultPlacement(asManifest(e)) === family).map((e) => e.id).sort();
  assert.deepEqual(placed("menu"), MENU);
  assert.deepEqual(placed("integrations"), INTEGRATIONS);
  assert.deepEqual(placed("overlays"), OVERLAYS);
});

test("rangement par défaut : le tableau ci-dessus correspond aux vrais manifestes quand EXTRAS_CHECKOUT désigne un clone de curiosa-extras", { skip: !EXTRAS_CHECKOUT || !fs.existsSync(`${EXTRAS_CHECKOUT}/modules`) }, () => {
  const ids = fs.readdirSync(`${EXTRAS_CHECKOUT}/modules`).filter((id) => fs.existsSync(`${EXTRAS_CHECKOUT}/modules/${id}/module.json`)).sort();
  for (const id of ids) {
    const m = JSON.parse(fs.readFileSync(`${EXTRAS_CHECKOUT}/modules/${id}/module.json`, "utf8"));
    const expected = MENU.includes(id) ? "menu" : OVERLAYS.includes(id) ? "overlays" : "integrations";
    assert.equal(P.defaultPlacement(m), expected, `${id} : rangement par défaut`);
  }
  assert.deepEqual(ids, EXTRAS.map((e) => e.id).sort(), "un nouveau module du dépôt doit être ajouté au tableau");
});

test("rangement par défaut : règle déterministe lue dans le manifeste (catégorie, contenu, données gérables)", () => {
  for (const type of ["social", "integration"]) assert.equal(P.defaultPlacement({ type, mcp: [{}] }), "integrations", `${type} : réglé une fois, même avec des actions MCP`);
  assert.equal(P.defaultPlacement({ type: "overlay", mcp: [{}] }), "overlays", "overlay : une famille à part, même avec des actions MCP");
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
  assert.equal(P.isPinned("menu"), true, "épinglée = placement « menu »");
  assert.equal(P.isPinned("integrations") || P.isPinned("overlays"), false, "les autres rangements : seulement dans Extensions");
  assert.deepEqual(P.placementsFor({ type: "overlay" }), ["menu", "overlays"]);
  assert.deepEqual(P.placementsFor({ type: "utility" }), ["menu", "integrations"]);
  assert.equal(P.unpinnedPlacementFor({ type: "overlay" }), "overlays");
  assert.equal(P.unpinnedPlacementFor({ type: "widget" }), "integrations");
  assert.equal(P.placementSettingKey("abc"), "instance.abc.__placement", "stocké avec l'instance (réglage du cœur), pas dans le module");
});

// ─── Rubriques, groupes et ordre ────────────────────────────────────────────────────────────────────────────────
const item = (id, type, over = {}) => ({ id, type, section: P.defaultSection({ type, content: type === "content" ? {} : undefined }), placement: "menu", error: false, badge: 0, content: type === "content", ...over });

test("rubrique par défaut : lue dans le manifeste (contenu → Mon contenu ; le reste → Ma communauté), sans nouveau champ", () => {
  assert.deepEqual(P.MENU_SECTIONS, ["content", "community"]);
  const sections = Object.fromEntries(EXTRAS.map((e) => [e.id, P.defaultSection(asManifest(e))]));
  for (const id of ["blog", "pages", "sponsors", "collection", "codes", "links"]) assert.equal(sections[id], "content", id);
  for (const id of ["contacts", "partnerships", "planning", "contact-form", "game-suggestions", "twitch-channel", "live-status", "hero"]) assert.equal(sections[id], "community", id);
  assert.equal(P.defaultSection({ type: "content" }), "content", "catégorie « content » sans bloc de contenu");
  assert.equal(P.defaultSection({ content: { display: "cards" } }), "content");
  assert.equal(P.defaultSection({}), "community", "module tiers sans rien de déclaré");
  assert.equal(P.defaultSection({ type: "inconnu" }), "community");
});

test("menu : Mon contenu à part, puis Ma communauté en groupes dans l'ordre fixe ; les groupes vides n'existent pas ; catégorie inconnue → « Autres »", () => {
  const layout = P.buildMenuLayout([
    item("tiers", "zzz"), item("plan", "widget"), item("blog", "content"), item("contacts", "utility"), item("form", "widget"), item("sans-type", undefined),
  ]);
  assert.deepEqual(layout.content.map((i) => i.id), ["blog"]);
  assert.deepEqual(layout.community.groups.map((g) => g.id), ["utility", "widget", "other"]);
  assert.deepEqual(layout.community.groups.map((g) => g.items.map((i) => i.id)), [["contacts"], ["plan", "form"], ["tiers", "sans-type"]], "l'ordre d'arrivée est conservé dans un groupe");
  assert.deepEqual(layout.community.items.map((i) => i.id), ["contacts", "plan", "form", "tiers", "sans-type"], "en liste simple, dans l'ordre des groupes");
  assert.deepEqual(P.buildMenuLayout([item("blog", "content")]).community, { items: [], groups: [], collapsible: false });
  assert.equal(P.menuGroupOf("social"), "other");
});

test("menu : Ma communauté passe en groupes pliables au-delà de OPEN_BY_DEFAULT_MAX entrées, jamais avant", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => item(`c${i}`, i % 2 ? "widget" : "utility"));
  assert.equal(P.buildMenuLayout(many(P.OPEN_BY_DEFAULT_MAX)).community.collapsible, false);
  assert.equal(P.buildMenuLayout(many(P.OPEN_BY_DEFAULT_MAX + 1)).community.collapsible, true);
  assert.equal(P.buildMenuLayout([...many(3), ...Array.from({ length: 9 }, (_, i) => item(`b${i}`, "content"))]).community.collapsible, false, "les entrées de Mon contenu ne comptent pas");
});

test("menu : seules les instances épinglées qui tournent y figurent ; les autres ne vivent que dans Extensions et leurs pastilles remontent", () => {
  const layout = P.buildMenuLayout([
    item("b", "utility", { error: true }), item("c", "widget", { badge: 2 }),
    item("t", "utility", { placement: "integrations", badge: 3 }), item("e", "utility", { placement: "integrations", error: true, badge: 4 }),
    item("ov", "overlay", { placement: "overlays", badge: 1 }),
  ]);
  assert.deepEqual(layout.community.items.map((i) => i.id), ["c"], "en erreur ou non épinglée : pas dans le menu");
  assert.equal(layout.unpinnedBadge, 4, "seule une pastille d'instance qui tourne remonte (3 + 1) ; en erreur : non");
  assert.equal(P.buildMenuLayout([]).unpinnedBadge, 0);
  assert.equal(P.buildMenuLayout([item("c", "widget", { badge: 5 })]).unpinnedBadge, 0, "une instance épinglée garde sa pastille sur son propre lien");
});

test("menu : la pastille d'un contenu épinglé reste sur son lien (Contacts : 5)", () => {
  const layout = P.buildMenuLayout([item("contacts", "utility", { badge: 5 })]);
  assert.equal(layout.community.groups[0].items[0].badge, 5);
});

test("pastille d'Extensions : mises à jour de modules + modules à régler + pastilles des modules non épinglés ; le libellé dit « mises à jour » seulement s'il n'y a que cela", () => {
  assert.deepEqual(P.extensionsBadge({ modulesBehind: 0, toSetUp: 0, unpinnedBadge: 0 }), { count: 0, onlyUpdates: false });
  assert.deepEqual(P.extensionsBadge({ modulesBehind: 2, toSetUp: 0, unpinnedBadge: 0 }), { count: 2, onlyUpdates: true });
  assert.deepEqual(P.extensionsBadge({ modulesBehind: 2, toSetUp: 1, unpinnedBadge: 3 }), { count: 6, onlyUpdates: false });
  assert.deepEqual(P.extensionsBadge({ modulesBehind: 0, toSetUp: 1, unpinnedBadge: 0 }), { count: 1, onlyUpdates: false });
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
  assert.match(layout, /menu\.community\.collapsible/, "groupes pliables seulement quand il y a beaucoup d'entrées");
  assert.match(layout, /<NavGroup key=\{g\.id\} id=\{g\.id\}[^]*?stored=\{navState\[g\.id\]\} openByDefault=\{false\}/);
  const group = read("src/components/admin/NavGroup.tsx");
  assert.match(group, /<details open=\{open\}/, "rendu côté serveur déjà dans le bon état");
  assert.match(group, /isCurrent\(t, path, search\)/, "la page ouverte déplie son groupe");
  assert.match(group, /isGroupOpen\(id,/);
  assert.match(group, /document\.cookie = `\$\{NAV_STATE_COOKIE\}=/);
  assert.match(group, /badge > 0/, "la pastille d'un groupe plié reste visible");
});

// ─── Intégrations : états, recherche, page ──────────────────────────────────────────────────────────────────────
test("états d'une carte : erreur > à configurer > en place (jamais « éteint »)", () => {
  const base = { error: false, toFill: false };
  assert.equal(P.integrationState(base), "on");
  assert.equal(P.integrationState({ ...base, toFill: true }), "setup");
  assert.equal(P.integrationState({ error: true, toFill: true }), "error");
});

test("« à configurer » : un réglage à remplir, vide et sans valeur par défaut, hors groupes facultatifs et textes traduisibles", () => {
  const fields = [{ key: "channel", type: "text" }, { key: "title", type: "text", translatable: true }, { key: "on", type: "boolean" }, { key: "color", type: "text", default: "x" }];
  assert.equal(P.settingsToFill(fields, new Set(), {}), true);
  assert.equal(P.settingsToFill(fields, new Set(), { channel: { "": "machaine" } }), false);
  assert.equal(P.settingsToFill(fields, new Set(["channel"]), {}), false, "un groupe facultatif n'est pas exigé");
  assert.equal(P.settingsToFill(fields, new Set(), { channel: { "": "" } }), true, "une valeur vide ne compte pas");
  assert.equal(P.settingsToFill([], new Set(), {}), false);
});

test("Extensions > Installées : cherchable avec le même champ, par nom, famille, état, plateforme ou clé", () => {
  const page = read(`${PANEL}/extensions/page.tsx`);
  assert.match(page, /<CatalogueSearch/);
  assert.match(page, /data-catalogue-section/);
  assert.match(read("src/components/admin/ExtensionCard.tsx"), /data-catalogue-item data-search=\{m\.search\}/);
  assert.match(read(`${PANEL}/extensions/loadInstalled.ts`), /moduleSearchText\(\[modName/);
  const cards = [
    { name: "Chaîne Twitch", mod: "Twitch channel", state: "setup" },
    { name: "Instagram", mod: "Social links", state: "on" },
    { name: "Annonces Discord", mod: "Discord announcements", state: "setup" },
  ].map((c) => ({ ...c, search: moduleSearchText([c.name, c.mod, `integrations.state.${c.state}`]) }));
  const find = (q) => cards.filter((c) => matchesQuery(c.search, q)).map((c) => c.name);
  assert.deepEqual(find("twitch"), ["Chaîne Twitch"]);
  assert.deepEqual(find("CHAINE"), ["Chaîne Twitch"], "sans accents ni majuscules");
  assert.deepEqual(find("social links"), ["Instagram"]);
  assert.deepEqual(find("zzz"), []);
  assert.equal(find("").length, 3);
});

test("Extensions > Installées : une carte par module avec ses instances (nom, état, réglages en fenêtre, épingler au menu, adresse OBS) ; aucun interrupteur ; réservé à ceux qui gèrent", () => {
  const page = read(`${PANEL}/extensions/page.tsx`);
  assert.match(page, /adminCtx\("admin"\)/);
  assert.match(page, /<ExtensionCard /);
  assert.match(page, /<FamilyFilter /);
  assert.match(page, /parseFamily\(query\.family\)/);
  const card = read("src/components/admin/ExtensionCard.tsx");
  assert.match(card, /<InstanceState t=\{t\} state=\{m\.attention\}/, "pastille seulement pour « à configurer » ou « erreur »");
  assert.match(card, /const settingsHref = single \? `\/admin\/instances\/\$\{single\.id\}` : `\/admin\/modules\//, "une seule action visible : Réglages");
  assert.match(card, /<Link href=\{settingsHref\} scroll=\{false\}/, "navigation douce : les réglages s'ouvrent en fenêtre");
  assert.ok(!/toggle(Instance|Module)|turnOn|turnOff|modules\.off|opacity-60/.test(card), "plus d'interrupteur, de pastille « éteint » ni de carte grisée");
  assert.match(card, /const single = m\.instances\.length === 1/, "une seule instance : jamais montrée à part");
  assert.match(card, /<details className="group mt-2[^]*?extensions\.manyItems/, "plusieurs instances : repliées sous la ligne");
  assert.match(card, /<RowMenu /, "les actions rares tiennent dans un menu « ⋯ »");
  assert.match(card, /setPlacementAction\.bind\(null, i\.id, i\.pinned \? i\.unpinTo : "menu"\)/, "épingler / retirer du menu");
  assert.match(card, /<CopyText text=\{url\}/, "l'adresse OBS des overlays est reprise");
  assert.match(card, /data-testid="admin-badge"/, "les pastilles restent visibles");
  assert.ok(!/instanceCountOne|hub\.openModule/.test(card), "plus de « 1 instance » ni « Page du module »");
  const menu = read("src/components/admin/RowMenu.tsx");
  assert.match(menu, /<details/, "natif : clavier et toucher");
  assert.match(menu, /e\.key === "Escape"/);
  assert.match(menu, /aria-label=\{label\}/);
  assert.match(read(`${PANEL}/extensions/loadInstalled.ts`), /overlayUrl\(siteUrl, i\.key\)/);
  const actions = read(`${PANEL}/extensions/actions.ts`);
  for (const fn of ["setPlacementAction"]) assert.match(actions, new RegExp(`export async function ${fn}[^]*?adminCtx\\("admin"\\)`));
  assert.match(actions, /deleteSetting\(placementSettingKey/, "revenir à la règle par défaut efface le choix");
  // la page de réglages d'une instance propose le même choix
  assert.match(read(`${PANEL}/instances/[id]/InstanceView.tsx`), /name="placement"/);
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
  let s = await loadInstanceStatuses("en", "en");
  assert.equal(s.get(hero.id).state, "setup", "un réglage à remplir manque");
  assert.equal(s.get(hero.id).missing.length, 1, "l'état dit lequel manque (son libellé)");
  assert.ok(s.get(hero.id).missing[0].length > 0);
  await setSetting(`instance.${hero.id}.buttonUrl`, "https://example.org");
  s = await loadInstanceStatuses("en", "en");
  assert.equal(s.get(hero.id).state, "on");
  assert.deepEqual(s.get(hero.id).missing, []);
  await setSetting(`instance.${hero.id}.__dataStatus`, { status: "failed", error: "boom" });
  assert.equal((await loadInstanceStatuses("en", "en")).get(hero.id).state, "error", "le module signale une erreur (migration de données échouée)");
  assert.equal((await getAdminNav("en", "en")).find((i) => i.key === hero.key).error, true);
  assert.equal(s.get(blog.id).state, "on");
});

// ─── Extensions : onglets, anciennes adresses, entrée de menu ────────────────────────────────────────────────────
test("Extensions : trois onglets (Installées, Ajouter, Mises à jour), l'onglet des mises à jour compte les modules en retard", () => {
  const tabs = read("src/components/admin/FeatureTabs.tsx");
  assert.match(tabs, /updates: EXTENSIONS_UPDATES_HREF/);
  assert.match(tabs, /data-testid="tab-badge"/);
  assert.match(tabs, /peekModulesReport\(\)\?\.outdated\.length/, "compteur sans réseau");
  assert.match(tabs, /isOwner \? t\("hub\.tab\.updates"\) : undefined/, "réservé au propriétaire");
  const updates = read(`${PANEL}/extensions/updates/page.tsx`);
  assert.match(updates, /!isOwner\(user\)\) redirect\(EXTENSIONS_HREF\)/);
  assert.match(updates, /<ModulesUpdatesSection/);
  assert.match(updates, /href="\/admin\/updates"/, "les mises à jour du cœur gardent leur page");
  assert.match(read(`${PANEL}/extensions/page.tsx`), /current="installed"/);
  const section = read("src/components/admin/ModulesUpdatesSection.tsx");
  assert.match(section, /updates\.modules\.all/, "« Tout mettre à jour »");
  assert.match(section, /data-testid="modules-updates"/);
  // la page Mises à jour du site garde le cœur et renvoie vers l'onglet
  const core = read(`${PANEL}/updates/page.tsx`);
  assert.match(core, /href=\{EXTENSIONS_UPDATES_HREF\}/);
  assert.ok(!core.includes("<ModulesUpdates "), "la liste des modules en retard n'est plus dupliquée ici");
  assert.match(core, /data-testid="update-journey"/);
});

test("anciennes adresses : Modules, Catalogue, Intégrations et Overlays redirigent vers Extensions ; les fiches de module et d'instance existent toujours", () => {
  for (const f of ["modules/page.tsx", "catalogue/page.tsx", "catalogue/details/page.tsx", "integrations/page.tsx", "overlays/page.tsx"]) assert.match(read(`${PANEL}/${f}`), /redirectLegacy\("\/admin\//, f);
  for (const f of ["modules/[id]/page.tsx", "instances/[id]/page.tsx", "updates/page.tsx", "extensions/page.tsx", "extensions/add/page.tsx", "extensions/add/details/page.tsx", "extensions/add/@modal/(.)details/page.tsx", "extensions/updates/page.tsx"]) assert.ok(fs.existsSync(`${PANEL}/${f}`), f);
  assert.match(read(`${PANEL}/extensions/add/page.tsx`), /current="add"/);
  const L = X;
  assert.equal(L.legacyExtensionsTarget("/admin/modules"), "/admin/extensions");
  assert.equal(L.legacyExtensionsTarget("/admin/modules", { tab: "updates" }), "/admin/extensions/updates");
  assert.equal(L.legacyExtensionsTarget("/admin/modules", { error: "modules.error.requires", missing: "a,b", notice: "services" }), "/admin/extensions?error=modules.error.requires&missing=a%2Cb&notice=services", "les messages d'erreur sont conservés");
  assert.equal(L.legacyExtensionsTarget("/admin/modules", { module: "blog", update: "ok", to: "1.2.0" }), "/admin/modules/blog?module=blog&update=ok&to=1.2.0", "ancien retour d'une recherche de mise à jour : la page du module");
  assert.equal(L.legacyExtensionsTarget("/admin/catalogue"), "/admin/extensions/add");
  assert.equal(L.legacyExtensionsTarget("/admin/catalogue", { error: "modules.error.clone" }), "/admin/extensions/add?error=modules.error.clone");
  assert.equal(L.legacyExtensionsTarget("/admin/catalogue/details", { id: "blog" }), "/admin/extensions/add/details?id=blog");
  assert.equal(L.legacyExtensionsTarget("/admin/catalogue/details", { repo: "https://example.org/x/y" }), "/admin/extensions/add/details?repo=https%3A%2F%2Fexample.org%2Fx%2Fy");
  assert.equal(L.legacyExtensionsTarget("/admin/integrations"), "/admin/extensions?family=connections");
  assert.equal(L.legacyExtensionsTarget("/admin/overlays/"), "/admin/extensions?family=overlays");
  assert.equal(L.legacyExtensionsTarget("/admin/modules/blog"), null, "la page d'un module ne bouge pas");
  assert.equal(L.legacyExtensionsTarget("/admin/instances/abc"), null);
  assert.equal(L.legacyExtensionsTarget("/admin/users"), null);
});

test("entrée de menu « Extensions » : active sur ses trois onglets, le catalogue, la page d'un module et les réglages d'une instance non épinglée", () => {
  const ext = { href: "/admin/extensions", also: ["/admin/modules", "/admin/instances/i-twitch", "/admin/entries?c=links-1"] };
  const here = (path, search = "") => isCurrent(ext.href, path, search, ext);
  assert.ok(here("/admin/extensions"));
  assert.ok(here("/admin/extensions", "?family=overlays"));
  assert.ok(here("/admin/extensions/add"));
  assert.ok(here("/admin/extensions/add/details", "?id=blog"));
  assert.ok(here("/admin/extensions/updates"));
  assert.ok(here("/admin/modules/blog"));
  assert.ok(here("/admin/instances/i-twitch"));
  assert.ok(here("/admin/entries", "?c=links-1"));
  assert.ok(!here("/admin/entries", "?c=blog"));
  assert.ok(!here("/admin/updates"), "la page Mises à jour du site garde sa propre entrée");
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /href=\{EXTENSIONS_HREF\} also=\{\["\/admin\/modules", \.\.\.unpinnedPages\]\}/);
  assert.ok(!/prominent/.test(layout) && !/prominent/.test(read("src/components/admin/NavLink.tsx")), "plus d'entrée en surbrillance");
  assert.ok(!layout.includes("nav.integrations") && !layout.includes("nav.overlays") && !layout.includes("/admin/integrations") && !layout.includes("/admin/overlays"), "Intégrations et Overlays ont disparu du menu");
  assert.match(layout, /extensionsBadge\(\{ modulesBehind, toSetUp, unpinnedBadge: menu\.unpinnedBadge \}\)/, "les pastilles remontent sur Extensions");
  assert.match(layout, /badge=\{extensions\.count\}/);
});

test("menu : l'ordre des rubriques et des entrées d'Administration", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  const order = ["nav.dashboard", "nav.myContent", "nav.myCommunity", "nav.mySite", "nav.admin", "nav.account"].map((k) => layout.indexOf(`"${k}"`));
  assert.ok(order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1])), "Tableau de bord, Mon contenu, Ma communauté, Mon site, Administration, Compte");
  // Les entrées viennent de administrationEntries (adminMenu.ts) ; le layout les range dans cet ordre.
  const links = layout.slice(layout.indexOf("const adminLinks"), layout.indexOf("const group ="));
  const entries = ["nav.extensions", "nav.assistants", "nav.users", "nav.backup", "nav.updates", "nav.audit"].map((k) => links.indexOf(`"${k}"`));
  assert.ok(entries.every((n, i) => n > -1 && (i === 0 || n > entries[i - 1])), "Extensions, Assistants IA (une seule entrée), Utilisateurs, Sauvegarde, Mises à jour, Journal d'audit");
  assert.ok(!layout.includes("nav.mcp") && !layout.includes("nav.maintenanceAi") && !layout.includes("/admin/mcp") && !layout.includes("/admin/maintenance-ia"), "les deux anciennes entrées ont disparu");
  const site = layout.slice(layout.indexOf('t("nav.mySite")'), layout.indexOf('t("nav.admin")'));
  for (const href of ["/admin/home", "/admin/navigation", "/admin/settings", "/admin/social", "/admin/ai-visibility", "/admin/redirects"]) assert.ok(site.includes(`href="${href}"`), href);
});

test("menu Administration : Assistants IA est UNE entrée, visible du propriétaire en mode simple ET avancé ; le journal d'audit reste avancé", async () => {
  const { administrationEntries } = await import("@/core/modules/adminMenu");
  assert.deepEqual(administrationEntries({ role: "owner", advanced: false }), ["extensions", "assistants", "users", "backup", "updates"], "mode simple : Assistants IA y est, pas le journal");
  assert.deepEqual(administrationEntries({ role: "owner", advanced: true }), ["extensions", "assistants", "users", "backup", "updates", "audit"]);
  for (const advanced of [false, true]) {
    assert.deepEqual(administrationEntries({ role: "admin", advanced }), ["extensions", "users"], "un administrateur gère les extensions et les utilisateurs, pas les assistants");
    assert.deepEqual(administrationEntries({ role: "editor", advanced }), [], "un éditeur n'a pas de rubrique Administration");
    assert.equal(administrationEntries({ role: "owner", advanced }).filter((e) => e === "assistants").length, 1, "jamais deux entrées d'assistants");
  }
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /administrationEntries\(\{ role: user\.level, advanced \}\)/);
  assert.match(layout, /<NavLink key="assistants" href=\{ASSISTANTS_HREF\} badge=\{aiWaiting\} badgeLabel=\{t\("nav\.badge\.ai"\)\}>\{t\("nav\.assistants"\)\}<\/NavLink>/, "la pastille = demandes d'IA en attente");
  assert.match(layout, /\{adminEntries\.length > 0 && \(/, "la rubrique disparaît quand elle est vide");
});

test("menu : la page Assistants IA et celle d'un accès restent surlignées dans le menu (sous-pages)", () => {
  assert.ok(isCurrent("/admin/assistants", "/admin/assistants", new URLSearchParams("tab=requests")));
  assert.ok(isCurrent("/admin/assistants", "/admin/assistants/abc123", null));
  assert.ok(!isCurrent("/admin/assistants", "/admin/audit", null));
});

// ─── Familles d'Extensions ──────────────────────────────────────────────────────────────────────────────────────
test("familles d'Extensions : Contenu, Communauté, Réseaux et connexions, Overlays — règle lue dans le manifeste, sur les 21 modules d'extras", () => {
  assert.deepEqual(F.EXTENSION_FAMILIES, ["content", "community", "connections", "overlays"]);
  const fam = (e) => F.extensionFamily({ ...asManifest(e), ...(e.platform ? { platform: e.platform } : {}) });
  const byId = Object.fromEntries(EXTRAS.map((e) => [e.id, fam(e)]));
  for (const id of ["alerts-overlay", "maze-overlay", "sponsor-ticker", "ticker-overlay"]) assert.equal(byId[id], "overlays", id);
  for (const id of ["blog", "pages", "sponsors", "collection", "codes"]) assert.equal(byId[id], "content", id);
  assert.equal(byId.links, "connections", "une liste de liens vers l'extérieur : vos réseaux");
  for (const id of ["contacts", "partnerships", "planning", "contact-form", "game-suggestions", "hero"]) assert.equal(byId[id], "community", id);
  assert.equal(F.extensionFamily({ type: "social" }), "connections");
  assert.equal(F.extensionFamily({ type: "integration", mcp: [{}] }), "connections");
  assert.equal(F.extensionFamily({ type: "utility", platform: "twitch" }), "connections", "une plateforme déclarée : réseaux et connexions");
  assert.equal(F.extensionFamily({ type: "utility", platform: "Mal Formé" }), "community", "plateforme illisible : ignorée");
  assert.equal(F.extensionFamily({ permissions: ["overlay"] }), "overlays");
  assert.equal(F.extensionFamily({}), "community");
  assert.equal(F.parseFamily("overlays"), "overlays");
  assert.equal(F.parseFamily("n'importe quoi"), null);
});

test("familles d'Extensions : ce qui demande de l'attention passe d'abord (erreur, à configurer, en place)", () => {
  assert.equal(F.worstState(["on", "setup"]), "setup");
  assert.equal(F.worstState(["on", "error", "setup"]), "error");
  assert.equal(F.worstState([]), "on", "rien à signaler");
  const groups = buildModuleGroups([
    { id: "a", name: "Alpha", type: "widget", family: "community", search: "" }, { id: "b", name: "Blog", type: "content", family: "content", search: "" },
    { id: "c", name: "Chaîne", type: "utility", family: "connections", search: "" }, { id: "x", name: "X", type: "broken", family: "broken", search: "" },
  ], F.EXTENSION_FAMILIES, "", (m) => m.family);
  assert.deepEqual(groups.map((g) => g.type), ["content", "community", "connections", "broken"], "familles dans l'ordre, modules illisibles en dernier");
});

// ─── i18n ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("i18n : toutes les clés utilisées par le menu, Extensions et ses onglets existent en français et en anglais", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  const files = [
    `${PANEL}/layout.tsx`, `${PANEL}/extensions/page.tsx`, `${PANEL}/extensions/updates/page.tsx`, `${PANEL}/updates/page.tsx`, `${PANEL}/instances/[id]/InstanceView.tsx`,
    "src/components/admin/FeatureTabs.tsx", "src/components/admin/InstanceState.tsx", "src/components/admin/ModulesUpdatesSection.tsx", "src/components/admin/NavGroup.tsx",
    "src/components/admin/ExtensionCard.tsx", "src/components/admin/ExtensionsHeader.tsx", "src/components/admin/ExtensionsNotices.tsx", "src/components/admin/FamilyFilter.tsx",
  ];
  const keys = new Set();
  for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*(?:advanced \? )?"([a-zA-Z][\w.]*)"/g)) keys.add(m[1]);
  for (const g of P.MENU_GROUPS) keys.add(`navgroup.${g}`);
  for (const s of ["on", "setup", "error"]) keys.add(`integrations.state.${s}`);
  for (const f of F.EXTENSION_FAMILIES) { keys.add(`family.${f}`); keys.add(`family.${f}.help`); }
  assert.ok(keys.size > 30);
  for (const k of keys) { assert.ok(fr[k], `fr : clé manquante ${k}`); assert.ok(en[k], `en : clé manquante ${k}`); }
  // les clés de thème restent en fin de fichier : les nouvelles sont insérées avant
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    assert.ok(all.indexOf("hub.tab.installed") < all.indexOf("theme.custom"), "nouvelles clés avant les clés de thème");
    assert.ok(all.indexOf("nav.extensions") < all.indexOf("theme.custom"));
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
});

test("mode simple : pas de jargon dans les textes d'Extensions (ni « instance », ni « manifeste »)", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  for (const k of ["extensions.introSimple", "hub.tab.installed.simple", "hub.tab.catalogue.simple", "extensions.manyItems", "extensions.menu", "nav.myCommunity", "nav.extensions", "placement.pin", "placement.unpin", "placement.park", "family.content.help", "family.community.help", "family.connections.help", "family.overlays.help"]) {
    assert.ok(!/instance|manifest|manifeste/i.test(fr[k]), `fr ${k}`);
    assert.ok(!/instance|manifest/i.test(en[k]), `en ${k}`);
  }
});
