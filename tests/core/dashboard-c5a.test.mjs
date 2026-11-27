// C5a: the dashboard is composed of the C3c bricks. Attention lines carry an action, the checklist is the set-up card, numbers lead somewhere the person can open (R35),
// the heavy blocks are folded, and no filler sentence is left (R32, R33). Reads the sources and the two language files (no server needed).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const page = read("src/app/admin/(panel)/page.tsx");
const blocks = read("src/components/admin/dashboard/Blocks.tsx");
const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
const L = await import("@/core/dashboard/layout");

test("the to-do lines are attention cards, each with its own verb, five at a time with the rest folded", () => {
  assert.match(blocks, /import \{ AttentionCard/);
  assert.match(blocks, /<AttentionCard key=\{i\.id\} tone=\{TODO_TONE\[i\.kind\]\}/);
  assert.match(blocks, /t\(`dash\.todo\.go\.\$\{i\.kind\}`\)/);
  assert.match(blocks, /TODO_VISIBLE = 5/);
  assert.match(blocks, /rest\.length > 0 && <MoreOptions title=\{t\("dash\.todo\.more"/);
  assert.match(blocks, /data-testid="todo"/);
  assert.match(blocks, /openable\(c\.user, \[\.\.\.healthItems, \.\.\.mergeTodo\(core, mods\)\], c\.owners\)/, "the access filter is kept");
  const kinds = [...read("src/core/dashboard/todo.ts").matchAll(/kind: "([\w-]+)"/g)].map((m) => m[1]);
  for (const k of ["ai", "setup", "backup", "update-core", "update-modules", "update-skins", "badge", "module", "drafts", "health"]) assert.ok(`dash.todo.go.${k}` in en && `dash.todo.go.${k}` in fr, k);
  assert.ok(kinds.length > 0);
});

test("the set-up list is the checklist card, with the action of the next step only, still hideable", () => {
  assert.match(blocks, /<ChecklistCard title=\{t\("dash\.setup\.title"\)\}/);
  assert.match(blocks, /canOpen\(c\.user, s\.href, c\.owners\)/);
  assert.match(blocks, /action=\{hideSetup\}/);
  for (const id of ["name", "tagline", "logo", "modules", "page", "social", "look", "assistant"]) for (const d of [en, fr]) assert.ok(d[`dash.setup.act.${id}`], id);
});

test("the heavy blocks are folded to one line: visits, storage, activity", () => {
  for (const name of ["VisitsBlock", "StorageBlock", "ActivityBlock"]) {
    const body = blocks.slice(blocks.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /<MoreOptions/, name);
  }
  assert.match(blocks, /<MoreOptions id="storage"/, "the health points still land on #storage");
  assert.match(blocks, /defaultOpen=\{v\.level !== "ok" && v\.level !== "unknown"\}/, "open as soon as the disk needs a look");
  assert.match(blocks, /dash\.activity\.count/);
});

test("no filler sentence is left on the dashboard (R32, R33)", () => {
  for (const k of ["dashboard.welcome", "dashboard.draftsNone", "dashboard.draftsNoneYet", "dash.robots.none", "dash.setup.progress"]) {
    assert.ok(!(k in en) && !(k in fr), `${k} removed`);
    assert.ok(!blocks.includes(`"${k}"`) && !page.includes(`"${k}"`), k);
  }
  assert.doesNotMatch(page, /<Callout tone="ok"/, "no good-news box");
  // The privacy line, the robots hint and the storage intro are « ? » bubbles, not visible paragraphs.
  assert.match(blocks, /<HelpTip help=\{t\("dashboard\.visitsPrivacy"\)\}/);
  assert.match(blocks, /<HelpTip help=\{t\("dash\.robots\.hint"\)\}/);
  assert.match(blocks, /<HelpTip help=\{t\("storage\.intro"\)\}/);
  assert.doesNotMatch(blocks, /<p[^>]*>\{t\("(storage\.intro|dashboard\.visitsPrivacy|dash\.robots\.hint)"\)\}<\/p>/);
});

test("the module-install notice carries an action, and only for someone who can open the page", () => {
  assert.match(page, /<AttentionCard testid="setup-modules-failed"/);
  assert.match(page, /canOpen\(user, EXTENSIONS_ADD_HREF, owners\)/);
  assert.ok(en["dashboard.modulesReason"] && fr["dashboard.modulesReason"]);
});

test("numbers: the overview exists only when a number leads to a page the person can open", () => {
  assert.match(page, /const showNumbers = openableParts\.length > 0 \|\| canOpen\(user, EXTENSIONS_HREF, owners\)/);
  assert.match(page, /const numbersBlock = !showNumbers \? null/);
  assert.match(page, /openableParts\.length > 0 && publishedStat\(counts\.published\)/);
  assert.equal(en["dashboard.inNumbers"], "Overview");
  assert.equal(fr["dashboard.inNumbers"], "Vue d'ensemble");
});

test("the page states its purpose in one line in both modes, and keeps the denial notice", () => {
  assert.match(page, /intro=\{advanced \? t\("dashboard\.introAdvanced"\) : t\("dashboard\.intro"\)\}/);
  for (const d of [en, fr]) assert.ok(d["dashboard.intro"].length <= 80 && !/!/.test(d["dashboard.intro"]));
  assert.match(page, /denialText\(t, deniedNeed\)/);
  assert.match(page, /unlistedEntries\(allNav\)/);
});

test("order: what waits for an action first, activity last, in every plan", () => {
  for (const [level, adv] of [["owner", true], ["admin", false], ["coordinator", false], ["editor", false], ["editor", true]]) {
    const u = { id: "u", email: "a@b.c", name: "A", level, roles: [level], rights: new Set(), locale: null, advanced: adv };
    const b = L.dashboardPlan(u, adv).blocks;
    assert.equal(b.at(-1), "activity");
    const first = b.filter((x) => x !== "health")[0];
    assert.equal(first, "todo", level);
    if (b.includes("setup")) assert.ok(b.indexOf("todo") < b.indexOf("setup") && b.indexOf("setup") < b.indexOf("create") && b.indexOf("create") < b.indexOf("drafts"));
    if (b.includes("visits")) assert.ok(b.indexOf("numbers") < b.indexOf("visits"), "the visits sit under the overview numbers");
  }
});

test("the new keys exist in both languages, with the same variables, and the last key stays the theme one", () => {
  for (const k of Object.keys(en).filter((x) => /^(dash\.todo\.(more|go)|dash\.setup\.act|dash\.activity\.count|dash\.visits\.summary|dashboard\.(intro|modulesReason))/.test(x))) {
    assert.ok(k in fr, k);
    assert.deepEqual([...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k);
  }
  assert.equal(Object.keys(en).at(-1), "settings.contrast.accent2");
  assert.equal(Object.keys(fr).at(-1), "settings.contrast.accent2");
});

test("the health pill leads to the lines that explain it: every health point is a line of the to-do list or a note (no count without its lines)", () => {
  const pill = blocks.slice(blocks.indexOf("export async function HealthPill"), blocks.indexOf("// ── Stockage"));
  assert.match(pill, /<a href="#todo" data-testid="dash-health"/, "the pill links to the to-do list");
  assert.doesNotMatch(pill, /<details/, "no second, hidden copy of the points");
  assert.match(page, /<TodoBlock c=\{c\} withHealth=\{plan\.blocks\.includes\("health"\)\} \/>/, "the list knows the pill is there");
  // Every point but the backup one (already a line of the core list) becomes a card with an action, or a note when this person has no page for it.
  assert.match(blocks, /p\.id !== "backup"/);
  assert.match(blocks, /kind: "health" as const/);
  assert.match(blocks, /data-testid="todo-notes"/);
  assert.match(blocks, /items\.length === 0 && notes\.length === 0\) return null/, "an empty list still shows nothing");
  assert.ok(en["dash.todo.go.health"] && fr["dash.todo.go.health"]);
  assert.match(blocks, /health: "warn"/);
});
