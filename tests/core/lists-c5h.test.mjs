// Admin redesign C5h: the core list pages (short links, entries, drafts, templates) follow R14, R15, R16, R17, R18, R32, R37. Source-level checks of the pages.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");
const P = "src/app/admin/(panel)";
const redirects = read(`${P}/redirects/page.tsx`), entries = read(`${P}/entries/page.tsx`), drafts = read(`${P}/drafts/page.tsx`), templates = read(`${P}/entries/templates/page.tsx`);
const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));

test("short links: one main button opens the creation window, the page no longer carries the form", () => {
  assert.match(redirects, /<FormDialog primary trigger=/, "R3: the one main button");
  assert.match(redirects, /<ActionForm action=\{createRedirect\}[^>]*\breset\b/, "the same creation action, inside the window");
  assert.match(redirects, /<PageHeader title=\{t\("nav\.redirects"\)\}/, "R36: one title, the menu name");
  assert.match(redirects, /\{view === "all" && !nothingYet && createDialog\}/, "the header button is hidden while the empty state carries it");
});

test("short links: a quiet switch, a word only for the exceptions (R14, R37), at most two visible actions plus the menu", () => {
  assert.match(redirects, /<Switch quiet label=/);
  assert.doesNotMatch(redirects, /ui\.chipOk\}>\{t\("redirects\.state\.active"\)/, "no 'Active' label repeated on the extension-managed rows");
  assert.match(redirects, /rowState === "ended" && <StatusPill tone="warn"/);
  assert.match(redirects, /rowState === "off" && <StatusPill tone="neutral"/);
  assert.match(redirects, /<RowMenu label=\{t\("table\.menu"\)\}>/);
});

test("short links: R18 empty state with one button, R15 count of a filtered list, R32 no explanatory paragraph", () => {
  assert.match(redirects, /<EmptyState title=\{advanced \? t\("redirects\.empty"\) : t\("redirects\.empty\.simple"\)\} action=\{createDialog\}/);
  assert.doesNotMatch(redirects, /redirects\.examples/, "the examples sentence is gone from the screen");
  assert.match(redirects, /serverCount=\{q \|\| state \? t\("search\.count"/);
  assert.doesNotMatch(redirects, /<p className=\{ui\.help\}>\{t\("redirects\.intro"\)/, "the advanced intro is a tooltip");
  assert.doesNotMatch(redirects, /redirects\.measure\.adminOnly"\)\}<\/p>/, "the 'only the administration' sentence is a tooltip");
});

test("short links: the gates stay (editor to see and create, admin for the measure option)", () => {
  assert.match(redirects, /adminCtx\("editor"\)/);
  assert.match(redirects, /hasRole\(user, "admin"\)/);
  assert.match(read(`${P}/redirects/actions.ts`), /export async function saveMeasureLinks[\s\S]*?adminCtx\("admin"\)/);
});

test("entries: state pills with a shape (StatusPill), the empty state has one button, the count of a search is announced, a long title is cut with a tooltip", () => {
  assert.match(entries, /<StatusPill tone=\{TONE\[state\]\}/);
  assert.doesNotMatch(entries, /ui\.chipWarn|ui\.chipOk/);
  assert.match(entries, /<EmptyState title=\{t\("entries\.emptyTitle"\)\}/);
  assert.doesNotMatch(entries, /entries\.emptyHelp/, "no description paragraph in the empty state");
  assert.match(entries, /serverCount=\{filtered \? t\("search\.count"/);
  assert.match(entries, /block truncate font-medium hover:text-accent" title=\{main\?\.title \|\| undefined\}/);
  assert.match(entries, /<HelpTip help=\{t\("entries\.orderedBy"/, "the sort order is a tooltip, not a sentence");
  assert.match(entries, /adminCtx\("editor"\)/);
});

test("drafts: live search from the first draft (server side), an empty state with one button, the gate is kept", () => {
  assert.match(drafts, /<LiveSearch mode="server" scope="drafts"/);
  assert.match(drafts, /<EmptyState title=\{t\("drafts\.empty"\)\}/);
  assert.doesNotMatch(drafts, /drafts\.emptyHelp|drafts\.count/, "no description sentence on the screen");
  assert.match(drafts, /<NoResults /);
  assert.match(drafts, /adminCtx\("editor"\)/);
  assert.match(drafts, /listDrafts\(nav, config\.defaultLocale, \{ limit: PER_PAGE, skip: \(wanted - 1\) \* PER_PAGE, q \}\)/);
});

test("templates: regular rows (name, one cut line with a tooltip, one button), no card grid", () => {
  assert.doesNotMatch(templates, /sm:grid-cols-2/);
  assert.match(templates, /truncate text-sm text-muted" title=\{description\}/);
  assert.equal((templates.match(/<PendingButton/g) ?? []).length, 1, "one action per row");
  assert.match(templates, /adminCtx\("editor"\)/);
});

test("the new text keys exist in both languages with the same variables", () => {
  for (const k of ["search.results", "search.results.one"]) {
    assert.ok(fr[k] && en[k], k);
    assert.deepEqual(fr[k].match(/\{\w+\}/g), en[k].match(/\{\w+\}/g), k);
  }
  const keys = Object.keys(en);
  assert.deepEqual(keys, Object.keys(fr), "same keys, same order");
  assert.ok(keys.indexOf("search.results") < keys.indexOf("theme.ember"), "new keys before the colour group");
  assert.equal(keys.at(-1), "settings.contrast.accent2");
});
