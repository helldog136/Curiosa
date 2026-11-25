// (core 0.49.0) The sidebar has one collapsible group « Overlays » with two entries: « Ready-made » (the catalogue page `obs.overlays`, a place page)
// and « Custom » (the core entry that used to be « Overlay pages » under Administration). Same tree, same NavGroup, same remembered state as Networks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const P = await import("@/core/modules/places");
const M = await import("@/core/modules/menuPath");
const A = await import("@/core/modules/adminMenu");
const N = await import("@/core/modules/menuPlacement");
const { isCurrent } = await import("@/components/admin/navCurrent");
const L = await import("@/core/adminLinks");

const catalogue = P.sanitizeVocabulary(JSON.parse(read("tests/fixtures/places/vocabulary.json")));
const VOCAB = P.mergeVocabulary(P.BUILTIN_VOCABULARY, catalogue);

const sec = (id, place) => ({ id, declared: place, place: P.parsePlace(place), order: 500, level: "basic", seeAlso: [], settings: ["x"], panelTabs: ["use"], blocks: false, advancedOnly: false });
const contrib = (moduleId, place) => ({ instanceId: `${moduleId}-id`, instanceKey: moduleId, moduleId, moduleName: moduleId, instanceLabel: moduleId, siblings: false, connector: false, section: sec(`${moduleId}-s`, place), visible: true });

// The items as layout.tsx builds them: place pages (order = index in the group) and the core entry (OVERLAY_CUSTOM_ORDER).
const placeItem = (page, i = 0) => ({ id: `place:${page.id}`, name: page.menuTitle, fullName: page.title, badge: 0, error: false, placement: "menu", menuPath: [{ id: page.group, text: page.group }], menuOrder: i, connector: false, moduleId: "", href: page.href, place: true });
const customItem = () => ({ id: "core:overlays", name: en["nav.overlayCustom"], badge: 0, error: false, placement: "menu", menuPath: [{ id: "obs", text: "obs" }], menuOrder: A.OVERLAY_CUSTOM_ORDER, connector: false, moduleId: "", href: L.OVERLAY_PAGES_HREF, place: true });

test("the group is called Overlays in both languages, in the vocabulary and in the well-known groups (one word, same id as before: addresses unchanged)", () => {
  const vg = P.BUILTIN_VOCABULARY.groups.find((g) => g.id === "obs");
  const kg = M.KNOWN_GROUPS.find((g) => g.id === "obs");
  assert.equal(vg.en, "Overlays"); assert.equal(vg.fr, "Overlays");
  assert.equal(kg.en, vg.en); assert.equal(kg.fr, vg.fr); assert.equal(kg.icon, vg.icon);
  assert.equal(P.placeHref("obs", "overlays"), "/admin/obs/overlays", "the address of the ready-made page did not change");
  assert.equal(L.OVERLAY_PAGES_HREF, "/admin/overlay-pages", "the address of the custom pages did not change");
  assert.equal(M.segmentId("OBS"), "obs", "a module that wrote the old word still lands in the group");
  assert.equal(M.segmentId("Overlays"), "obs", "and so does the new one");
});

test("the ready-made page keeps its full title as heading and takes the short name in the group, in both languages", () => {
  for (const [locale, short, full] of [["en", "Ready-made", "Ready-made overlays"], ["fr", "Prédéfinis", "Overlays prédéfinis"]]) {
    const idx = P.buildPlaceIndex([contrib("maze-overlay", "obs.overlays.maze")], VOCAB, locale);
    const page = P.findPage(idx, "obs", "overlays");
    assert.equal(page.menuTitle, short, locale);
    assert.equal(page.title, full, locale);
  }
  // A page without a short name keeps its title in the sidebar.
  const other = P.buildPlaceIndex([contrib("etoile", "live.alerts.events")], VOCAB, "en");
  const alerts = P.findPage(other, "live", "alerts");
  assert.equal(alerts.menuTitle, alerts.title);
  // The short names are the core's: the catalogue cannot set them.
  const hostile = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary({ pages: [{ id: "live.alerts", en: "Alerts", fr: "Alertes" }], menuTitles: { "live.alerts": { en: "x", fr: "x" } } }));
  assert.deepEqual(Object.keys(hostile.menuTitles), ["obs.overlays"]);
});

test("the group lists Ready-made first, then Custom, in English and in French (alphabetical order would reverse them)", () => {
  for (const [locale, d, names] of [["en", en, ["Ready-made", "Custom"]], ["fr", fr, ["Prédéfinis", "Personnalisés"]]]) {
    const idx = P.buildPlaceIndex([contrib("maze-overlay", "obs.overlays.maze")], VOCAB, locale);
    const ready = idx.groups.find((g) => g.id === "obs").pages.filter((p) => !p.core).map((p, i) => placeItem(p, i));
    const custom = { ...customItem(), name: d["nav.overlayCustom"] };
    const tree = M.buildMenuTree([custom, ...ready], locale);
    assert.equal(tree.groups.length, 1);
    const group = tree.groups[0];
    assert.equal(group.id, "obs");
    assert.equal(group.title, "Overlays");
    assert.deepEqual(group.entries.map((e) => e.name), names, locale);
  }
});

test("the group sits where the OBS group was: after Agenda, before Networks, with the same state id as any other group", () => {
  const items = [{ ...customItem() }, { ...customItem(), id: "x1", menuPath: [{ id: "networks", text: "networks" }], name: "Twitch" }, { ...customItem(), id: "x2", menuPath: [{ id: "calendar", text: "calendar" }], name: "Planning" }];
  const tree = M.buildMenuTree(items, "en");
  assert.deepEqual(tree.groups.map((g) => g.id), ["calendar", "obs", "networks"]);
  assert.equal(M.groupStateId(["obs"]), "g-obs");
});

test("hidden when empty: no visible child, no group (a person without the right to manage overlays and no ready-made page sees nothing)", () => {
  assert.deepEqual(M.buildMenuTree([], "en").groups, []);
  for (const role of ["editor", "none"]) assert.ok(!A.administrationEntries({ role, advanced: true }).includes("overlays"), role);
  assert.ok(!A.administrationEntries({ role: "admin", advanced: true, overlays: false }).includes("overlays"), "a site that does not use overlays has no entry");
  // Only the core entry visible: the group stays, so that « Custom » is never alone without its context.
  const tree = M.buildMenuTree([customItem()], "fr");
  assert.equal(tree.groups[0].title, "Overlays");
  assert.deepEqual(tree.groups[0].entries.map((e) => e.id), ["core:overlays"]);
  // No ready-made page for this person: no place index group, hence no item.
  assert.equal(P.buildPlaceIndex([{ ...contrib("maze-overlay", "obs.overlays.maze"), visible: false }], VOCAB, "en").groups.find((g) => g.id === "obs"), undefined);
});

test("the current page opens the group: each child's addresses count, and the choice remembered by the person never closes the page you are on", () => {
  const readyHref = P.placeHref("obs", "overlays");
  const targets = [readyHref, L.OVERLAY_PAGES_HREF];
  const here = (path) => targets.some((t) => isCurrent(t, path, ""));
  assert.ok(here(readyHref));
  assert.ok(here(L.OVERLAY_PAGES_HREF));
  assert.ok(here(`${L.OVERLAY_PAGES_HREF}/abc123`), "an overlay page being edited");
  assert.ok(here(L.OVERLAYS_OBS_HREF), "the addresses tab of the custom pages");
  assert.ok(here(`${readyHref}/ticker`), "a tab of the ready-made page");
  assert.ok(!here("/admin/extensions"));
  assert.equal(N.isGroupOpen("g-obs", { "g-obs": false }, false, here(readyHref)), true);
  assert.equal(N.isGroupOpen("g-obs", { "g-obs": false }, false, false), false, "closed stays closed elsewhere");
  assert.equal(N.isGroupOpen("g-obs", { "g-obs": true }, false, false), true, "the remembered open state is kept");
  assert.equal(N.isGroupOpen("g-obs", {}, false, false), false, "closed by default, as Networks");
  // Only one child is highlighted at a time.
  assert.ok(!isCurrent(readyHref, `${L.OVERLAY_PAGES_HREF}/abc123`, ""));
  assert.ok(!isCurrent(L.OVERLAY_PAGES_HREF, readyHref, ""));
});

test("R12: the group name and its two children share no name and no first word with each other or with the core entries, in both languages", () => {
  const core = ["nav.dashboard", "nav.homeMenu", "nav.appearance", "nav.settings", "nav.redirects", "nav.extensions", "nav.assistants", "nav.users", "nav.maintenance", "nav.myAccount", "nav.viewSite"];
  for (const [lang, d, group, ready] of [["en", en, "Overlays", "Ready-made"], ["fr", fr, "Overlays", "Prédéfinis"]]) {
    const names = [group, ready, d["nav.overlayCustom"], ...core.map((k) => d[k]), d["family.overlays"]];
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `${lang}: same name twice`);
    const first = names.map((n) => n.toLowerCase().split(/\s+/)[0]);
    assert.equal(new Set(first).size, first.length, `${lang}: same first word twice (${first.join(", ")})`);
  }
  // The runtime check of the layout agrees (nothing gets a qualifier).
  const labels = [
    { id: "g:obs", label: "Overlays", group: "" }, { id: "place:obs.overlays", label: "Ready-made", group: "Overlays" }, { id: "core:overlays", label: "Custom", group: "Overlays" },
    { id: "core:extensions", label: en["nav.extensions"], group: "Administration" }, { id: "core:assistants", label: en["nav.assistants"], group: "Administration" },
  ];
  assert.equal(P.qualifyLabels(labels).labels.size, 0, "no label needed a qualifier");
});

test("layout: the entry « Overlay pages » is gone from Administration and the group is built from the same tree as Networks", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.ok(!/overlays: <NavLink/.test(layout), "no more overlays link in the Administration list");
  assert.match(layout, /allAdminEntries\.filter\(\(id\): id is SidebarAdminEntry => id !== "overlays"\)/);
  assert.match(layout, /menuPath: \[\{ id: "obs", text: "obs" \}\]/);
  assert.match(layout, /<MenuTreeNav key=\{n\.id\} node=\{n\}/, "the same component as Networks and Calendar");
  assert.ok(!Object.hasOwn(A.SIDEBAR_R12_KEYS.admin.entries, "overlays"));
  assert.equal(en["nav.overlayCustom"], "Custom");
  assert.equal(fr["nav.overlayCustom"], "Personnalisés");
});

test("the old key keeps its value for the places and the settings search (nothing else changes for them)", () => {
  assert.equal(en["nav.overlayPages"], "Overlay pages");
  assert.equal(fr["nav.overlayPages"], "Pages d'overlay");
});
