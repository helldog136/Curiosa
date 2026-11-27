// C5c: "Accounts and connections" is ONE table (R30): origin and state are columns, search and filters cover it, one button per row, nothing left out.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (f) => fs.readFileSync(f, "utf8");
const R = await import("@/components/admin/connectionRows");
const { connectionView } = await import("@/core/adminkit/connection");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { sanitizeVocabulary, mergeVocabulary, BUILTIN_VOCABULARY, TABLE_PAGES } = await import("@/core/modules/places");
const { ConnectionsTable } = await import("@/components/admin/ConnectionsTable");

const labels = (loc) => R.connectionsLabels(makeTranslator(loc));
const L = { edit: "Edit", fix: "Fix", setup: "Set up" };
const ctx = { anchor: "demo-app.main", instanceId: "i1", pageHref: "/admin/networks/demo", labels: L };
const view = (b) => connectionView({ type: "connection", id: "app", title: "Demo app", ...b });

test("a configured connection: summary, one Edit button on the page that produces it", () => {
  const r = R.rowFromConnection(view({ state: "configured", summary: "Account etoile_nord", edit: { href: "?edit=app" } }), ctx);
  assert.equal(r.state, "configured"); assert.equal(r.detail, "Account etoile_nord");
  assert.deepEqual(r.action, { kind: "link", label: "Edit", href: "/admin/networks/demo?edit=app" });
});
test("a degraded connection: the reason is the detail, the fix is the button (a module action stays an action)", () => {
  const r = R.rowFromConnection(view({ state: "degraded", reason: "Sign-in expired.", primary: { label: "Reconnect", action: "reconnect" } }), ctx);
  assert.equal(r.state, "degraded"); assert.equal(r.detail, "Sign-in expired.");
  assert.deepEqual(r.action, { kind: "action", label: "Reconnect", instanceId: "i1", action: "reconnect" });
});
test("a connection that is not configured: Set up leads to the page where the steps are", () => {
  const r = R.rowFromConnection(view({ state: "notConfigured", reason: "Not connected." }), ctx);
  assert.equal(r.action.label, "Set up"); assert.equal(r.action.href, "/admin/networks/demo");
});
test("the menu keeps the rare actions of the card (disconnect, with its confirmation)", () => {
  const r = R.rowFromConnection(view({ state: "configured", summary: "x", menu: [{ label: "Disconnect", action: "off", confirm: "Sure?", danger: true }] }), ctx);
  assert.deepEqual(r.menu, [{ label: "Disconnect", instanceId: "i1", action: "off", confirm: "Sure?", danger: true }]);
});
test("an address row: configured when written, Add the address otherwise, both open the window", () => {
  const a = { anchor: "bluesky.main", name: "Bluesky", editHref: "/admin/networks?editAccount=bluesky.main", labels: { edit: "Edit", add: "Add the address" } };
  const full = R.rowFromAddress({ ...a, value: "bsky.example.test/lune_douce" });
  const empty = R.rowFromAddress({ ...a, value: "  " });
  assert.equal(full.state, "configured"); assert.equal(full.action.kind, "dialog"); assert.equal(full.action.label, "Edit");
  assert.equal(empty.state, "notConfigured"); assert.equal(empty.action.label, "Add the address");
});
test("a page row has no state; rows needing attention come first", () => {
  const rows = R.sortRows([
    R.rowFromPage({ id: "p", name: "Figures", href: "/admin/networks/stats", todo: 0, open: "Open" }),
    R.rowFromAddress({ anchor: "a", name: "Zeta", value: "x", editHref: "?e", labels: { edit: "E", add: "A" } }),
    R.rowFromAddress({ anchor: "b", name: "Alpha", value: "", editHref: "?e", labels: { edit: "E", add: "A" } }),
    R.rowFromConnection(view({ state: "degraded", reason: "r" }), ctx),
  ], "en");
  assert.deepEqual(rows.map((r) => r.state), ["degraded", "notConfigured", "configured", null]);
  assert.equal(rows.at(-1).state, null);
});

test("the table: search, two filters with numbers, state AND origin as words, one button per row", () => {
  const rows = [
    R.rowFromConnection(view({ state: "configured", summary: "Account etoile_nord", edit: { href: "?edit=app" } }), ctx),
    R.rowFromAddress({ anchor: "k", name: "Mastodon", value: "", editHref: "/admin/networks?editAccount=k", labels: { edit: "Edit", add: "Add the address" } }),
    R.rowFromPage({ id: "p", name: "Figures", href: "/admin/networks/stats", todo: 2, open: "Open" }),
  ];
  const html = renderToStaticMarkup(h(ConnectionsTable, { rows, labels: labels("en") }));
  for (const w of ["Connection", "Address", "Page", "Configured", "Not configured"]) assert.ok(html.includes(`>${w}<`) || html.includes(`>${w} `), w);
  assert.equal((html.match(/data-testid="connection-row"/g) ?? []).length, 3);
  assert.match(html, /type="search"/);
  assert.match(html, /data-live-pills="origin"/); assert.match(html, /data-live-pills="state"/);
  assert.match(html, /Add the address/); assert.match(html, /href="\/admin\/networks\/stats"[^>]*>Open</);
  assert.ok(!/Active|Activé/.test(html));
});

test("vocabulary: `layout: table` is read from the catalogue and the core decides it for the accounts page", () => {
  const v = sanitizeVocabulary({ pages: [{ id: "networks.accounts", en: "Other accounts", fr: "Autres comptes", layout: "table" }, { id: "networks.stats", en: "Figures", fr: "Chiffres", layout: "grid" }] });
  assert.equal(v.pages[0].layout, "table"); assert.equal(v.pages[1].layout, undefined);
  const merged = mergeVocabulary(BUILTIN_VOCABULARY, sanitizeVocabulary({ pages: [{ id: "networks.accounts", en: "Other accounts", fr: "Autres comptes" }] }));
  assert.equal(merged.pages.find((p) => p.id === "networks.accounts").layout, "table");
  assert.ok(TABLE_PAGES.includes("networks.accounts"));
});

test("wiring: the group page and the accounts page use the table, with their access gates untouched", () => {
  const group = read("src/app/admin/(panel)/[group]/page.tsx");
  assert.match(group, /loadAccountsTable/); assert.match(group, /adminCtx\("member"\)/); assert.match(group, /loadGroupIndex/); assert.match(group, /notFound\(\)/);
  const load = read("src/components/admin/connectionsLoad.tsx");
  assert.match(load, /loadGroupIndex/, "the list of what this person may open still decides the rows");
  assert.match(load, /rowFromPage/, "a page no row covers stays reachable");
  const place = read("src/app/admin/(panel)/[group]/[page]/[[...tab]]/page.tsx");
  assert.match(place, /found\.layout === "table"/);
  assert.ok(!/secret/i.test(read("src/components/admin/connectionRows.ts").replace(/\/\*[\s\S]*?\*\//g, "")), "a secret is never read into a row");
});
test("the three words and the labels exist in both languages", () => {
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  for (const k of ["connections.col.name", "connections.origin.connection", "connections.origin.address", "connections.action.open", "connections.dialog.save", "connections.search"]) assert.ok(en[k] && fr[k], k);
  const keys = Object.keys(en); assert.equal(keys.at(-1), "settings.contrast.accent2");
});
