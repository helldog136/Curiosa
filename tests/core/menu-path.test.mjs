// Menu path of a module (`adminMenu`, core 0.13.0): canonical ids, the tree, order, labels, the manifest key, the sidebar markup and the unchanged menus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const M = await import("@/core/modules/menuPath");
const P = await import("@/core/modules/menuPlacement");
const { parseManifest } = await import("@/core/modules/manifest");

const ids = (raw) => M.parseMenuPath(raw)?.map((s) => s.id);
const item = (o) => ({ id: o.id, moduleId: o.id, name: o.name ?? o.id, badge: 0, error: false, placement: "menu", menuOrder: 100, connector: false, groupLabels: {}, ...o, menuPath: o.path === undefined ? null : M.parseMenuPath(o.path) });

test("every spelling of a group is the same group", () => {
  for (const raw of ["Réseaux.Twitch", "Reseaux.Twitch", "networks.twitch", "NETWORKS.TWITCH", " Réseaux . Twitch ", "network.twitch"]) assert.deepEqual(ids(raw), ["networks", "twitch"], raw);
  assert.deepEqual(ids("Outils.Planning"), ["tools", "planning"]);
  assert.deepEqual(ids("Boutique.Commandes"), ["boutique", "commandes"]);
  assert.deepEqual(ids("twitter"), ["x"]);
  assert.deepEqual(ids("Contenu"), ["content"]);
});

test("a path is refused when empty, too deep, with an empty segment, too long, or rooted in a core entry", () => {
  for (const bad of ["", ".", "a..b", "a.b.c.d", "Réseaux.", ".Twitch", "x".repeat(41), "Site.Plus", "Administration.Outils", "Account.Me", 3, null, undefined, ["a"]]) assert.equal(M.parseMenuPath(bad), null, JSON.stringify(bad));
  assert.equal(M.parseMenuPath("a.b.c")?.length, 3);
  assert.equal(M.parseMenuPath("Réseaux")?.length, 1);
});

test("titles: well-known in both languages, an unknown group shows its own text title-cased, a module can label its group", () => {
  const seg = (raw) => M.parseMenuPath(raw)[0];
  assert.equal(M.groupTitle(seg("Reseaux"), "fr"), "Réseaux");
  assert.equal(M.groupTitle(seg("Réseaux"), "en"), "Networks");
  assert.equal(M.groupTitle(seg("youtube"), "fr"), "YouTube");
  assert.equal(M.groupTitle(seg("boutique"), "fr"), "Boutique");
  assert.equal(M.groupTitle(seg("ma-boutique"), "en"), "Ma Boutique");
  assert.equal(M.groupTitle(seg("shop"), "fr", { shop: { en: "Shop", fr: "Boutique" } }), "Boutique");
  assert.equal(M.groupTitle(seg("shop"), "de", { shop: { en: "Shop" } }), "Shop");
  assert.equal(M.groupIcon("twitch"), "🟣");
  assert.equal(M.groupIcon("boutique"), M.GENERIC_GROUP_ICON);
});

test("the table of known groups: unique ids and titles, both languages, no clash with the core headings (R12)", () => {
  for (const key of ["id", "en", "fr"]) assert.equal(new Set(M.KNOWN_GROUPS.map((g) => g[key].toLowerCase())).size, M.KNOWN_GROUPS.length, key);
  for (const g of M.KNOWN_GROUPS) assert.ok(g.en && g.fr && g.icon, g.id);
  // The four sections are the ones of the sidebar, with the sidebar's own words.
  for (const id of P.MENU_SECTIONS) { const g = M.KNOWN_GROUPS.find((k) => k.id === id); assert.equal(g.en, en[`nav.${id}`], id); assert.equal(g.fr, fr[`nav.${id}`], id); }
  for (const [lang, d] of [["en", en], ["fr", fr]]) {
    const core = ["nav.dashboard", "nav.homeMenu", "nav.appearance", "nav.settings", "nav.redirects", "nav.extensions", "nav.overlayPages", "nav.assistants", "nav.users", "nav.maintenance", "nav.myAccount", "nav.viewSite", "nav.site", "nav.admin", "nav.account"].map((k) => d[k].toLowerCase().split(/\s+/)[0]);
    for (const g of M.KNOWN_GROUPS) if (!P.MENU_SECTIONS.includes(g.id)) assert.ok(!core.includes(g[lang].toLowerCase().split(/\s+/)[0]), `${lang}: ${g.id} repeats a core entry`);
  }
  const nets = M.KNOWN_GROUPS.find((g) => g.id === "networks");
  assert.deepEqual([nets.en, nets.fr], ["Networks", "Réseaux"]);
});

test("the tree: groups appear only with entries, nested, well-known first, unknown alphabetical after", () => {
  const items = [
    item({ id: "bot", name: "Twitch bot", path: "Réseaux.Twitch" }),
    item({ id: "dc", name: "Discord announcements", path: "networks.discord" }),
    item({ id: "shop", name: "Orders", path: "Boutique.Commandes" }),
    item({ id: "atelier", name: "Atelier", path: "Atelier" }),
    item({ id: "plan", name: "Planning", path: "Outils.Planning" }),
    item({ id: "tool", name: "Tool", path: "Tools" }),
    item({ id: "plain", name: "Plain" }),
    item({ id: "off", name: "Off", path: "Réseaux.Kick", placement: "integrations" }),
    item({ id: "err", name: "Err", path: "Réseaux.Reddit", error: true }),
  ];
  const tree = M.buildMenuTree(items, "fr");
  assert.deepEqual(tree.groups.map((g) => g.id), ["networks", "atelier", "boutique"], "networks first, then alphabetical");
  const nets = tree.groups[0];
  assert.equal(nets.title, "Réseaux");
  assert.deepEqual(nets.children.map((c) => c.title), ["Twitch", "Discord"], "twitch before discord in the fixed order");
  assert.deepEqual(nets.entries, [], "Réseaux holds no entry of its own");
  assert.equal(nets.count, 2);
  assert.ok(!JSON.stringify(tree).includes("Kick") && !JSON.stringify(tree).includes("Reddit"), "unpinned and failing instances stay out; an empty group is not built");
  assert.ok(!JSON.stringify(tree).includes("Plain"), "no path: not in the tree");
  assert.deepEqual(tree.sections.tools.entries.map((e) => e.id), ["tool"]);
  assert.deepEqual(tree.sections.tools.children.map((c) => [c.title, c.entries.map((e) => e.id)]), [["Planning", ["plan"]]]);
  assert.deepEqual(tree.groups[2].children.map((c) => c.title), ["Commandes"]);
  assert.deepEqual(M.buildMenuTree([item({ id: "a" })], "en"), { sections: {}, groups: [] });
});

test("depth 3 works, and the badges add up to the group", () => {
  const t = M.buildMenuTree([item({ id: "a", path: "A.B.C", badge: 2 }), item({ id: "b", path: "A.B", badge: 3 })], "en");
  assert.equal(t.groups[0].children[0].children[0].entries[0].id, "a");
  assert.equal(t.groups[0].badge, 5);
  assert.deepEqual(M.nodeEntries(t.groups[0]).map((e) => e.id).sort(), ["a", "b"]);
});

test("entries of a group: adminMenuOrder, then the connector, then alphabetical", () => {
  const entries = M.sortEntries([
    item({ id: "z", name: "Zeta", path: "x" }),
    item({ id: "raid", name: "Raid", path: "x" }),
    item({ id: "bot", name: "Bot", path: "x" }),
    item({ id: "conn", name: "Connector", path: "x", connector: true }),
    item({ id: "chan", name: "Channel", path: "x", menuOrder: 20 }),
    item({ id: "first", name: "Late name", path: "x", menuOrder: 10 }),
  ], "en");
  assert.deepEqual(entries.map((e) => e.id), ["first", "chan", "conn", "bot", "raid", "z"]);
});

test("the tree does not depend on the order the instances come in, nor on the group's text spelling of another module", () => {
  const a = item({ id: "a", moduleId: "a", name: "A", path: "Boutique Perso.X" });
  const b = item({ id: "b", moduleId: "b", name: "B", path: "boutique-perso.Y", groupLabels: { "boutique-perso": { fr: "Ma boutique" } } });
  const one = M.buildMenuTree([a, b], "fr");
  const two = M.buildMenuTree([b, a], "fr");
  assert.deepEqual(one, two);
  assert.equal(one.groups.length, 1);
  assert.equal(one.groups[0].title, "Ma boutique");
});

test("the state id of a group is a valid cookie id and stays distinct for long paths", () => {
  const ok = /^[a-z][a-z0-9_-]{0,30}$/;
  assert.equal(M.groupStateId(["networks", "twitch"]), "g-networks-twitch");
  const a = M.groupStateId(["a".repeat(24), "b".repeat(24), "c".repeat(24)]);
  const b = M.groupStateId(["a".repeat(24), "b".repeat(24), "d".repeat(24)]);
  assert.ok(ok.test(a) && ok.test(b));
  assert.notEqual(a, b);
  const state = P.parseNavState(P.serializeNavState({ [M.groupStateId(["networks", "twitch"])]: true }));
  assert.equal(state["g-networks-twitch"], true);
});

test("manifest: adminMenu, adminMenuOrder and adminMenuLabels are validated; absent, nothing changes; an older core ignores them", () => {
  const base = { apiVersion: 2, id: "demo-x", name: "X", version: "1.0.0", main: "index.mjs" };
  const ok = (extra) => parseManifest({ ...base, ...extra });
  assert.equal(ok({}).ok, true);
  assert.equal(ok({}).manifest.adminMenu, undefined);
  assert.equal(ok({ adminMenu: "Réseaux.Twitch", adminMenuOrder: 5 }).ok, true);
  assert.equal(ok({ adminMenu: "Boutique.Commandes", adminMenuLabels: { boutique: { en: "Shop", fr: "Boutique" } } }).ok, true);
  for (const bad of [{ adminMenu: "" }, { adminMenu: "a.b.c.d" }, { adminMenu: "Site.Plus" }, { adminMenu: 3 }, { adminMenu: "a..b" }, { adminMenuOrder: -1 }, { adminMenuOrder: 1000 }, { adminMenuOrder: 1.5 }, { adminMenuLabels: { "Bad Key": { en: "x" } } }, { adminMenuLabels: { a: { en: "" } } }]) assert.equal(ok(bad).ok, false, JSON.stringify(bad));
  assert.equal(ok({ adminMenu: "Réseaux.Twitch", someFutureKey: 1 }).ok, true);
});

test("a module with a path is pinned by default; the person's choice and the old rule are untouched without it", () => {
  assert.equal(P.defaultPlacement({ type: "integration", adminMenu: "Réseaux.Twitch" }), "menu");
  assert.equal(P.defaultPlacement({ type: "overlay", permissions: ["overlay"], adminMenu: "Réseaux.Twitch" }), "menu");
  assert.equal(P.defaultPlacement({ type: "integration" }), "integrations");
  assert.equal(P.defaultPlacement({ type: "integration", adminMenu: "a..b" }), "integrations", "an invalid path is ignored");
  assert.equal(P.resolvePlacement({ type: "integration", adminMenu: "Réseaux.Twitch" }, "integrations"), "integrations");
});

test("the old layout is unchanged without a path, and an entry with a path leaves its section", () => {
  const e = (id, section, extra = {}) => ({ id, type: "widget", section, placement: "menu", error: false, badge: 0, content: false, ...extra });
  const plain = [e("a", "content"), e("b", "tools"), e("c", "connections")];
  const L = P.buildMenuLayout(plain);
  assert.deepEqual([L.content.length, L.community.length, L.tools.length, L.connections.length, L.unpinnedBadge], [1, 0, 1, 1, 0]);
  const withPath = P.buildMenuLayout([...plain, e("d", "connections", { menuPath: [{ id: "networks", text: "n" }] })]);
  assert.deepEqual(withPath.connections.map((i) => i.id), ["c"]);
});

test("sidebar markup: the tree is built once, in the sections and before Connections, with 44 px entries and the same remembered state", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /const tree = buildMenuTree\(nav, locale\)/);
  assert.match(layout, /data-testid="nav-tree"/);
  assert.ok(layout.indexOf('data-testid="nav-tree"') < layout.indexOf('data-testid="nav-section-connections"'), "networks sit before Connections");
  assert.match(layout, /\.\.\.treeItems\]\)/, "pages of an unpinned instance stay under Extensions, tree entries are not among them");
  const group = read("src/components/admin/NavGroup.tsx");
  assert.match(group, /<details open=\{open\}/);
  assert.match(group, /"aria-expanded": open/);
  assert.match(group, /min-h-11/);
  assert.match(group, /focus-visible:outline/);
  assert.match(group, /try \{[\s\S]*document\.cookie[\s\S]*catch/, "remembering the state never throws");
  const link = read("src/components/admin/NavLink.tsx");
  assert.match(link, /min-h-11/);
  assert.match(link, /aria-current=\{here \? "page" : undefined\}/);
  const nav = read("src/components/admin/MenuTreeNav.tsx");
  assert.match(nav, /openByDefault=\{false\}/);
  assert.match(nav, /stored=\{state\[id\]\}/);
  assert.ok(!/<script|dangerouslySetInnerHTML/.test(nav));
  // Old markup of the plain group: no new attribute, no new class, when `tree` is off.
  assert.match(group, /\$\{tree \? "min-h-11[^"]*" : ""\}text-\[13px\] font-semibold \$\{tree && here \? "text-accent" : "text-muted"\}/);
  assert.match(group, /<summary[\s\S]*onClick=\{\(e\) => \{ e\.preventDefault\(\); if \(here\) return;/, "the group of the current page cannot be folded away");
});

test("cookie state: a closed state is remembered and a corrupt value is ignored", () => {
  assert.deepEqual(P.parseNavState("g-networks:1,g-networks-twitch:0,<script>:1,connections:x"), { "g-networks": true, "g-networks-twitch": false });
  assert.equal(P.isGroupOpen("g-networks", { "g-networks": false }, false, true), true, "the current page opens its group");
  assert.equal(P.isGroupOpen("g-networks", { "g-networks": true }, false, false), true);
  assert.equal(P.isGroupOpen("g-networks", {}, false, false), false, "closed by default");
});
