// The access table (src/core/adminAccess.ts, C2a of the admin redesign, rule R35): one table of what each admin page asks, used by the menu, the dashboard,
// the shortcuts of the modules and the search. The table never replaces the gate of a page: this test READS each page and fails when the table disagrees with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const A = await import("@/core/adminAccess");
const Acc = await import("@/core/auth/access");
const { rightsCatalogue, systemRights } = await import("@/core/auth/rights");
const D = await import("@/core/adminDenial");
const S = await import("@/core/adminSidebar");
const { administrationEntries, maintenanceTabs } = await import("@/core/modules/adminMenu");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));

const ROOT = "src/app/admin";
const CATALOGUE = rightsCatalogue([{ moduleId: "demo", name: { en: "Demo", fr: "Démo" }, rights: [{ id: "moderate", label: { en: "Moderate", fr: "Modérer" } }] }]);

/** A signed-in person (fake names only). `extra`: rights added to those of the level (a custom role has level "none"). */
function person(name, level, extra = [], over = {}) {
  const rights = new Set([...systemRights(level, CATALOGUE), ...extra]);
  return { id: `u-${name}`, email: `${name}@example.test`, name, level, roles: [level], rights, locale: null, advanced: true, totp: true, passkeys: 0, twoFactor: true, needsTwoFactor: false, mustChangePassword: false, ...over };
}
const OWNER = person("Camille", "owner");
const COORD = person("etoile_nord", "coordinator");
const ADMIN = person("lune_douce", "admin");
const EDITOR = person("Camille_editor", "editor");
const ENTRIES_ONLY = person("custom_entries", "none", ["core:entries.edit"]);
const DEMO_ONLY = person("custom_demo", "none", ["demo:open"]);
const NOBODY = person("custom_empty", "none", []);
const PEOPLE = { OWNER, COORD, ADMIN, EDITOR, ENTRIES_ONLY, DEMO_ONLY, NOBODY };
const OWNERS = A.ownersOf([{ id: "i-1", moduleId: "demo" }, { id: "i-2", moduleId: "other" }]);

// ─── The pages ──────────────────────────────────────────────────────────────

/** Every `page.tsx` of the panel with a sample address (a dynamic segment gets a name). Interception folders (`@modal`) and the sign-in pages are not menu targets. */
function panelPages() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx") out.push(p);
    }
  })(path.join(ROOT, "(panel)"));
  return out
    .filter((p) => !p.includes("@modal"))
    .map((p) => {
      const rel = path.relative(path.join(ROOT, "(panel)"), path.dirname(p)).split(path.sep).filter((s) => s !== "" && !/^\(.*\)$/.test(s));
      const segs = rel.filter((s) => !s.startsWith("[[")).map((s) => (s === "[group]" ? "live" : s === "[page]" ? "zzpage" : s.startsWith("[") ? "x1" : s));
      return { file: p, href: `/admin${segs.length ? `/${segs.join("/")}` : ""}` };
    });
}

/** What a source asks of `adminCtx(...)`: the first argument of each call, read as text and turned into a need. */
function needsIn(file) {
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/adminCtx\(\s*([^;]*?)\)\s*;/g)) {
    const [first, ...rest] = m[1].split(/,\s*(?=\{\s*allow)/);
    const arg = first.trim();
    const need = arg === "OVERLAY_NEED" ? "admin" : /^"(member|admin|editor|owner)"$/.test(arg) ? arg.slice(1, -1) : /^\{ right: "([^"]+)" \}$/.test(arg) ? { right: arg.match(/"([^"]+)"/)[1] } : `?${arg}`;
    out.push({ need, unenrolled: rest.join(",").includes("allowUnenrolled"), forced: rest.join(",").includes("allowForced") });
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test("the table has no duplicate pattern, and every row has a need the gate understands", () => {
  const seen = new Set();
  for (const r of A.ACCESS_RULES) {
    assert.ok(!seen.has(r.pattern), `duplicate ${r.pattern}`);
    seen.add(r.pattern);
    assert.ok(r.need === "member" || r.need === "admin" || r.need === "editor" || r.need === "owner" || r.need === "instance" || (typeof r.need === "object" && /^[a-z]+:[a-z.]+$/.test(r.need.right)), r.pattern);
    assert.ok(r.pattern.startsWith("/admin"), r.pattern);
  }
});

test("every page of the panel has a row, and the row says what the page asks (the page is the authority)", () => {
  const pages = panelPages();
  assert.ok(pages.length > 40, "the scan found the pages");
  for (const { file, href } of pages) {
    const rule = A.ruleFor(href);
    assert.ok(rule, `${file}: no row of the table for ${href}`);
    const asks = needsIn(file);
    if (asks.length === 0) {
      // A page without its own check either hands over to a view of its folder, or is an old address that redirects (the target asks its own gate).
      const dir = path.dirname(path.relative(ROOT, file));
      const handsOver = rule.files.some((f) => path.dirname(f) === dir);
      assert.ok(handsOver || /redirect/.test(read(file)), `${file}: no gate and no row that reads its view`);
      continue;
    }
    assert.ok(rule.files.includes(path.relative(ROOT, file).split(path.sep).join("/")), `${file}: not listed in the row ${rule.pattern}`);
  }
});

test("each file named by a row asks exactly the need of that row (and nothing looser anywhere in it)", () => {
  for (const rule of A.ACCESS_RULES) {
    for (const f of rule.files) {
      const file = path.join(ROOT, f);
      assert.ok(fs.existsSync(file), `${rule.pattern}: ${f} does not exist`);
      const asks = needsIn(file);
      assert.ok(asks.length > 0, `${f}: no adminCtx call found`);
      for (const a of asks) {
        assert.ok(same(a.need, rule.need === "instance" ? "member" : rule.need), `${f} asks ${JSON.stringify(a.need)} but the row ${rule.pattern} says ${JSON.stringify(rule.need)}`);
        assert.equal(a.unenrolled, rule.allowUnenrolled === true, `${f}: allowUnenrolled differs from the row ${rule.pattern}`);
        assert.equal(a.forced, false, `${f}: allowForced is never menu material`);
      }
    }
  }
});

test("the interception windows of the Extensions section ask for the administration level, like the pages they open over", () => {
  for (const f of ["(panel)/extensions/@modal/(..)instances/[id]/page.tsx", "(panel)/extensions/@modal/(..)modules/[id]/page.tsx", "(panel)/extensions/add/@modal/(.)details/page.tsx"]) {
    assert.deepEqual(needsIn(path.join(ROOT, f)).map((a) => a.need), ["admin"], f);
  }
});

test("the instance page asks `<module>:open` after the member check: the table says so", () => {
  const view = read(`${ROOT}/(panel)/instances/[id]/InstanceView.tsx`);
  assert.match(view, /adminCtx\("member"\)[\s\S]*if \(!can\(user, `\$\{mod\.manifest\.id\}:open`\)\)/);
  assert.equal(A.needOf("/admin/instances/i-1"), "instance");
});

// ─── The answers, person by person ──────────────────────────────────────────

test("the answer is the answer of the gate: every row, every kind of person, the need read from the page source", () => {
  for (const rule of A.ACCESS_RULES) {
    const probe = rule.pattern.replace("/**", "/x1").replace(":id", "i-1").replace(":group", "live").replace(":page", "zzpage");
    const asks = rule.files.length ? needsIn(path.join(ROOT, rule.files[0]))[0] : { need: rule.need, unenrolled: false };
    for (const [who, u] of Object.entries(PEOPLE)) {
      for (const state of [{}, { needsTwoFactor: true }, { mustChangePassword: true }]) {
        const v = { ...u, ...state };
        const expected = asks.need === "instance"
          ? false
          : Acc.accessGate(v, asks.need, asks.unenrolled ? { allowUnenrolled: true } : {}) === "ok";
        const got = A.canOpen(v, probe, OWNERS);
        if (rule.need === "instance") assert.equal(A.canOpen(v, "/admin/instances/i-1", OWNERS), Acc.accessGate(v, { right: "demo:open" }) === "ok", `${who} ${JSON.stringify(state)} instance`);
        else assert.equal(got, expected, `${who} ${JSON.stringify(state)} ${probe}`);
      }
    }
  }
});

// What each level opens, written out by hand (a second opinion on the table, not derived from it).
const OPENS = {
  "/admin": ["OWNER", "COORD", "ADMIN", "EDITOR", "ENTRIES_ONLY", "DEMO_ONLY"],
  "/admin/account": ["OWNER", "COORD", "ADMIN", "EDITOR", "ENTRIES_ONLY", "DEMO_ONLY"],
  "/admin/entries?c=blog": ["OWNER", "COORD", "ADMIN", "EDITOR", "ENTRIES_ONLY"],
  "/admin/drafts": ["OWNER", "COORD", "ADMIN", "EDITOR", "ENTRIES_ONLY"],
  "/admin/redirects": ["OWNER", "COORD", "ADMIN", "EDITOR", "ENTRIES_ONLY"],
  "/admin/settings#privacy": ["OWNER", "COORD", "ADMIN"],
  "/admin/settings/address": ["OWNER", "COORD", "ADMIN"],
  "/admin/navigation": ["OWNER", "COORD", "ADMIN"],
  "/admin/navigation/header": ["OWNER", "COORD", "ADMIN"],
  "/admin/extensions/updates": ["OWNER", "COORD", "ADMIN"],
  "/admin/overlay-pages/p1": ["OWNER", "COORD", "ADMIN"],
  "/admin/overlay-pages/p1/skin": ["OWNER", "COORD", "ADMIN"],
  "/admin/appearance": ["OWNER", "COORD", "ADMIN"],
  "/admin/home": ["OWNER", "COORD", "ADMIN"],
  "/admin/social": ["OWNER", "COORD", "ADMIN"],
  "/admin/extensions": ["OWNER", "COORD", "ADMIN"],
  "/admin/extensions/add": ["OWNER", "COORD", "ADMIN"],
  "/admin/modules/demo": ["OWNER", "COORD", "ADMIN"],
  "/admin/overlay-pages": ["OWNER", "COORD", "ADMIN"],
  "/admin/users": ["OWNER", "COORD", "ADMIN"],
  "/admin/maintenance/content": ["OWNER", "COORD", "ADMIN"],
  "/admin/assistants": ["OWNER", "COORD"],
  "/admin/backup": ["OWNER", "COORD"],
  "/admin/updates": ["OWNER", "COORD"],
  "/admin/maintenance/legacy": ["OWNER", "COORD"],
  "/admin/audit": ["OWNER", "COORD"],
  "/admin/instances/i-1": ["OWNER", "COORD", "ADMIN", "DEMO_ONLY"],
  "/admin/live/alerts": ["OWNER", "COORD", "ADMIN", "EDITOR", "ENTRIES_ONLY", "DEMO_ONLY"],
};

test("the role matrix: owner, coordination, administration, editorial, and custom roles with one right", () => {
  for (const [href, who] of Object.entries(OPENS)) {
    for (const [name, u] of Object.entries(PEOPLE)) assert.equal(A.canOpen(u, href, OWNERS), who.includes(name), `${name} ${href}`);
  }
  // A person with no access at all opens nothing in the admin, not even the dashboard (they are sent to "no access").
  for (const href of Object.keys(OPENS)) assert.equal(A.canOpen(NOBODY, href, OWNERS), false, href);
});

test("an instance page opens only for someone who holds the access of the module that owns it; an unknown instance opens for nobody", () => {
  assert.equal(A.canOpen(DEMO_ONLY, "/admin/instances/i-1", OWNERS), true);
  assert.equal(A.canOpen(DEMO_ONLY, "/admin/instances/i-2", OWNERS), false, "another module");
  assert.equal(A.canOpen(DEMO_ONLY, "/admin/instances/i-9", OWNERS), false, "unknown instance");
  assert.equal(A.canOpen(OWNER, "/admin/instances/i-9", OWNERS), false, "unknown instance, even for the owner (the page says not found)");
  assert.equal(A.canOpen(OWNER, "/admin/instances/i-1"), false, "no context, no answer");
  assert.equal(A.canOpen(EDITOR, "/admin/instances/i-1?tab=use", OWNERS), false, "an editor has no `open` on a module that gives it to the administration only");
});

test("the public site is open to anyone; what the table does not know is closed (deny by default)", () => {
  assert.equal(A.canOpen(null, "/"), true);
  assert.equal(A.canOpen(OWNER, "/"), true);
  for (const href of ["/admin/nope", "/admin/backup/restore", "/admin/%62ackup/restore", "/admin/%75sers/x", "/admin/upload/x", "/admin/zzgroup/zzpage", "/admin/maintenance/foo", "/admin/users/roles/x", "//evil.test/admin", "https://evil.test/admin", "admin/users", "", "/admin/../admin/users", "/admin/%2e%2e/users", "/admin\\users", "/api/admin/backup", "/blog", "javascript:alert(1)", "/admin/\u0000"]) {
    assert.equal(A.canOpen(OWNER, href, OWNERS), false, JSON.stringify(href));
  }
  assert.equal(A.canOpen(null, "/admin"), false, "nobody signed in");
  assert.equal(A.canOpen(undefined, "/admin"), false);
});

test("query and hash do not change the answer; a trailing slash does not hide a gate", () => {
  for (const [href, base] of [["/admin/backup?x=1#y", "/admin/backup"], ["/admin/backup/", "/admin/backup"], ["/admin/users?tab=roles", "/admin/users"], ["/admin/assistants?tab=requests", "/admin/assistants"]]) {
    for (const u of Object.values(PEOPLE)) assert.equal(A.canOpen(u, href, OWNERS), A.canOpen(u, base, OWNERS), href);
  }
  assert.equal(A.canOpen(EDITOR, "/admin/backup/?home=/admin", OWNERS), false);
});

test("a core page name never falls through to the place pages (their row is only for a group that no core page owns)", () => {
  for (const seg of ["backup", "users", "settings", "audit", "updates", "maintenance", "account", "extensions", "redirects"]) {
    const rule = A.ruleFor(`/admin/${seg}/zzpage`);
    assert.ok(!rule || !rule.place, `${seg} must not be read as a place group`);
  }
  assert.equal(A.canOpen(EDITOR, "/admin/backup/zzpage", OWNERS), false);
  assert.equal(A.canOpen(EDITOR, "/admin/live/alerts", OWNERS), true, "a real place page is a page of the member");
});

test("openable keeps the order and drops what this person cannot open", () => {
  const items = [{ href: "/admin/users", id: 1 }, { href: "/admin/redirects", id: 2 }, { href: "/admin/audit", id: 3 }, { href: "/admin", id: 4 }];
  assert.deepEqual(A.openable(EDITOR, items).map((i) => i.id), [2, 4]);
  assert.deepEqual(A.openable(ADMIN, items).map((i) => i.id), [1, 2, 4]);
  assert.deepEqual(A.openable(COORD, items).map((i) => i.id), [1, 2, 3, 4]);
});

// ─── The menu: nothing the gate refuses, nothing removed for who can open it ─

const ids = (l) => l.map((x) => x.id);
const LEVELS = [["owner", OWNER], ["coordinator", COORD], ["admin", ADMIN], ["editor", EDITOR]];

test("the fixed menu of each level: every entry shown today is openable, and every openable fixed entry is shown (nothing removed)", () => {
  for (const [level, u] of LEVELS) {
    const canManage = Acc.hasRole(u, "admin");
    const editor = Acc.hasRole(u, "editor");
    const site = S.siteLinks({ canManage, editor });
    for (const l of site) assert.equal(A.canOpen(u, l.href, OWNERS), true, `${level} ${l.id}`);
    for (const l of S.SITE_LINKS) assert.equal(A.canOpen(u, l.href, OWNERS), ids(site).includes(l.id), `${level} ${l.id} is shown exactly when it is openable`);
    const shown = administrationEntries({ role: u.level, advanced: true, overlays: false }).filter((e) => e !== "overlays");
    const tabs = maintenanceTabs({ role: u.level, advanced: true });
    for (const id of shown) {
      const link = S.adminLink(id, { tabs, unpinnedPages: [] });
      assert.equal(A.canOpen(u, link.href, OWNERS), true, `${level} ${id} -> ${link.href}`);
      // Maintenance also owns every tab it lists.
      for (const tab of link.also) if (id === "maintenance") assert.equal(A.canOpen(u, tab, OWNERS), true, `${level} tab ${tab}`);
    }
    for (const id of Object.keys(S.ADMIN_LINKS)) {
      const link = S.adminLink(id, { tabs, unpinnedPages: [] });
      if (id === "maintenance") assert.equal(A.canOpen(u, link.href, OWNERS), tabs.length > 0, `${level} maintenance`);
      // (C2b) Roles is a tab of the team page: the table answers for the page (an admin opens it), the entry is stricter (the tab needs `core:roles`).
      else if (id === "roles") assert.equal(shown.includes(id), Acc.can(u, "core:roles") && A.canOpen(u, link.href, OWNERS), `${level} roles is shown exactly to those who hold core:roles`);
      else assert.equal(A.canOpen(u, link.href, OWNERS), shown.includes(id), `${level} ${id} is shown exactly when it is openable`);
    }
    for (const l of [S.DASHBOARD_LINK, ...S.ACCOUNT_LINKS]) assert.equal(A.canOpen(u, l.href, OWNERS), true, `${level} ${l.id}`);
  }
});

test("the `need` written in the sidebar model agrees with the table (no drift between the two lists)", () => {
  const rank = { member: 0, editor: 1, admin: 2 };
  for (const l of [S.DASHBOARD_LINK, ...S.SITE_LINKS, ...S.ACCOUNT_LINKS]) {
    if (l.href === "/") continue;
    assert.equal(A.needOf(l.href), l.need === "member" ? "member" : l.need, l.id);
  }
  // The Administration entries are filtered by `administrationEntries` (level or right): the table must be at least as strict as the model says.
  assert.equal(A.needOf(S.ADMIN_LINKS.extensions.href), "admin");
  assert.equal(A.needOf(S.ADMIN_LINKS.users.href), "admin");
  assert.deepEqual(A.needOf(S.ADMIN_LINKS.assistants.href), { right: "core:mcp.tokens" });
  assert.ok(rank.admin > rank.member);
});

test("module entries: the menu rule AND the table; an entry the table refuses is never added, one the rule refuses is never added either", () => {
  const items = [
    { id: "i-blog", key: "blog", content: true, moduleId: "blog" },
    { id: "i-1", key: "demo", content: false, moduleId: "demo" },
    { id: "i-2", key: "other", content: false, moduleId: "other" },
  ];
  const keys = (u) => A.openableModuleEntries(u, items, A.ownersOf(items)).map((i) => i.id);
  assert.deepEqual(keys(OWNER), ["i-blog", "i-1", "i-2"]);
  assert.deepEqual(keys(ADMIN), ["i-blog", "i-1", "i-2"].filter((id) => Acc.can(ADMIN, id === "i-blog" ? "core:entries.edit" : `${items.find((i) => i.id === id).moduleId}:open`)));
  assert.deepEqual(keys(ENTRIES_ONLY), ["i-blog"]);
  assert.deepEqual(keys(DEMO_ONLY), ["i-1"]);
  assert.deepEqual(keys(NOBODY), []);
  assert.deepEqual(keys({ ...ADMIN, needsTwoFactor: true }), []);
});

// ─── The consumers read the table ───────────────────────────────────────────

test("the sidebar, the dashboard, the shortcuts, the cards and the search all ask the table", () => {
  const layout = read(`${ROOT}/(panel)/layout.tsx`);
  assert.match(layout, /openableModuleEntries\(user, everyNav, owners\)/);
  assert.match(layout, /openable\(user, siteLinks\(/);
  assert.match(layout, /\.filter\(\(\{ link \}\) => canOpen\(user, link\.href, owners\)\)/);
  assert.match(layout, /ACCOUNT_LINKS\.map\(\(l\) => \(canOpen\(user, l\.href, owners\) \? coreLink\(l\) : null\)\)/);
  assert.match(layout, /canOpen\(user, p\.href, owners\)/, "place pages");
  const page = read(`${ROOT}/(panel)/page.tsx`);
  assert.match(page, /openableModuleEntries\(user, allNav, owners\)/);
  const blocks = read("src/components/admin/dashboard/Blocks.tsx");
  assert.match(blocks, /openable\(c\.user, mergeTodo\(core, mods\), c\.owners\)/);
  assert.match(blocks, /openable\(c\.user, mergeQuick\(/);
  const mods = read("src/core/dashboard/modules.ts");
  assert.equal((mods.match(/canOpen\(env\.viewer, /g) ?? []).length >= 4, true, "tasks, shortcuts, cards and their rows");
  assert.match(read("src/core/modules/placeSearchLoad.ts"), /entries\.filter\(\(e\) => canOpen\(user, e\.href, owners\)\)/);
  assert.match(read("src/app/api/admin/content-search/route.ts"), /canOpen\(user, ENTRIES_HREF\)/);
});

test("dashboard contributions of the modules: a contribution that leads to a page the person cannot open is not shown", async () => {
  const M = await import("@/core/dashboard/modules");
  const { parseManifest } = await import("@/core/modules/manifest");
  const words = (t) => ({ fr: t, en: t });
  const decl = {
    tasks: [{ id: "t1", label: words("{n} a"), href: "?tab=x" }, { id: "t2", label: words("{n} b"), href: "/admin/users", right: "moderate" }],
    quickActions: [{ id: "q1", label: words("Add one"), href: "/admin/entries/new?c=demo" }, { id: "q2", label: words("Open the team"), href: "/admin/users", right: "moderate" }, { id: "q3", label: words("Back up"), href: "/admin/backup", right: "moderate" }],
    cards: [{ id: "c1", type: "counter", title: words("Backups"), href: "/admin/backup", right: "moderate" }, { id: "c2", type: "list", title: words("Rows"), empty: words("None"), right: "moderate" }],
  };
  const r = parseManifest({ apiVersion: 2, id: "demo", name: words("Demo"), version: "1.0.0", icon: "T", permissions: [], rights: [{ id: "moderate", label: words("Moderate") }], dashboard: decl });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const a = { instance: { id: "i-1", key: "demo", moduleId: "demo", names: { fr: "Demo" }, descriptions: {} }, mod: { manifest: r.manifest, def: { dashboard: { tasks: { t1: () => 2, t2: () => 3 }, cards: { c1: () => ({ value: 1 }), c2: () => ({ rows: [{ title: "Row one", href: "/admin/users" }, { title: "Row two", href: "?tab=y" }] }) } } }, locales: {}, row: {} } };
  const env = (viewer) => ({ viewer, locale: "en", defaultLocale: "en", active: async () => [a], contextFor: async () => ({}) });
  M.resetDashboardMemo();
  // A person with the access of the module and its right, but not the administration level: no link to a page they would be refused.
  const mod = person("custom_mod", "none", ["demo:open", "demo:moderate", "core:entries.edit"]);
  assert.deepEqual((await M.moduleTasks(env(mod))).map((t) => t.id), ["t1"]);
  assert.deepEqual((await M.moduleActions(env(mod))).map((t) => t.id), ["q1"]);
  assert.deepEqual((await M.moduleCards(env(mod))).map((c) => c.id), ["c2"]);
  const rows = (await M.moduleCards(env(mod)))[0].data.rows;
  assert.equal(rows[0].href, undefined, "a row link to a page they cannot open is only text");
  assert.equal(rows[1].href, "/admin/instances/i-1?tab=y");
  M.resetDashboardMemo();
  const admin = person("lune_douce", "admin", ["demo:moderate"]);
  assert.deepEqual((await M.moduleTasks(env(admin))).map((t) => t.id).sort(), ["t1", "t2"]);
  assert.deepEqual((await M.moduleActions(env(admin))).map((t) => t.id), ["q1", "q2"], "the backup page asks a right the administration does not hold");
  M.resetDashboardMemo();
  assert.deepEqual((await M.moduleActions(env(person("etoile_nord", "coordinator", ["demo:moderate"])))).map((t) => t.id), ["q1", "q2", "q3"]);
});

// ─── The refusal names what is missing ──────────────────────────────────────

const tr = (dict) => (key, vars = {}) => String(dict[key] ?? `!${key}`).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

test("the refusal notice names the missing access in plain words, in both languages, and never a person", () => {
  const needs = [["owner"], ["admin"], ["editor"], [{ right: "core:backup" }], [{ right: "core:updates" }], [{ right: "core:security" }], [{ right: "core:mcp.tokens" }], [{ right: "core:modules.install" }], [{ right: "core:team" }], [{ right: "core:roles" }], [{ right: "core:entries.edit" }], [{ right: "core:entries.publish" }], [{ right: "demo:open" }], [{ right: "demo:moderate" }], [{ right: "core:whatever" }], ["member"], [null]];
  for (const [dict, label] of [[en, "en"], [fr, "fr"]]) {
    const t = tr(dict);
    const seen = new Set();
    for (const [need] of needs.map((n) => n)) {
      const text = D.denialText(t, need);
      assert.ok(text.length > 10 && !text.includes("!") && !/\{\w+\}/.test(text), `${label} ${JSON.stringify(need)}: ${text}`);
      assert.doesNotMatch(text, /@|example\.test|Camille|etoile_nord|lune_douce/, "no person, no address");
      seen.add(text);
    }
    assert.ok(seen.size >= 12, `${label}: the sentences differ by need`);
  }
  const t = tr(en);
  assert.match(D.denialText(t, "admin"), /Administration/);
  assert.match(D.denialText(t, { right: "core:backup" }), /Backup/);
  assert.match(D.denialText(t, { right: "core:security" }), /Activity log/);
  assert.match(D.denialText(tr(fr), { right: "core:mcp.tokens" }), /Assistants IA/);
  assert.equal(D.denialText(t, "member"), en["error.denied"], "no precise need: the generic sentence");
  // What the address says is never part of the sentence: only a closed list of needs is worded.
  assert.equal(D.denialText(t, { right: "core:<script>alert(1)</script>" }), en["denied.other"]);
});

test("denied.* texts: both languages, same {variables}, no exclamation mark, no shouting", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("denied."));
  assert.ok(keys.length >= 14);
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("denied.")).sort(), keys.sort());
  for (const k of keys) {
    assert.deepEqual((en[k].match(/\{\w+\}/g) ?? []).sort(), (fr[k].match(/\{\w+\}/g) ?? []).sort(), k);
    assert.doesNotMatch(en[k] + fr[k], /!|Veuillez|Please/, k);
  }
  for (const id of ["backup", "updates", "security", "mcp.tokens", "modules.install", "team", "roles"]) assert.ok(en[`denied.area.${id}`] && fr[`denied.area.${id}`], id);
});

test("the refusal is remembered for the next dashboard view of the SAME person, once, for 30 seconds", () => {
  const now = 1_000_000;
  Acc.rememberDenied("u-a", "admin", now);
  Acc.rememberDenied("u-b", { right: "core:backup" }, now);
  assert.equal(Acc.takeDenied("u-c", now + 1), null, "another person sees nothing");
  assert.deepEqual(Acc.takeDenied("u-b", now + 1000), { right: "core:backup" });
  assert.equal(Acc.takeDenied("u-b", now + 1001), null, "read once");
  assert.equal(Acc.takeDenied("u-a", now + 31_000), null, "forgotten after 30 seconds");
  Acc.rememberDenied("u-a", "admin", now);
  Acc.rememberDenied("u-a", "editor", now + 5);
  assert.equal(Acc.takeDenied("u-a", now + 10), "editor", "the last one wins");
});

test("the gate remembers the need it refused, and the dashboard words it without reading the address", () => {
  const perm = read("src/core/permissions.ts");
  assert.match(perm, /rememberDenied\(user\.id, min\);\s*redirect\(deniedPath\(user\)\)/);
  assert.match(read(`${ROOT}/(panel)/instances/[id]/InstanceView.tsx`), /rememberDenied\(user\.id, \{ right: `\$\{mod\.manifest\.id\}:open` \}\);\s*redirect\(deniedPath\(user\)\)/);
  const page = read(`${ROOT}/(panel)/page.tsx`);
  assert.match(page, /const deniedNeed = denied \? takeDenied\(user\.id\) : null;/);
  assert.match(page, /denialText\(t, deniedNeed\)/);
  assert.equal([...page.matchAll(/denied/g)].filter((m) => !/deniedNeed|denialText|takeDenied|denied\b/.test(m[0])).length, 0);
  assert.doesNotMatch(page, /searchParams[\s\S]{0,200}denialText\(t, denied\b/, "the sentence never comes from the address");
  // The redirect itself did not change: old links and the tests of every gate keep their address.
  assert.equal(Acc.deniedPath(EDITOR), "/admin?denied=1");
  assert.equal(Acc.deniedPath(NOBODY), "/admin/no-access");
});

test("an unknown group is closed; a group of the site vocabulary is open (the caller passes its groups)", () => {
  assert.equal(A.canOpen(EDITOR, "/admin/zzgroup/zzpage", OWNERS), false);
  assert.equal(A.canOpen(EDITOR, "/admin/zzgroup/zzpage", A.ownersOf([], ["zzgroup"])), true);
  assert.equal(A.canOpen(EDITOR, "/admin/backup/zzpage", A.ownersOf([], ["backup"])), false, "a core segment is never a place group");
  assert.equal(A.canOpen(EDITOR, "/admin/community/games", OWNERS), true, "a core vocabulary group");
});

test("the notice sentence for reserved rights is true: those rights are never delegable and only owner and coordination hold them", async () => {
  const R = await import("@/core/auth/rights");
  for (const id of ["backup", "updates", "security", "mcp.tokens", "modules.install", "team", "roles"]) {
    const right = `core:${id}`;
    assert.ok(R.isReserved(right), right);
    assert.ok(R.LEVEL_RESERVED.coordinator.includes(right) && R.LEVEL_RESERVED.owner.includes(right), right);
    assert.ok(!R.LEVEL_RESERVED.admin.includes(right) && !R.LEVEL_RESERVED.editor.includes(right), right);
    assert.ok(!R.CORE_DELEGABLE.includes(right), right);
  }
});

test("denial memory: bounded, expired entries purged first, two people never mix", () => {
  const now = 5_000_000;
  for (let i = 0; i < 1000; i++) Acc.rememberDenied(`old-${i}`, "admin", now - 60_000);
  Acc.rememberDenied("fresh-1", "editor", now); // at the cap: the expired ones are purged
  assert.equal(Acc.takeDenied("old-0", now + 1), null);
  assert.equal(Acc.takeDenied("fresh-1", now + 1), "editor");
  for (let i = 0; i < 1000; i++) Acc.rememberDenied(`live-${i}`, "admin", now);
  Acc.rememberDenied("extra", "owner", now); // nothing expired: the oldest goes
  assert.equal(Acc.takeDenied("live-0", now + 1), null, "evicted");
  assert.equal(Acc.takeDenied("live-999", now + 1), "admin");
  assert.equal(Acc.takeDenied("extra", now + 1), "owner");
  Acc.rememberDenied("p1", { right: "core:backup" }, now);
  Acc.rememberDenied("p2", "admin", now);
  assert.equal(Acc.takeDenied("p2", now + 1), "admin");
  assert.deepEqual(Acc.takeDenied("p1", now + 1), { right: "core:backup" });
});

test("the gate does not remember a link prefetch", () => {
  assert.match(read("src/core/permissions.ts"), /if \(!\(await isPrefetch\(\)\)\) rememberDenied\(user\.id, min\);/);
});

test("the 'unlisted' line of the dashboard (module names and counts) is shown only to people who can open the Modules page", () => {
  const page = read(`${ROOT}/(panel)/page.tsx`);
  assert.match(page, /advanced && canOpen\(user, EXTENSIONS_HREF, owners\) \? unlistedEntries\(allNav\)/);
});

test("the dashboard blocks are server components: nothing here crosses to the browser", () => {
  const dir = "src/components/admin/dashboard";
  for (const f of fs.readdirSync(dir)) assert.doesNotMatch(read(`${dir}/${f}`), /^\s*["']use client["']/m, f);
});
