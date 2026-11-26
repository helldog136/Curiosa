// Ratchet on the administration map (C0b of the admin redesign): no page, handler, redirect, sidebar entry, guard or module placement can be
// added, removed or changed unnoticed. The map is DERIVED from the code by scripts/admin-map.mjs; the baselines are committed files.
//   A difference fails with the exact lines. If the change is intended (and the plan says so), regenerate in the same pull request:
//     node scripts/admin-map.mjs --write-baseline                              (core)
//     node scripts/admin-map.mjs --extras ../curiosa-extras --write-baseline   (modules, when you have the checkout)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BASELINE_FILE, MODULES_BASELINE_FILE, REPO_ROOT, buildAdminMap, diffCore, diffModules, guardOf, isRedirectPage, routeOf } from "../../scripts/admin-map.mjs";
import { findExtrasDir } from "../helpers/extras.mjs";

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
const HOW = "If this is intended, run `node scripts/admin-map.mjs --write-baseline` and commit the new baseline in the same pull request.";

// Old addresses (mails, docs, bookmarks, AI messages) that must keep answering, whatever the redesign does.
const NEVER_REMOVED = [
  "/admin/ai-visibility", "/admin/catalogue", "/admin/catalogue/details", "/admin/integrations", "/admin/overlays", "/admin/modules", "/admin/mcp", "/admin/mcp/[id]", "/admin/maintenance-ia",
  "/admin/login", "/admin/setup", "/admin/invitation", "/admin/forgot-password", "/admin/reset-password", "/admin/choose-password", "/admin/no-access",
  "/api/admin/upload (handler)", "/api/admin/skin-custom/upload (handler)", "/admin/overlay-pages/[id]/preview (handler)",
];

test("the core map matches the committed baseline (routes, sidebar, access)", async () => {
  const map = await buildAdminMap();
  const diff = diffCore(readJson(BASELINE_FILE), map);
  assert.deepEqual(diff, [], `The administration map changed:\n${diff.join("\n")}\n${HOW}`);
});

test("the sidebar reader sees every <NavLink> the layout writes (a link it cannot read must not hide)", async () => {
  const { core, sidebarParse } = await buildAdminMap();
  // Tags built from data (`key={m.id}` module entries, `entryLink`) are not literal links; every other tag has to be read.
  assert.ok(sidebarParse.literalLinks >= 10, "the reader found almost no sidebar link: has the layout markup changed?");
  assert.ok(sidebarParse.layoutNavLinkTags - sidebarParse.literalLinks <= 3, `the layout has ${sidebarParse.layoutNavLinkTags} <NavLink> tags, the reader understood ${sidebarParse.literalLinks}: teach scripts/admin-map.mjs the new form`);
  for (const e of core.sidebar.entries) assert.ok(!e.href.includes("{"), `unresolved address in the sidebar: ${e.label} ${e.href}`);
});

test("every sidebar address is an existing route, or a place route, or the public site", async () => {
  const { core } = await buildAdminMap();
  const patterns = Object.keys(core.routes).map((r) => r.replace(/ .*$/, "")).map((r) => new RegExp(`^${r.replace(/[.*+?^$|(){}\\]/g, "\\$&").replace(/\\\[\\\[\\\.\\\.\\\.\w+\\\]\\\]/g, "(?:/.*)?").replace(/\\\[[^\]]+\\\]/g, "[^/]+")}$`));
  for (const e of core.sidebar.entries) for (const href of [e.href, ...e.also]) {
    const bare = href.split(/[?#]/)[0];
    if (e.external || bare === "/") continue;
    assert.ok(patterns.some((p) => p.test(bare)), `sidebar entry ${e.label} points to ${href}, which no route answers`);
  }
});

test("addresses that must never disappear are still there", async () => {
  const { core } = await buildAdminMap();
  for (const r of NEVER_REMOVED) assert.ok(r in core.routes, `${r} disappeared (old addresses and uploads are never removed)`);
  for (const r of ["/admin/ai-visibility", "/admin/mcp", "/admin/mcp/[id]", "/admin/maintenance-ia"]) assert.equal(core.routes[r].kind, "redirect", `${r} must stay a redirect`);
});

test("the file reader: route groups vanish, slots and interceptors are modal variants", () => {
  assert.deepEqual(routeOf(["(panel)", "users", "page.tsx"].join(path.sep), "/admin"), { route: "/admin/users", group: "panel", slot: null, intercepts: false });
  assert.equal(routeOf(["(panel)", "extensions", "@modal", "(..)modules", "[id]", "page.tsx"].join(path.sep), "/admin").route, "/admin/modules/[id]");
  assert.equal(routeOf(["(panel)", "extensions", "@modal", "(..)modules", "[id]", "page.tsx"].join(path.sep), "/admin").slot, "modal");
  assert.equal(guardOf('const c = await adminCtx({ right: "core:updates" });'), "right:core:updates");
  assert.equal(guardOf('const c = await adminCtx("editor");'), "editor");
  assert.equal(isRedirectPage('redirect("/x");'), true);
  assert.equal(isRedirectPage("return <div/>; redirect('/x')"), false);
});

const extras = findExtrasDir();
const baselineExists = fs.existsSync(path.join(REPO_ROOT, MODULES_BASELINE_FILE));
test("the modules map matches its baseline", { skip: !extras ? "no modules checkout (set CURIOSA_EXTRAS_DIR)" : !baselineExists ? "no modules baseline" : false }, async () => {
  const map = await buildAdminMap({ extrasDir: extras });
  const diff = diffModules(readJson(MODULES_BASELINE_FILE), map);
  assert.deepEqual(diff, [], `The modules map changed:\n${diff.join("\n")}\nRegenerate with \`node scripts/admin-map.mjs --extras <modules checkout> --write-baseline\` once the change is intended.`);
});

test("the fixture modules give a stable placement map (derivation self-test)", async () => {
  const fixtures = path.join(REPO_ROOT, "tests/fixtures/extras");
  const { modules } = await buildAdminMap({ extrasDir: fixtures });
  const ids = Object.keys(modules.modules);
  assert.ok(ids.includes("blog") && ids.includes("hero"));
  for (const id of ids) {
    const m = modules.modules[id];
    assert.equal(m.ownSidebarEntry, m.placement === "menu" && !m.fullyPlaced, id);
  }
  for (const [route, p] of Object.entries(modules.placeRoutes)) assert.ok(route.startsWith(`/admin/${p.group}/${p.page}`), route);
});
