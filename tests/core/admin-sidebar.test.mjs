// The sidebar model (src/core/adminSidebar.ts) and the shell that draws it (C1c of the admin redesign): sticky desktop sidebar with the account block pinned
// at the bottom, decorative SVG icons, 44 px rows, collapsible sections, one bug report link, a working sheet on a phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const S = await import("@/core/adminSidebar");
const { SIDEBAR_R12_KEYS } = await import("@/core/modules/adminMenu");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));

test("every icon draws something, with plain path data", () => {
  assert.ok(S.MENU_ICON_KEYS.length >= 20);
  for (const k of S.MENU_ICON_KEYS) {
    assert.ok(S.MENU_ICONS[k].length > 0, k);
    for (const d of S.MENU_ICONS[k]) assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/, `${k}: ${d}`);
  }
  for (const icon of Object.values(S.SECTION_ICON)) assert.ok(S.isMenuIcon(icon));
  for (const l of [S.DASHBOARD_LINK, ...S.SITE_LINKS, ...Object.values(S.ADMIN_LINKS), ...S.ACCOUNT_LINKS]) assert.ok(S.isMenuIcon(l.icon), l.id);
});

test("icon choice: the module's own menuIcon when valid, else its section; unknown groups get a folder", () => {
  assert.equal(S.entryIconKey("cart", "content"), "cart");
  assert.equal(S.entryIconKey("<script>", "community"), "users");
  assert.equal(S.entryIconKey(null, "tools"), "wrench");
  assert.equal(S.groupIconKey("live"), "radio");
  assert.equal(S.groupIconKey("anything-else"), "folder");
});

test("a manifest may declare menuIcon from the core set, and nothing else", async () => {
  const { manifestSchema } = await import("@/core/modules/manifest");
  const base = { id: "demo", name: "Demo", version: "1.0.0", minCore: "0.6.0" };
  const issues = (m) => JSON.stringify(manifestSchema.safeParse({ ...base, ...m }).error?.issues ?? []);
  assert.ok(issues({ menuIcon: "not-an-icon" }).includes("menuIcon"), "an unknown icon is refused");
  assert.ok(!issues({ menuIcon: "cart" }).includes("menuIcon"), "a core icon is accepted");
});

test("the model agrees with the keys the R12 check reads (no drift between the two lists)", () => {
  const site = S.SITE_LINKS.map((l) => [l.id, l.label]);
  assert.deepEqual(site, SIDEBAR_R12_KEYS.site.entries.map(([id, key]) => [id, key]));
  for (const [id, key] of Object.entries(SIDEBAR_R12_KEYS.admin.entries)) assert.equal(S.ADMIN_LINKS[id].label, key);
  assert.deepEqual(S.ACCOUNT_LINKS.map((l) => [l.id, l.label]), SIDEBAR_R12_KEYS.account.entries.map(([id, key]) => [id, key]));
  for (const l of [S.DASHBOARD_LINK, ...S.SITE_LINKS, ...Object.values(S.ADMIN_LINKS), ...S.ACCOUNT_LINKS]) assert.ok(en[l.label] && fr[l.label], l.label);
  for (const k of ["nav.more", "nav.newTab"]) assert.ok(en[k] && fr[k], k);
  assert.equal(en["nav.more"].includes("{n}"), fr["nav.more"].includes("{n}"));
});

test("who sees the fixed Site entries; Maintenance owns every tab; Extensions owns the pages of unpinned modules", () => {
  assert.deepEqual(S.siteLinks({ canManage: true, editor: true }).map((l) => l.id), ["homeMenu", "appearance", "settings", "redirects"]);
  assert.deepEqual(S.siteLinks({ canManage: false, editor: true }).map((l) => l.id), ["redirects"]);
  assert.deepEqual(S.siteLinks({ canManage: false, editor: false }), []);
  const m = S.adminLink("maintenance", { tabs: ["backup", "updates"], unpinnedPages: [] });
  assert.equal(m.href, "/admin/backup");
  assert.deepEqual(m.also, ["/admin/backup", "/admin/updates"]);
  assert.equal(S.adminLink("maintenance", { tabs: [], unpinnedPages: [] }).href, "/admin/maintenance/content");
  assert.deepEqual(S.adminLink("extensions", { tabs: [], unpinnedPages: ["/admin/instances/i-1"] }).also, ["/admin/modules", "/admin/instances/i-1"]);
  assert.deepEqual(S.adminLink("users", { tabs: [], unpinnedPages: ["/x"] }).also, []);
});

test("entry addresses: a module with content opens its list, another its page, a place page its own address", () => {
  assert.equal(S.entryHref({ id: "i1", key: "blog", content: true }), "/admin/entries?c=blog");
  assert.deepEqual(S.entryAlso({ id: "i1", key: "blog", content: true }), ["/admin/instances/i1"]);
  assert.equal(S.entryHref({ id: "i2", key: "x" }), "/admin/instances/i2");
  assert.equal(S.entryHref({ id: "place:a", place: true, href: "/admin/live/alerts" }), "/admin/live/alerts");
  assert.deepEqual(S.entryTargets({ id: "place:a", place: true, href: "/admin/live/alerts" }), ["/admin/live/alerts"]);
  assert.deepEqual(S.unpinnedPageTargets([{ id: "i3", key: "k", content: true }]), ["/admin/instances/i3", "/admin/entries?c=k"]);
});

test("the pin cap: eight entries, then « More (n) » (never a fold for a single entry)", () => {
  const n = (c) => Array.from({ length: c }, (_, i) => i);
  assert.deepEqual(S.capEntries(n(8)).more, []);
  assert.deepEqual(S.capEntries(n(9)).more, [], "one entry over the cap is shown, not folded");
  const ten = S.capEntries(n(10));
  assert.equal(ten.shown.length, 8);
  assert.deepEqual(ten.more, [8, 9]);
  assert.equal(S.moreStateId("content"), "more-content");
  assert.match(S.moreStateId("community"), /^[a-z][a-z0-9_-]{0,30}$/, "fits the cookie of remembered state");
  for (const id of Object.values(S.SECTION_STATE_ID)) assert.match(id, /^[a-z][a-z0-9_-]{0,30}$/);
  assert.equal(S.initialOf("  camille"), "C");
  assert.equal(S.initialOf(""), "?");
});

test("shell: sticky sidebar of the full height with its own scroll and the account block pinned; the sheet on a phone is a real one", () => {
  const menu = read("src/components/admin/MobileMenu.tsx");
  assert.match(menu, /md:h-dvh/);
  assert.match(menu, /sticky top-0/);
  assert.match(menu, /overflow-y-auto/);
  assert.match(menu, /shrink-0 border-t border-line[^"]*"[^>]*data-testid="admin-sidebar-account"/, "the account block does not scroll away");
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /aria-controls="admin-nav"/);
  assert.match(menu, /e\.key === "Escape"[\s\S]*toggle\.current\?\.focus\(\)/, "Escape closes and returns the focus to the button");
  assert.match(menu, /e\.key !== "Tab"/, "Tab stays inside the sheet");
  assert.match(menu, /document\.body\.style\.overflow/, "the page behind does not scroll");
  assert.match(menu, /min-h-11/);
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.ok(layout.indexOf("<SkipLink") < layout.indexOf("<MobileMenu"), "the skip link stays the first stop");
  assert.ok(layout.indexOf("<footer") > layout.indexOf("<main"), "the licence line sits in the content column, under the page");
  assert.ok(layout.indexOf("</MobileMenu>") < layout.indexOf("<footer"));
});

test("rows are 44 px targets and icons are decorative", () => {
  const link = read("src/components/admin/NavLink.tsx");
  assert.match(link, /flex min-h-11 items-center/);
  assert.doesNotMatch(link, /"block"/, "no more 20 px rows");
  assert.match(link, /MenuIcon/);
  const icon = read("src/components/admin/MenuIcon.tsx");
  assert.match(icon, /aria-hidden="true"/);
  assert.match(icon, /focusable="false"/);
  const group = read("src/components/admin/NavGroup.tsx");
  assert.match(group, /min-h-11/);
  assert.doesNotMatch(group, /▶/, "the chevron is an SVG");
  assert.doesNotMatch(read("src/app/admin/(panel)/layout.tsx"), /\$\{m\.icon\}|🐞/, "no emoji in the sidebar");
});

test("one bug report link in the whole administration shell, in the pinned footer (F-DUP-001); the handler stays", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.equal((layout.match(/<BugReportLink/g) ?? []).length, 1);
  assert.ok(layout.indexOf("<BugReportLink") > layout.indexOf("footer={("));
  assert.ok(layout.indexOf("<BugReportLink") < layout.indexOf("</MobileMenu>"));
  for (const f of ["updates/page.tsx", "assistants/page.tsx"]) assert.doesNotMatch(read(`src/app/admin/(panel)/${f}`), /BugReportLink/, f);
});

test("the cookie of remembered state keeps its format, and the new section ids fit it", async () => {
  const { parseNavState, serializeNavState } = await import("@/core/modules/menuPlacement");
  const state = { content: false, site: true, "more-content": true, "g-live": false, connections: true };
  assert.deepEqual(parseNavState(serializeNavState(state)), state);
});
