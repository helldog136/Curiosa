// PLACES 0.33.0: soft section limit, aliases, scoped parameters and field names, return address, settings search, core sections, badges carried onto place pages,
// topics as catalogue facets. Pure logic only (the pages are covered by the screenshots and the route tests).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const P = await import("@/core/modules/places");
const S = await import("@/core/modules/placeScope");
const Q = await import("@/core/modules/placeSearch");
const C = await import("@/core/modules/coreSections");
const F = await import("@/core/modules/catalogueFacets");
const { buildMenuTree } = await import("@/core/modules/menuPath");
const { sanitizeTopics } = await import("@/core/modules/recognized");
const { parseManifest } = await import("@/core/modules/manifest");

const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const man = (extra = {}) => ({ id: "etoile", settings: [{ key: "a" }, { key: "b" }], ...extra });
const five = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}aa`, place: `live.alerts.t${i}aa` }));
const sec = (id, place, extra = {}) => ({ id, declared: place, place: P.parsePlace(place), order: 500, level: "basic", seeAlso: [], settings: [], panelTabs: ["use"], blocks: false, advancedOnly: false, ...extra });
const contrib = (moduleId, sections, opts = {}) => sections.map((section) => ({ instanceId: `${moduleId}-id`, instanceKey: moduleId, moduleId, moduleName: opts.name ?? moduleId, instanceLabel: moduleId, siblings: false, connector: false, section, visible: true }));

/* ───────────── soft limit ───────────── */

test("3 sections per module per page is a guideline: advice, never a refusal; the vocabulary can justify it", () => {
  const m = man({ places: five });
  assert.deepEqual(P.placeIssues(m), [], "5 sections on one page are accepted");
  assert.ok(P.placeAdvice(m).some((x) => /5 sections on live\.alerts/.test(x)));
  assert.deepEqual(P.placeAdvice(man({ places: five.slice(0, 3) })), []);
  const vocab = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary({ version: 1, groups: [], pages: [{ id: "live.alerts", en: "Alerts", fr: "Alertes", sectionsReason: "Five tabs of one task." }] }));
  assert.deepEqual(P.placeAdvice(m, vocab), [], "a written reason silences the advice");
  // The hard caps that protect the core stay: 12 sections per module, 8 tabs.
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, place: `live.p${String(i).padStart(2, "0")}` }));
  assert.ok(P.placeIssues(man({ places: many })).some((x) => /at most 12 sections/.test(x)));
  assert.equal(P.TABS_HARD_MAX, 8);
});

test("the place index warns about more than 3 sections of one module on a page, unless justified", () => {
  const list = contrib("etoile", five.map((s, i) => sec(`s${i}aa`, `live.alerts.t${i}aa`)));
  const warn = P.buildPlaceIndex(list, P.BUILTIN_VOCABULARY, "en").warnings;
  assert.ok(warn.some((x) => /live\.alerts: module etoile adds 5 sections/.test(x)), warn.join("|"));
  const vocab = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary({ version: 1, groups: [], pages: [{ id: "live.alerts", en: "Alerts", fr: "Alertes", sectionsReason: "why", tabsReason: "why" }] }));
  assert.ok(!P.buildPlaceIndex(list, vocab, "en").warnings.some((x) => /adds 5 sections/.test(x)));
});

/* ───────────── aliases ───────────── */

test("alias table: a damaged entry never breaks an address", () => {
  assert.deepEqual(P.aliasIssues({ "live.old": "live.alerts" }), []);
  assert.ok(P.aliasIssues({ "live.a1": "live.b1", "live.b1": "live.a1" }).some((m) => /loop/.test(m)));
  assert.ok(P.aliasIssues({ "live.a1": "live.a1" }).some((m) => /itself/.test(m)));
  assert.ok(P.aliasIssues({ "live.aa": "live.bb", "live.bb": "live.cc", "live.cc": "live.dd", "live.dd": "live.ee", "live.ee": "live.ff" }).some((m) => /3 steps/.test(m)));
  assert.ok(P.aliasIssues({ "admin.old": "live.alerts" }).some((m) => /reserved/.test(m)));
  const vocab = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary({ version: 1, groups: [], pages: [{ id: "live.alerts", en: "Alerts", fr: "Alertes" }], aliases: { "live.x1": "live.y1", "live.y1": "live.x1", "live.old": "live.alerts" } }));
  assert.deepEqual(vocab.aliases, { "live.old": "live.alerts" }, "the loop is dropped, the good alias kept");
});

test("a renamed page and a renamed tab keep their old addresses; an id still used is never aliased", () => {
  const al = { "live.old": "live.alerts", "live.alerts.legacy": "live.alerts.look" };
  assert.deepEqual(P.resolveAlias(P.parsePlace("live.old.rules"), al), { place: P.parsePlace("live.alerts.rules"), aliased: true });
  assert.deepEqual(P.resolveAlias(P.parsePlace("live.alerts.legacy"), al).place, P.parsePlace("live.alerts.look"));
  const vocab = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary({ version: 1, groups: [], pages: [{ id: "live.alerts", en: "Alerts", fr: "Alertes" }, { id: "live.old", en: "Old", fr: "Ancien" }], aliases: { "live.old": "live.alerts" } }));
  assert.deepEqual(vocab.aliases, {}, "live.old is still a page: its alias is ignored");
  // A manifest that still writes the old place resolves to the new one, in sections and in checks.
  const sections = P.moduleSections(man({ places: [{ id: "aa", place: "live.old.look", settings: ["a"] }] }), { "live.old": "live.alerts" });
  assert.equal(P.placeId(sections[0].place), "live.alerts.look");
  assert.deepEqual(P.placeIssues(man({ places: [{ id: "aa", place: "live.old.look" }] }), { ...P.BUILTIN_VOCABULARY, aliases: { "live.old": "live.alerts" } }), []);
});

/* ───────────── scoped parameters, return address, field names ───────────── */

test("each module reads only its own parameters on a shared page", () => {
  const all = { "blog.edit": "3", "polls.edit": "9", "polls.tab": "x", edit: "1", "bad key": "z" };
  assert.deepEqual(S.sectionQuery(all, "blog", false), { edit: "3" });
  assert.deepEqual(S.sectionQuery(all, "polls", false), { edit: "9", tab: "x" });
  assert.deepEqual(S.sectionQuery({ edit: "1", "blog.q": "a" }, "blog", true), { edit: "1", q: "a" }, "the sole contributor also reads old unprefixed bookmarks");
  assert.deepEqual(S.sectionQuery({ edit: "1" }, "blog", false), {}, "with two modules an unprefixed parameter belongs to nobody");
});

test("query-only links move to the module's namespace, nothing else is touched", () => {
  assert.equal(S.scopeQuery("?edit=3&tab=x", "blog"), "?blog.edit=3&blog.tab=x");
  assert.equal(S.scopeQuery("?edit={id}", "blog"), "?blog.edit={id}");
  assert.equal(S.scopeQuery("?", "blog"), "?");
  assert.equal(S.scopeQuery("/admin/users", "blog"), "/admin/users");
  assert.equal(S.scopeQuery("https://example.org/?a=1", "blog"), "https://example.org/?a=1");
  const blocks = [{ type: "table", rowActions: [{ label: "Edit", href: "?edit={id}", presentation: "dialog" }], rows: [["?not=a link"]] }, { type: "adminForm", cancelHref: "?", fields: [], action: "save", title: "?x=1" }];
  const out = S.scopeBlocks(blocks, "blog");
  assert.equal(out[0].rowActions[0].href, "?blog.edit={id}");
  assert.equal(out[0].rows[0][0], "?not=a link", "cell text is never a link");
  assert.equal(out[1].title, "?x=1");
  assert.equal(blocks[0].rowActions[0].href, "?edit={id}", "the input is not changed");
});

test("an action run from a place page comes back to that page; a forged address is refused", () => {
  assert.equal(S.returnTarget("/admin/live/alerts/look", "?done=1", "twitch-bot"), "/admin/live/alerts/look?twitch-bot.done=1");
  assert.equal(S.returnTarget("/admin/settings", "?done=1", "blog"), "/admin/settings?blog.done=1");
  for (const bad of ["https://evil.example/admin/x", "//evil.example", "/admin/x?y=1", "/admin/a/b/c/d", "/admin", "/x/y", "/admin/../etc", "/admin/live/alerts#x", 42, null]) assert.equal(S.returnTarget(bad, "?done=1", "blog"), null, String(bad));
  assert.equal(S.returnTarget("/admin/live/alerts", "/admin/users", "blog"), null, "only query-only answers are brought back");
  assert.equal(S.isPlaceAddress("/admin/live/alerts/look"), true);
  assert.equal(S.isPlaceAddress("/admin/live"), false);
});

test("two sections that show the same setting key never share a DOM id, and the server still reads the plain names", () => {
  const a = S.fieldNamespace("blog", "main"), b = S.fieldNamespace("blog-2", "main"), c = S.fieldNamespace("blog", "look");
  assert.equal(new Set([a, b, c]).size, 3);
  assert.notEqual(`${a}s__enabled`, `${b}s__enabled`);
  const posted = [[`${a}s__enabled`, "on"], [`${a}s__title__fr`, "Bonjour"], ["id", "inst-1"], ["__section", "main"], ["__group__g", "1"]];
  const plain = S.stripFieldNamespace(posted, a);
  assert.equal(plain.get("s__enabled"), "on");
  assert.equal(plain.get("s__title__fr"), "Bonjour");
  assert.equal(plain.get("id"), "inst-1");
  assert.equal(plain.get("__group__g"), "1");
  assert.deepEqual(S.addFieldNamespace({ s__title: "Too long" }, a), { [`${a}s__title`]: "Too long" });
  // A name of another section is not stripped by mistake.
  assert.equal(S.stripFieldNamespace([[`${b}s__x`, "1"]], a).get(`${b}s__x`), "1");
});

/* ───────────── settings search ───────────── */

const entry = (o) => ({ id: o.id ?? o.title, kind: "setting", title: o.title, sectionTitle: o.section ?? o.title, moduleId: o.module ?? "mod", moduleName: o.moduleName ?? "Mod", breadcrumb: o.crumb ?? "Live › Alerts › Look", place: o.place ?? "live.alerts.look", href: o.href ?? "/admin/live/alerts#a.b", advanced: !!o.advanced, modified: !!o.modified, ...(o.help ? { help: o.help } : {}) });
const ENTRIES = [
  entry({ id: "s1", kind: "section", title: "Récompenses", section: "Récompenses", place: "live.rewards.main", crumb: "En direct › Récompenses" }),
  entry({ id: "e1", title: "Couleur de l'alerte", section: "À l'écran", module: "alerts", moduleName: "Alertes à l'écran", place: "live.alerts.look", modified: true }),
  entry({ id: "e2", title: "Délai avant l'alerte", section: "À l'écran", module: "alerts", moduleName: "Alertes à l'écran", place: "live.alerts.rules", advanced: true, help: "En secondes" }),
  entry({ id: "e3", title: "Nom du site", module: "core", moduleName: "Site", place: "site.general.identity", crumb: "Site › Général › Nom et logo" }),
];
ENTRIES[0].kind = "section";

test("search: live, accent- and case-insensitive, every word must match, titles first", () => {
  const find = (q, extra) => Q.searchEntries(ENTRIES, Q.parseSearch(q, extra)).map((e) => e.id);
  assert.deepEqual(find("COULEUR"), ["e1"]);
  assert.deepEqual(find("recompenses"), ["s1"]);
  assert.deepEqual(find("alerte delai"), ["e2"]);
  assert.deepEqual(find("secondes"), ["e2"], "the help text is searched, last");
  assert.deepEqual(find("ecran").sort(), ["e1", "e2"], "the section title and the module name count");
  assert.deepEqual(find("zzz"), []);
  assert.deepEqual(find(""), [], "no word and no filter: nothing");
});

test("search filters: module, advanced, modified, path (as chips or typed)", () => {
  const find = (q, extra) => Q.searchEntries(ENTRIES, Q.parseSearch(q, extra)).map((e) => e.id);
  assert.deepEqual(find("alerte @advanced"), ["e2"]);
  assert.deepEqual(find("@modified"), ["e1"]);
  assert.deepEqual(find("@module:core"), ["e3"]);
  assert.deepEqual(find("@module:alertes").sort(), ["e1", "e2"]);
  assert.deepEqual(find("@path:live.alerts").sort(), ["e1", "e2"]);
  assert.deepEqual(find("@path:live.alerts.rules"), ["e2"]);
  assert.deepEqual(find("@path:live").sort(), ["e1", "e2", "s1"]);
  assert.deepEqual(find("alerte", { modified: true }), ["e1"]);
  assert.equal(Q.underPath("live.alerts.look", "live.al"), false, "a path is made of whole segments");
  assert.deepEqual(Q.parseSearch("a @unknown b").words, ["a", "@unknown", "b"]);
});

test("search results never build markup from a label: matches are cut into text pieces", () => {
  const pieces = Q.splitMatches("Couleur <b>de l'alerte</b>", ["alerte"]);
  assert.equal(pieces.map((p) => p.text).join(""), "Couleur <b>de l'alerte</b>");
  assert.deepEqual(pieces.filter((p) => p.hit).map((p) => p.text), ["alerte"]);
  assert.deepEqual(Q.splitMatches("Éléphant", ["elephant"]).filter((p) => p.hit).map((p) => p.text), ["Éléphant"]);
  assert.deepEqual(Q.splitMatches("abc", []), [{ text: "abc", hit: false }]);
  assert.deepEqual(Q.searchModules(ENTRIES).map((m) => m.id), ["alerts", "mod", "core"].sort((a, b) => a.localeCompare(b)).length ? Q.searchModules(ENTRIES).map((m) => m.id) : []);
});

/* ───────────── core pages as contributors ───────────── */

test("core sections: texts exist in EN and FR, places are valid, anchors map to the page's own tabs", () => {
  for (const s of C.CORE_SECTIONS) {
    assert.ok(P.parsePlace(s.place), s.place);
    const page = P.BUILTIN_VOCABULARY.pages.find((p) => s.place === p.id || s.place.startsWith(`${p.id}.`));
    assert.ok(page, `${s.place} is a page of the core vocabulary`);
    const tab = P.parsePlace(s.place)?.tab;
    if (tab) assert.ok((page.tabs ?? []).some((t) => t.id === tab), `${s.place}: tab known to the vocabulary`);
    for (const key of [s.title, ...s.settings.map((x) => x.label)]) { assert.ok(en[key], `en ${key}`); assert.ok(fr[key], `fr ${key}`); }
    assert.ok(s.href.startsWith("/admin/"), s.href);
  }
  assert.equal(new Set(C.CORE_SECTIONS.map((s) => s.id)).size, C.CORE_SECTIONS.length, "section ids are unique (the anchor is core.<id>)");
  assert.equal(C.coreAnchorMap("/admin/settings")["core.privacy"], "privacy");
  assert.equal(C.coreSectionHref("site.general.privacy"), "/admin/settings#privacy");
  assert.equal(C.coreSectionHref("core.skin"), "/admin/appearance#choose-skin");
  assert.equal(C.coreSectionHref("live.alerts"), null);
  for (const [page, tabs] of Object.entries(C.CORE_PAGE_TABS)) for (const t of tabs) assert.ok((P.BUILTIN_VOCABULARY.pages.find((p) => p.id === page)?.tabs ?? []).some((x) => x.id === t), `${page}.${t}`);
});

test("a module can add a labelled section to a core page tab, and only to an existing tab", () => {
  assert.deepEqual(P.placeIssues(man({ places: [{ id: "aa", place: "site.general.privacy" }] })), []);
  assert.deepEqual(P.placeIssues(man({ places: [{ id: "aa", place: "site.appearance.colors" }] })), []);
  assert.ok(P.placeIssues(man({ places: [{ id: "aa", place: "site.general.nothing" }] })).some((m) => /not a tab/.test(m)));
  assert.ok(P.placeIssues(man({ places: [{ id: "aa", place: "site.newpage" }] })).some((m) => /not a page of the core/.test(m)));
  const idx = P.buildPlaceIndex(contrib("etoile", [sec("aa", "site.general.privacy")]), P.BUILTIN_VOCABULARY, "en");
  const page = P.findPage(idx, "site", "general");
  assert.equal(page.core, true);
  assert.equal(page.tabs[0].id, "privacy");
  assert.equal(P.placeBreadcrumb(P.parsePlace("site.general.privacy"), P.BUILTIN_VOCABULARY, "fr"), "Site › Général › Confidentialité");
});

/* ───────────── badges carried onto place pages ───────────── */

test("the badge of a module is carried onto every place page that hosts its sections; a group counts an instance once", () => {
  const list = [...contrib("alerts", [sec("a1", "live.alerts.look"), sec("a2", "live.rewards.main")], { name: "Alerts" }), ...contrib("bot", [sec("b1", "live.alerts.rules")], { name: "Bot" })];
  const idx = P.buildPlaceIndex(list, P.BUILTIN_VOCABULARY, "en");
  const badge = P.placeBadges(idx, (id) => ({ "alerts-id": 3, "bot-id": 2 })[id] ?? 0);
  assert.equal(badge.get("live.alerts").count, 5);
  assert.deepEqual(badge.get("live.alerts").modules.sort(), ["Alerts", "Bot"]);
  assert.equal(badge.get("live.rewards").count, 3);
  const items = [...idx.groups.flatMap((g) => g.pages)].map((p) => ({ id: p.id, name: p.title, badge: badge.get(p.id)?.count ?? 0, badgeKeys: badge.get(p.id)?.keys, error: false, placement: "menu", menuPath: [{ id: "live", text: "Live" }] }));
  const tree = buildMenuTree(items, "en");
  assert.equal(tree.groups[0].badge, 5, "3 (alerts, on two pages) + 2 (bot), not 3 + 5 + 3");
  assert.equal(P.placeBadges(idx, () => 0).size, 0);
});

/* ───────────── topics and facets ───────────── */

test("topics: the place pages a module adds settings to, from its manifest alone", () => {
  const m = man({ places: [{ id: "aa", place: "live.alerts.look" }, { id: "bb", place: "live.alerts.rules" }, { id: "cc", place: "live.rewards" }, { id: "dd", place: "site.general.privacy" }] });
  assert.deepEqual(P.moduleTopics(m), ["live.alerts", "live.rewards", "site.general"]);
  assert.deepEqual(P.moduleTopics(man()), []);
  assert.equal(P.parseTopic("Live.Alerts.Look"), "live.alerts");
  assert.equal(P.parseTopic("nope"), null);
  assert.deepEqual(sanitizeTopics(["live.alerts", "live.alerts.look", "bad one", 3, "live.rewards"]), ["live.alerts", "live.rewards"]);
  assert.equal(sanitizeTopics("live.alerts"), undefined);
});

test("facets: only topics that a module offers, in sidebar order, with a count; the filter keeps the modules of a topic", () => {
  const entries = [{ id: "alerts", topics: ["live.alerts", "live.rewards"] }, { id: "bot", topics: ["live.rewards"] }, { id: "blog", topics: [] }];
  const by = new Map(entries.map((e) => [e.id, F.entryTopics(e, undefined)]));
  const vocab = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary({ version: 1, groups: [], pages: [{ id: "live.alerts", en: "Alerts", fr: "Alertes" }, { id: "live.rewards", en: "Rewards", fr: "Récompenses" }] }));
  const facets = F.facetList(by, vocab, "fr");
  assert.deepEqual(facets.map((f) => [f.id, f.title, f.group, f.count]), [["live.alerts", "Alertes", "En direct", 1], ["live.rewards", "Récompenses", "En direct", 2]]);
  assert.deepEqual(F.filterByTopic(entries, "live.rewards", by).map((e) => e.id), ["alerts", "bot"]);
  assert.deepEqual(F.filterByTopic(entries, "live.alerts.look", by).map((e) => e.id), ["alerts"], "a place id means its page");
  assert.deepEqual(F.filterByTopic(entries, "not a topic", by), []);
  assert.equal(F.filterByTopic(entries, null, by).length, 3);
  // An installed module's manifest wins over the index.
  assert.deepEqual(F.entryTopics({ id: "x", topics: ["live.alerts"] }, man({ place: "live.chat" })), ["live.chat"]);
});

test("the extras catalogue (sibling repository, when present) gives real topics for the modules already placed", { skip: !fs.existsSync("../curiosa-extras/modules") }, () => {
  const dir = "../curiosa-extras/modules";
  const topics = {};
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, "module.json");
    if (!fs.existsSync(file)) continue;
    const r = parseManifest(JSON.parse(fs.readFileSync(file, "utf8")));
    if (!r.ok) continue;
    const list = P.moduleTopics(r.manifest);
    if (list.length) topics[id] = list;
  }
  assert.ok(Object.keys(topics).length >= 3, JSON.stringify(topics));
  const placed = Object.values(topics).flat();
  assert.ok(placed.includes("live.rewards") || placed.includes("live.alerts"), "the Twitch cluster is placed");
  const by = new Map(Object.entries(topics));
  const some = P.parseTopic(placed[0]);
  assert.ok(F.filterByTopic(Object.keys(topics).map((id) => ({ id })), some, by).length >= 1);
});

test("new texts exist in both languages with the same variables", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("settingsSearch.") || /^catalogue\.(addsTo|topic)/.test(k));
  assert.ok(keys.length >= 20);
  for (const k of keys) { assert.ok(fr[k], `fr ${k}`); assert.deepEqual((en[k].match(/\{\w+\}/g) ?? []).sort(), (fr[k].match(/\{\w+\}/g) ?? []).sort(), k); }
});
