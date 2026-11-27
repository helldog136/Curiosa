// The new tree of the admin menu (C2b of the admin redesign, ADR 0011): Live, Calendar and Overlays inside Tools; « Accounts and connections » replaces the Networks
// group and the Connections section; Team and Roles are two entries; the entry of the installed pieces is called « Modules ». Nothing is removed: every page stays reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const M = await import("@/core/modules/menuPath");
const S = await import("@/core/adminSidebar");
const L = await import("@/core/adminLinks");
const A = await import("@/core/adminAccess");
const { isCurrent } = await import("../../src/components/admin/navCurrent.ts");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));

const item = (id, path, over = {}) => ({ id, name: id, badge: 0, error: false, placement: "menu", menuPath: path.split(".").map((p) => ({ id: p, text: p })), connector: false, moduleId: id, ...over });

test("the labels of the new tree, in both languages (one word « module », neutral writing)", () => {
  assert.deepEqual([en["nav.extensions"], fr["nav.extensions"]], ["Modules", "Modules"]);
  assert.deepEqual([en["nav.users"], fr["nav.users"]], ["Team", "Équipe"]);
  assert.deepEqual([en["nav.roles"], fr["nav.roles"]], ["Roles", "Rôles"]);
  assert.deepEqual([en["nav.accounts"], fr["nav.accounts"]], ["Accounts and connections", "Comptes et connexions"]);
  assert.deepEqual([en["nav.overlayCustom"], fr["nav.overlayCustom"]], ["Overlay pages", "Pages d'overlay"]);
  for (const k of ["connections.intro", "connections.emptyTitle", "connections.emptyAction", "connections.emptyHelp"]) {
    assert.ok(en[k] && fr[k], k);
    assert.ok(!/[!]|veuillez|please/i.test(en[k] + fr[k]), `${k}: no exclamation mark, no « please »`);
    assert.ok(!/pour l'instant|for now|normally|normalement/i.test(en[k] + fr[k]), `${k}: no conditional wording (R33)`);
  }
});

test("the entries of Site and Administration, in the order of the plan", () => {
  assert.deepEqual(S.siteLinks({ canManage: true, editor: true }).map((l) => l.id), ["homeMenu", "appearance", "settings", "redirects"]);
  assert.equal(S.CONNECTIONS_LINK.href, "/admin/networks");
  assert.equal(S.CONNECTIONS_LINK.label, "nav.accounts");
  assert.deepEqual(Object.keys(S.ADMIN_LINKS), ["extensions", "assistants", "users", "roles", "maintenance"]);
  assert.equal(S.ADMIN_LINKS.extensions.href, "/admin/extensions", "the route of the modules page is kept");
  assert.equal(S.ADMIN_LINKS.roles.href, L.ROLES_HREF);
  assert.equal(L.ROLES_HREF, "/admin/users/roles", "(C5b) the roles area has its own page");
  assert.equal(S.ADMIN_LINKS.users.exact, true, "the Team entry does not stay lit on the Roles page below it");
});

test("Team and Roles are two pages: each entry is lit on its own page only", () => {
  const users = S.ADMIN_LINKS.users, roles = S.ADMIN_LINKS.roles;
  const cur = (l, path) => isCurrent(l.href, path, "", { also: [...l.also], ...(l.exact ? { exact: true } : {}) });
  assert.equal(cur(users, "/admin/users"), true);
  assert.equal(cur(roles, "/admin/users"), false);
  assert.equal(cur(users, "/admin/users/roles"), false, "the Team entry lets go on the Roles page");
  assert.equal(cur(roles, "/admin/users/roles"), true);
  // An entry without a fragment keeps its old behaviour, with or without a hash given.
  assert.equal(isCurrent("/admin/appearance", "/admin/appearance", "", { hash: "fonts" }), true);
  assert.equal(isCurrent("/admin/appearance", "/admin/appearance", ""), true);
});

test("Live, Calendar and Overlays nest inside Tools; the Networks group and the Connections section move to the Accounts and connections page", () => {
  const tree = M.buildMenuTree([
    item("a", "live"), item("b", "calendar"), item("c", "obs"), item("d", "networks.twitch"), item("e", "networks"), item("f", "boutique"), item("g", "connections"), item("h", "connections.hooks"),
  ], "en");
  const arranged = M.arrangeGroups(tree.groups);
  assert.deepEqual(arranged.tools.map((g) => g.id), ["live", "calendar", "obs"], "the order of the tree");
  assert.deepEqual(arranged.connections.map((g) => g.id), ["networks"]);
  assert.deepEqual(arranged.rest.map((g) => g.id), ["boutique"], "a group a module invented keeps its own place");
  const blocks = M.connectionBlocks(tree, [item("p", "x")]);
  assert.deepEqual(blocks.map((b) => [b.title, b.entries.map((e) => e.id)]), [[null, ["p", "g", "e"]], ["Hooks", ["h"]], ["Twitch", ["d"]]], "nothing is dropped: own entries first, then one block per sub-group");
  assert.deepEqual(M.connectionBlocks(M.buildMenuTree([], "en"), []), [], "no entry, no block");
  assert.deepEqual([...M.TOOLS_SUBGROUPS], ["live", "calendar", "obs"]);
});

test("the access table knows the index of a group, as a page of any member", () => {
  const rule = A.ruleFor("/admin/networks");
  assert.equal(rule?.need, "member");
  assert.ok(rule.files.includes("(panel)/[group]/page.tsx"));
  assert.equal(A.ruleFor("/admin/zzgroup", { placeGroups: ["live"] }), null, "an unknown group is closed");
  assert.equal(A.ruleFor("/admin/users")?.need, "admin", "a core page name is never read as a group");
  assert.equal(A.needOf("/admin/networks/twitch"), "member", "the pages below it are still place pages");
});

test("layout and page: the entry is drawn from the model, the index lists what the person may open", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /CONNECTIONS_LINK, also: connectionLinks\.flatMap\(entryTargets\)/);
  assert.match(layout, /canOpen\(user, CONNECTIONS_LINK\.href, owners\)/, "the access table decides, as for every entry");
  const page = read("src/app/admin/(panel)/[group]/page.tsx");
  assert.match(page, /adminCtx\("member"\)/);
  assert.match(page, /generateMetadata/);
  assert.match(page, /notFound\(\)/, "an unknown group, or one with nothing to open, is a 404");
  const index = read("src/core/modules/connectionsIndex.ts");
  assert.match(index, /openableModuleEntries\(user, everyNav, owners\)/, "the same rule as the sidebar for the entries of modules");
  assert.match(index, /canOpen\(user, p\.href, owners\)/, "the same rule as the sidebar for place pages");
});
