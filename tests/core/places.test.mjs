// PLACES (core 0.31.0): grammar, statuses, vocabulary, manifest contract, merge rules, menus of the four live sites, upgrade from the module versions they
// really run, threat model (spoofing, flooding, order hijacking, trapped links), R12 at runtime, anchors, isolation of a failing section, no module named in the core.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const P = await import("@/core/modules/places");
const { parseManifest } = await import("@/core/modules/manifest");
const { parseMenuPath } = await import("@/core/modules/menuPath");
const { withBudget } = await import("@/core/modules/placesLoad");

const read = (p) => fs.readFileSync(p, "utf8");
const FIX = "tests/fixtures/places";
const catalogueVocab = P.sanitizeVocabulary(JSON.parse(read(`${FIX}/vocabulary.json`)));
const VOCAB = P.mergeVocabulary(P.BUILTIN_VOCABULARY, catalogueVocab);
const MAPPING = JSON.parse(read(`${FIX}/mapping.json`));
const SITES = JSON.parse(read(`${FIX}/sites.json`));
const INSTALLED = JSON.parse(read(`${FIX}/installed.json`));
const demo = (id) => { const r = parseManifest(JSON.parse(read(`${FIX}/modules/${id}/module.json`))); assert.ok(r.ok, r.error); return r.manifest; };

/** A minimal manifest with the given places (settings and tabs as needed). */
const man = (extra = {}) => ({ id: "etoile", settings: [{ key: "a" }, { key: "b" }, { key: "c", tab: "general" }], ...extra });
/** Contributions as the loader makes them. */
const contrib = (moduleId, sections, opts = {}) => sections.map((section) => ({
  instanceId: `${opts.key ?? moduleId}-id`, instanceKey: opts.key ?? moduleId, moduleId, moduleName: opts.name ?? moduleId, instanceLabel: opts.label ?? opts.name ?? moduleId,
  siblings: !!opts.siblings, connector: !!opts.connector, section, visible: opts.visible ?? true,
}));
const sec = (id, place, extra = {}) => ({ id, declared: place, place: P.parsePlace(place), order: 500, level: "basic", seeAlso: [], settings: [], panelTabs: ["use"], blocks: false, advancedOnly: false, ...extra });

/* ───────────── grammar and statuses ───────────── */

test("grammar: group.page[.tab], ASCII, lower case, no spelling tolerance", () => {
  assert.deepEqual(P.parsePlace("live.alerts.look"), { group: "live", page: "alerts", tab: "look" });
  assert.deepEqual(P.parsePlace("community.daily-game"), { group: "community", page: "daily-game", tab: null });
  for (const bad of ["live", "live.alerts.look.more", "Live.alerts", "réseaux.twitch", "live..alerts", "live.a", "live.alerts-", "live.al--erts", "live.1alerts", " live.alerts", "live.alerts/look", "x".repeat(30) + ".page", 42, null]) {
    assert.equal(P.parsePlace(bad), null, `refused: ${String(bad)}`);
  }
  assert.equal(P.parsePlace(`${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`), null, "64 characters at most");
});

test("reserved groups and admin addresses are refused for modules; the core's own groups keep their status", () => {
  for (const g of ["admin", "account", "administration", "compte", "access", "system", "core", "security", "settings", "extensions", "dashboard"]) {
    assert.ok(P.placeIssues(man({ place: `${g}.page` })).some((m) => /belongs to the core/.test(m)), g);
  }
  for (const g of ["entries", "instances", "appearance", "users", "mcp", "overlay-pages"]) assert.ok(P.placeIssues(man({ place: `${g}.page` })).some((m) => /admin address|belongs to the core/.test(m)), g);
  assert.equal(P.groupStatus("site", VOCAB), "additive");
  assert.equal(P.groupStatus("admin", VOCAB), "reserved");
  assert.equal(P.groupStatus("live", VOCAB), "open");
});

test("the admin route list is in sync with src/app/admin, and no open group of the vocabulary hides a core address", () => {
  const dirs = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { if (/^\(.*\)$/.test(e.name)) walk(path.join(d, e.name)); else if (!e.name.startsWith("[") && !e.name.startsWith("@")) dirs.add(e.name); } };
  walk("src/app/admin");
  assert.deepEqual([...dirs].sort(), [...P.ADMIN_ROUTE_SEGMENTS].sort(), "ADMIN_ROUTE_SEGMENTS lists exactly the first segments of /admin");
  for (const g of VOCAB.groups) if (g.status !== "reserved") assert.ok(!P.ADMIN_ROUTE_SEGMENTS.includes(g.id), g.id);
});

/* ───────────── vocabulary and aliases ───────────── */

test("the catalogue vocabulary is read defensively: no address, no reserved group, no page added to a core group", () => {
  const v = P.sanitizeVocabulary({
    groups: [{ id: "shop", en: "Shop", fr: "Boutique" }, { id: "admin", en: "Admin", fr: "Admin" }, { id: "entries", en: "E", fr: "E" }, { id: "Bad", en: "x", fr: "y" }, { id: "nofr", en: "x" }],
    pages: [{ id: "shop.orders", en: "Orders", fr: "Commandes", href: "https://evil.example", intro: { en: "Your orders.", fr: "Vos commandes." } }, { id: "site.evil", en: "Evil", fr: "Mal" }, { id: "x.y.z", en: "a", fr: "b" }, { id: "live.<b>", en: "a", fr: "b" }],
    aliases: { "live.old": "live.alerts", "bad id": "live.alerts", "live.self": "live.self" },
  });
  assert.deepEqual(v.groups.map((g) => [g.id, g.status]), [["shop", "open"]]);
  assert.equal(v.pages.find((p) => p.id === "shop.orders").href, undefined, "an address is never read from the catalogue");
  const merged = P.mergeVocabulary(P.BUILTIN_VOCABULARY, v);
  assert.ok(!merged.pages.some((p) => p.id === "site.evil"), "the catalogue cannot add pages to an additive core group");
  assert.deepEqual(merged.aliases, { "live.old": "live.alerts" });
});

test("aliases: a renamed page keeps working (tab kept), loops stop, and an id is never reused for another meaning", () => {
  const aliases = { "live.old": "live.alerts", "live.a1": "live.a2", "live.a2": "live.a1", "live.moved.tab": "live.rewards.home" };
  assert.deepEqual(P.resolveAlias(P.parsePlace("live.old.look"), aliases), { place: { group: "live", page: "alerts", tab: "look" }, aliased: true });
  assert.deepEqual(P.resolveAlias(P.parsePlace("live.moved.tab"), aliases).place, { group: "live", page: "rewards", tab: "home" });
  assert.ok(P.resolveAlias(P.parsePlace("live.a1"), aliases).aliased, "a loop ends after 3 steps");
  const reused = P.mergeVocabulary(P.BUILTIN_VOCABULARY, { ...catalogueVocab, aliases: { "live.alerts": "live.rewards" } });
  assert.deepEqual(reused.aliases, {}, "an alias whose old id is still a live page is dropped");
  // A module declaring an aliased place lands on the new one.
  const s = P.moduleSections(man({ place: "live.old" }), aliases);
  assert.equal(P.placeId(s[0].place), "live.alerts");
});

test("vocabulary fixture (draft of catalogue/places.json): EN+FR parity, an intro per page, at most 5 tabs or a written reason", () => {
  for (const p of catalogueVocab.pages) {
    assert.ok(p.intro?.en && p.intro?.fr, `${p.id} has an intro in both languages (R1)`);
    assert.ok((p.tabs ?? []).length <= P.TABS_SOFT_MAX || p.tabsReason, `${p.id}: ${p.tabs?.length} tabs`);
  }
  for (const p of P.BUILTIN_VOCABULARY.pages) assert.ok(p.href?.startsWith("/admin"), `${p.id} is a core page with its own address`);
});

/* ───────────── manifest contract ───────────── */

test("short and full forms: settings claimed once, sources and general never placed, fromTab takes a tab's panel", () => {
  const m = man({ place: "community.games", tabs: [{ id: "covers", label: { en: "Covers", fr: "Jaquettes" }, place: "community.games.covers" }], settings: [{ key: "a" }, { key: "b", tab: "covers" }, { key: "c", tab: "general" }, { key: "d", tab: "sources" }] });
  const s = P.moduleSections(m);
  assert.deepEqual(s.map((x) => [x.id, P.placeId(x.place), x.settings, x.panelTabs]), [["covers", "community.games.covers", ["b"], ["covers"]], ["main", "community.games", ["a"], ["use", "settings"]]]);
  const full = P.moduleSections(man({ places: [{ id: "x", place: "live.alerts", settings: ["a", "c"] }, { id: "y", place: "live.alerts.look", settings: ["a", "b"] }] }));
  assert.deepEqual(full.map((x) => x.settings), [["a"], ["b"]], "general settings are never placed; a setting is claimed once");
});

test("manifest: valid declarations parse; the fixture modules are valid", () => {
  for (const id of ["places-demo-alerts", "places-demo-bot"]) assert.ok(demo(id));
  assert.deepEqual(P.placeIssues(man({ places: [{ id: "look", place: "live.alerts.look", order: 120, level: "advanced", title: { en: "On screen", fr: "À l'écran" }, summary: { en: "What shows", fr: "Ce qui s'affiche" }, seeAlso: ["live.rewards"], settings: ["a"] }] })), []);
  assert.deepEqual(P.placeIssues(man({ place: "site.home.banners" })), [], "a module may add a section to a listed tab of a core page");
});

test("threat model: spoofing core pages and other modules", () => {
  const issues = (d) => P.placeIssues(man({ places: [{ id: "x", place: "shop.orders", ...d }] }));
  assert.ok(issues({ define: { group: { title: { en: "Account security", fr: "Sécurité du compte" } } } }).some((m) => /kept for the core/.test(m)), "words of the core's own pages");
  assert.ok(issues({ define: { group: { title: { en: "Re-enter your password", fr: "Saisir le mot de passe" } } } }).some((m) => /kept for the core/.test(m)));
  assert.ok(issues({ define: { group: { title: { en: "Accounts and connections", fr: "Comptes et connexions" } } } }).some((m) => /reads like a title/.test(m)), "confusable with a vocabulary title");
  assert.ok(issues({ define: { page: { title: { en: "Overlay pages", fr: "Pages d’overlay" } } } }).some((m) => /reads like a title/.test(m)), "confusable after NFKC, accents and punctuation");
  assert.ok(issues({ title: { en: "Shop settings", fr: "Réglages boutique" } }).some((m) => /repeats a word/.test(m)), "no redundant word in titles");
  assert.ok(issues({ title: { en: "Only English" } }).some((m) => /both "en" and "fr"/.test(m)), "EN+FR both present (R29)");
  assert.ok(P.placeIssues(man({ places: [{ id: "x", place: "site.home", define: { page: { title: { en: "Home", fr: "Accueil" } } } }] })).some((m) => /not allowed on a core page/.test(m)));
  assert.ok(P.placeIssues(man({ place: "site.home.newtab" })).some((m) => /cannot add a tab to a core page/.test(m)));
  assert.ok(P.placeIssues(man({ place: "site.newpage" })).some((m) => /not a page of the core/.test(m)));
  // At runtime too: a refused inline title falls back to a derived one; a section titled like another contributing module shows its own module's name.
  const idx = P.buildPlaceIndex([
    ...contrib("etoile", [sec("x", "shop.orders", { define: { group: { title: { en: "Account security", fr: "Sécurité du compte" } }, page: { title: { en: "Accounts and connections", fr: "Comptes et connexions" } } } })]),
    ...contrib("lune", [sec("y", "live.alerts", { title: { en: "Demo alerts", fr: "Alertes de démo" } })], { name: "Lune" }),
    ...contrib("alerts", [sec("z", "live.alerts")], { name: "Demo alerts" }),
  ], VOCAB, "en");
  assert.equal(idx.groups.find((g) => g.id === "shop").title, "Shop");
  assert.equal(idx.groups.find((g) => g.id === "shop").pages[0].title, "Orders");
  assert.ok(P.findPage(idx, "live", "alerts").tabs[0].sections.some((s) => s.moduleId === "lune" && s.title === "Lune"), "no impersonation of another contributor");
});

test("threat model: flooding, order hijacking, trapped links, rights escalation by place", () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, place: `live.p${String(i).padStart(2, "0")}` }));
  assert.ok(P.placeIssues(man({ places: many })).some((m) => /at most 12 sections/.test(m)));
  // Since 0.34.0 the per-page limit is a guideline: not a refusal (see places-034.test.mjs).
  assert.ok(!P.placeIssues(man({ places: [1, 2, 3, 4].map((i) => ({ id: `s${i}x`, place: `live.alerts.t${i}x` })) })).some((m) => /sections on one page/.test(m)));
  assert.ok(P.placeIssues(man({ places: [{ id: "aa", place: "shop.orders" }, { id: "bb", place: "games2.orders" }] })).some((m) => /at most 1 new group/.test(m)));
  for (const order of [0, 50, 99, 1000, 12.5]) assert.ok(P.placeIssues(man({ places: [{ id: "aa", place: "site.general.identity", order }] })).some((m) => /order must be/.test(m)), `order ${order}`);
  for (const link of ["https://evil.example/reconnect", "/admin/users", "javascript:alert(1)", "live.alerts.look"]) assert.ok(P.placeIssues(man({ places: [{ id: "aa", place: "live.rewards", seeAlso: [link] }] })).some((m) => /seeAlso/.test(m)), link);
  // Unknown groups beyond two fold under "Other settings"; reserved places are dropped even if a manifest got through.
  const idx = P.buildPlaceIndex([
    ...contrib("m1", [sec("a1", "zeta.p1")]), ...contrib("m2", [sec("a2", "beta.p1")]), ...contrib("m3", [sec("a3", "alpha.p1")]), ...contrib("m4", [sec("a4", "admin.users")]),
  ], VOCAB, "fr");
  assert.deepEqual(idx.groups.map((g) => [g.id, g.title]), [["alpha", "Alpha"], ["beta", "Beta"], ["other", "Autres réglages"]]);
  assert.ok(idx.warnings.some((w) => /zeta/.test(w)));
  // Tabs: more than 5 warns (soft guideline, owner decision E15), more than 8 join the first tab.
  const tabs = (n) => P.buildPlaceIndex(contrib("m", Array.from({ length: n }, (_, i) => sec(`t${i}x`, `shop.page.t${i}x`, { order: 100 + i }))), VOCAB, "en");
  assert.equal(tabs(5).warnings.filter((w) => !/ adds \d+ sections/.test(w)).length, 0, "5 tabs: no tab warning (the section guideline is tested in places-034)");
  assert.ok(tabs(6).warnings.some((w) => /6 tabs/.test(w)));
  assert.equal(P.findPage(tabs(6), "shop", "page").tabs.length, 6, "a soft guideline: the sixth tab still shows");
  const ten = P.findPage(tabs(10), "shop", "page");
  assert.equal(ten.tabs.length, 8);
  assert.equal(ten.tabs[0].sections.length, 3, "tabs 9 and 10 join the first tab");
});

/* ───────────── merge: the pilot (two modules on Live) ───────────── */

test("pilot: two modules aggregate on Live › Alerts, Rewards and Chat, in order, with vocabulary titles", () => {
  const a = demo("places-demo-alerts"), b = demo("places-demo-bot");
  const contribs = [...contrib("places-demo-alerts", P.moduleSections(a), { name: "Alertes de démo" }), ...contrib("places-demo-bot", P.moduleSections(b), { name: "Bot de démo" })];
  const idx = P.buildPlaceIndex(contribs, VOCAB, "fr");
  const live = idx.groups.find((g) => g.id === "live");
  assert.equal(live.title, "En direct");
  assert.deepEqual(live.pages.map((p) => p.title), ["Alertes", "Récompenses", "Chat"], "vocabulary order");
  const alerts = P.findPage(idx, "live", "alerts");
  assert.equal(alerts.intro, "Ce qui s'affiche à l'écran quand il se passe quelque chose.");
  assert.deepEqual(alerts.tabs.map((t) => t.title), ["Apparence", "Règles"]);
  assert.deepEqual(alerts.tabs[1].sections.map((s) => s.section.id), ["rules", "journal"], "order 500 before 600");
  const rewards = P.findPage(idx, "live", "rewards");
  assert.deepEqual(rewards.tabs[0].sections.map((s) => [s.moduleId, s.title]), [["places-demo-alerts", "Alertes de démo"], ["places-demo-bot", "Bot de démo"]]);
  assert.deepEqual(rewards.modules, ["places-demo-alerts", "places-demo-bot"], "two modules: the origin line shows");
  assert.deepEqual(P.findPage(idx, "live", "chat").tabs.map((t) => t.id), ["commands", "timers"]);
  assert.equal(P.findPage(idx, "live", "chat").tabs[0].sections.at(-1).section.level, "advanced", "the time zone is an advanced, folded section");
  // Both modules place everything they show: their own sidebar entries go (dual mode).
  assert.ok(P.fullyPlaced(a, P.moduleSections(a)) && P.fullyPlaced(b, P.moduleSections(b)));
  // Without the catalogue vocabulary: derived titles, nothing breaks.
  const bare = P.buildPlaceIndex(contribs, P.BUILTIN_VOCABULARY, "en");
  assert.deepEqual(P.findPage(bare, "live", "alerts").tabs.map((t) => t.title), ["Look", "Rules"]);
  assert.equal(P.findPage(bare, "live", "rewards").tabs[0].title, "Main");
});

test("page visibility: no contributor, no page; a section the person cannot see does not create a page", () => {
  const s = [sec("a1", "live.raid")];
  assert.equal(P.findPage(P.buildPlaceIndex(contrib("m", s, { visible: false }), VOCAB, "en"), "live", "raid"), null);
  assert.equal(P.buildPlaceIndex([], VOCAB, "en").groups.length, 0);
});

test("inline definitions: highest weight wins, then module id; vocabulary always wins", () => {
  const d = (en, fr, weight) => ({ define: { page: { title: { en, fr } }, weight } });
  const idx = P.buildPlaceIndex([...contrib("zz", [sec("a1", "shop.orders", d("Orders Z", "Commandes Z", 10))]), ...contrib("aa", [sec("b1", "shop.orders", d("Orders A", "Commandes A", 10))]), ...contrib("mm", [sec("c1", "shop.orders", d("Orders M", "Commandes M", 90))])], VOCAB, "en");
  assert.equal(P.findPage(idx, "shop", "orders").title, "Orders M");
  const tie = P.buildPlaceIndex([...contrib("zz", [sec("a1", "shop.orders", d("Orders Z", "Commandes Z", 10))]), ...contrib("aa", [sec("b1", "shop.orders", d("Orders A", "Commandes A", 10))])], VOCAB, "en");
  assert.equal(P.findPage(tie, "shop", "orders").title, "Orders A");
  const vocabWins = P.buildPlaceIndex(contrib("zz", [sec("a1", "live.alerts", d("Pops", "Pops", 100))]), VOCAB, "en");
  assert.equal(P.findPage(vocabWins, "live", "alerts").title, "Alerts");
});

/* ───────────── the four live sites ───────────── */

/** The sidebar place entries of a site once its modules declare the places of the study (mapping.json): group → page titles, in order. */
function siteMenu(site, locale = "fr") {
  const contribs = Object.entries(SITES[site]).flatMap(([moduleId, keys]) => {
    const places = MAPPING[moduleId];
    assert.ok(places, `${moduleId} is in the mapping`);
    const sections = places.map((place, i) => sec(`s${i}x`, place, { settings: ["x"] }));
    return keys.flatMap((key) => contrib(moduleId, sections, { key, siblings: keys.length > 1, connector: moduleId.endsWith("-connector") }));
  });
  const idx = P.buildPlaceIndex(contribs, VOCAB, locale);
  return { idx, menu: Object.fromEntries(idx.groups.map((g) => [g.id, g.pages.filter((p) => !p.core).map((p) => p.title)]).filter(([, pages]) => pages.length)) };
}

test("helldog136.be (35 modules): pages named after tasks, none twice", () => {
  const { menu, idx } = siteMenu("helldog136");
  assert.deepEqual(menu, {
    content: ["Questions fréquentes", "Kit presse"],
    live: ["Alertes", "Récompenses", "Chat", "Participation", "Raid", "Passage en direct"],
    calendar: ["Planning", "Story d'annonce"],
    community: ["Contacts", "Partenaires", "Jeux"],
    obs: ["Overlays prédéfinis"],
    networks: ["Twitch", "YouTube", "Discord", "Autres comptes", "Chiffres"],
  });
  // The banners of three hero instances land on the core page « Accueil et menu », which keeps its own address (sections there from core 0.32.0).
  assert.ok(P.findPage(idx, "site", "home").core);
  assert.equal(P.findPage(idx, "site", "home").tabs[0].sections.length, 3);
  assert.deepEqual(P.findPage(idx, "live", "rewards").tabs.map((t) => t.title), ["Récompenses", "Maison connectée"]);
});

test("Rosaliax (14 modules): nothing about alerts, rewards or chat; Live holds one page (shown without heading)", () => {
  const { menu, idx } = siteMenu("rosaliax");
  assert.deepEqual(menu, { content: ["Kit presse"], live: ["Passage en direct"], community: ["Contacts"], obs: ["Overlays prédéfinis"], networks: ["Twitch", "YouTube", "Autres comptes", "Chiffres"] });
  const twitch = P.findPage(idx, "networks", "twitch");
  assert.deepEqual(twitch.tabs[0].sections.map((s) => s.instanceKey), ["twitch-connector", "twitch-channel", "twitch-rascane"], "the connection first, then the two channels, on one page");
  assert.ok(twitch.tabs[0].sections.every((s) => s.moduleId !== "twitch-channel" || s.siblings), "sibling instances: the origin line names the instance");
});

test("Curiosa (9 modules) and CCD (11 modules): no Live, no OBS where nothing contributes", () => {
  assert.deepEqual(siteMenu("curiosa").menu, { content: ["Kit presse"], community: ["Contacts"], networks: ["Autres comptes", "Chiffres"] });
  assert.ok(P.findPage(siteMenu("curiosa").idx, "site", "general").core, "the legal pages section waits on the core page « Général »");
  assert.deepEqual(siteMenu("ccd").menu, { content: ["Questions fréquentes"], calendar: ["Story d'annonce", "Cahier de contenu"], community: ["Contacts", "Partenaires", "Témoignages"], networks: ["Discord", "Autres comptes", "Chiffres"] });
});

test("R12 at runtime: on the four sites no two entries share a name or a first word, except « Pages d'overlay », qualified (E10)", () => {
  const core = ["Accueil et menu", "Apparence", "Réglages", "Liens courts", "Extensions", "Pages d'overlay", "Assistants IA", "Équipe", "Entretien", "Mon compte", "Voir le site"];
  for (const site of Object.keys(SITES)) {
    const { menu } = siteMenu(site);
    // Content lists (one entry per instance, unchanged by places). Two instances of one content module (Blog, Blog 2) are an older, separate question: one per module here.
    const content = Object.entries(SITES[site]).filter(([m]) => ["blog", "links", "pages", "sponsors"].includes(m)).map(([m]) => m.charAt(0).toUpperCase() + m.slice(1));
    const entries = [...content.map((l) => ({ id: `c:${l}`, label: l, group: "Contenu" })), ...Object.entries(menu).flatMap(([g, pages]) => pages.map((l) => ({ id: `p:${l}`, label: l, group: g }))), ...core.map((l) => ({ id: `core:${l}`, label: l, group: "Administration" }))];
    const { labels, clashes } = P.qualifyLabels(entries);
    const unexpected = clashes.filter((c) => !/Pages d'overlay/.test(c));
    assert.deepEqual(unexpected, [], `${site}: ${unexpected.join("; ")}`);
    if (content.includes("Pages")) assert.equal(labels.get("core:Pages d'overlay"), "Pages d'overlay · Administration");
  }
});

/* ───────────── upgrade from the module versions the sites run ───────────── */

test("upgrade: every manifest the four sites run today (refs v1.26.0 to v1.93.0) parses, declares no place and keeps its old menu entry", () => {
  let n = 0;
  for (const [key, raw] of Object.entries(INSTALLED.manifests)) {
    const r = parseManifest(raw);
    assert.ok(r.ok, `${key}: ${r.error}`);
    assert.deepEqual(P.moduleSections(r.manifest), [], `${key} declares no place`);
    assert.equal(P.fullyPlaced(r.manifest, []), false, `${key} keeps its own sidebar entry`);
    if (raw.adminMenu) assert.ok(parseMenuPath(raw.adminMenu), `${key}: adminMenu still valid`);
    n++;
  }
  assert.equal(n, 45);
});

/* ───────────── anchors, install message, isolation ───────────── */

test("stable anchors and addresses; install-end message from the manifest", () => {
  assert.equal(P.sectionAnchor("twitch-rascane", "look"), "twitch-rascane.look");
  assert.equal(P.placeHref("live", "alerts", "look"), "/admin/live/alerts/look");
  const { items, more } = P.addedInList(P.moduleSections(demo("places-demo-alerts")), VOCAB, "fr");
  assert.deepEqual(items, [{ label: "En direct › Alertes", href: "/admin/live/alerts" }, { label: "En direct › Récompenses", href: "/admin/live/rewards" }]);
  assert.equal(more, 0);
  assert.equal(P.addedInList(P.moduleSections(man({ place: "site.home.banners" })), VOCAB, "fr").items[0].href, "/admin/home", "a core page keeps its address");
  assert.equal(P.placeBreadcrumb(P.parsePlace("live.alerts.look"), VOCAB, "en"), "Live › Alerts › Appearance");
});

test("a failing or slow section is contained: it reports failed or timeout, never throws", async () => {
  assert.deepEqual(await withBudget(Promise.resolve([1]), 50), { ok: true, value: [1] });
  const err = console.error; console.error = () => {};
  try { assert.deepEqual(await withBudget(Promise.reject(new Error("boom")), 50), { ok: false, reason: "failed" }); } finally { console.error = err; }
  const t0 = Date.now();
  assert.deepEqual(await withBudget(new Promise(() => {}), 60), { ok: false, reason: "timeout" });
  assert.ok(Date.now() - t0 < 1000);
  const page = read("src/app/admin/(panel)/[group]/[page]/[[...tab]]/page.tsx");
  assert.match(page, /Promise\.all\(current\.sections\.map/, "sections load side by side, each with its own budget");
  assert.match(read("src/components/admin/PlaceSection.tsx"), /place-section-unavailable/);
});

/* ───────────── no module in the core ───────────── */

test("the places code names no module", () => {
  const ids = Object.keys(MAPPING).filter((id) => id.includes("-") || ["polls", "faq", "planning", "hero", "audience", "contacts", "sponsors"].includes(id));
  for (const f of ["src/core/modules/places.ts", "src/core/modules/placesLoad.ts", "src/core/maintenance/places.ts", "src/components/admin/PlaceSection.tsx", "src/components/admin/PlacedNotice.tsx", "src/app/admin/(panel)/[group]/[page]/[[...tab]]/page.tsx"]) {
    const code = read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    for (const id of ids) assert.ok(!new RegExp(`["'\`]${id}["'\`]`).test(code), `${f} names ${id}`);
  }
});

test("a page with no vocabulary entry and ONE contributing module takes that module's own name in the site language (menu stays French without the catalogue)", () => {
  const bare = P.BUILTIN_VOCABULARY;
  const one = P.buildPlaceIndex(contrib("faq-like", [sec("main", "content.faq-like")], { name: "Questions fréquentes" }), bare, "fr");
  assert.equal(one.groups[0].pages[0].title, "Questions fréquentes");
  const two = P.buildPlaceIndex([...contrib("a-mod", [sec("main", "content.shared")], { name: "Un" }), ...contrib("b-mod", [sec("main", "content.shared")], { name: "Deux" })], bare, "fr");
  assert.equal(two.groups[0].pages[0].title, "Shared", "several modules: nothing to prefer, the derived title stays");
});
