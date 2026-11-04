import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// The menu and the home page for an AI: navigation_get / navigation_set, home_sections_list / home_sections_set.
// Rules under test: the whole list is validated like the admin's forms (targets must exist, every language written, caps), nothing partial, plain-words errors with an example;
// the writers follow the approval setting of the access (request, or applied at once with a restore point); journal without content; token ceiling and rights;
// the "content" rate limit (not the 12-per-hour risky counter); profiles; FR/EN parity; and the showcase scenario of docs/ideas/ai-setup-poc.md (gap 5).
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools, listMcpToolCatalogue } = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const S = await import("@/core/maintenance/settings");
const SL = await import("@/core/maintenance/contentSlot");
const P = await import("@/core/services/mcp/profiles");
const NAV = await import("@/core/maintenance/siteNavigation");
const HOME = await import("@/core/maintenance/siteHome");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting, getSetting } = await import("@/core/settings");
const { loadMenu } = await import("@/core/menuStore");
const { resolvePublicMenu } = await import("@/core/menuResolve");
const { runSection } = await import("@/core/modules/runtime");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Markdown } = await import("../../src/components/site/Markdown.tsx");
const { describeRequest } = await import("../../src/app/admin/(panel)/assistants/requestsShared.ts");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const owner = { email: "owner@example.org", owner: true };
const manifest = (id) => FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
let pages; let blog; let banner; let installPage; let aboutPage; let contactPage;
const both = (en, fr) => ({ en, fr });

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  SL.resetContentSlots();
  await setSetting("i18n.default", "en");
  await setSetting("i18n.enabled", ["en", "fr"]);
  for (const id of ["blog", "pages", "hero"]) await db.fixture(id);
  pages = await createInstance(db.prisma, { manifest: manifest("pages"), nickname: "Pages", names: { en: "Pages", fr: "Pages" } });
  blog = await createInstance(db.prisma, { manifest: manifest("blog"), nickname: "Blog", names: { en: "Blog", fr: "Blog" } });
  banner = await createInstance(db.prisma, { manifest: manifest("hero"), nickname: "Banner", names: { en: "Banner", fr: "Bandeau" } });
  const page = async (title, slug, status = "published") => (await createEntry(db.prisma, { instanceId: pages.id, locale: "en", title, slug, summary: "", body: "Plain text", status })).id;
  aboutPage = await page("What is Curiosa", "what-is-curiosa");
  installPage = await page("Install", "install");
  contactPage = await page("Contact", "contact");
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), listMcpTools);
const listed = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const body = await (await rpc(token, "tools/call", { name, arguments: args })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
const ALL = ["navigation_get", "navigation_set", "home_sections_list", "home_sections_set", "maintenance_request_status"];
async function access(grant = ALL, scope = "write") {
  const token = await T.createToken("Camille", scope, "owner@example.org", { grants: Object.fromEntries(grant.map((g) => [g, true])) });
  return { token, id: await T.findTokenId(token) };
}
async function direct(grant, scope) { const a = await access(grant, scope); await S.setApprovalMode(a.id, "direct"); return a; }
const audits = (prefix) => db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } });
const menuNow = async () => (await loadMenu()).items;

const SHOWCASE = () => [
  { page: "home", label: both("Home", "Accueil") },
  { instance: "pages", entry: aboutPage, label: both("What is Curiosa", "Qu'est-ce que Curiosa") },
  { instance: "pages", entry: installPage, label: both("Install", "Installer") },
  { instance: blog.key, label: both("Blog", "Blog") },
  { externalUrl: "https://example.org/press-kit", label: both("Press kit", "Dossier de presse") },
  { instance: "pages", entry: contactPage, label: both("Contact", "Contact") },
];

test("tools: four tools, bare names; readers are reads, writers are requests (not deletions) that audit themselves; none granted by default", async () => {
  const tools = await listMcpTools();
  const get = (n) => tools.find((t) => t.name === n);
  for (const n of ["navigation_get", "home_sections_list"]) assert.deepEqual([get(n).readOnly, get(n).default, get(n).destructive, !!get(n).request], [true, false, false, false], n);
  for (const n of ["navigation_set", "home_sections_set"]) assert.deepEqual([get(n).readOnly, get(n).default, get(n).destructive, get(n).request, get(n).audited], [false, false, false, true, true], n);
  const plain = await T.createToken("Nothing ticked", "write", "o");
  assert.ok(!(await listed(plain)).some((n) => /^(navigation|home_sections)_/.test(n)));
});

test("rights: no right = unknown tool (same answer as a tool that does not exist); a read-only ceiling hides the writers but keeps the readers", async () => {
  const plain = await T.createToken("Nothing ticked", "write", "o");
  const refused = await call(plain, "navigation_set", { entries: [{ page: "home" }] });
  const unknown = await call(plain, "navigation_nope", { entries: [] });
  assert.match(refused.error, /Unknown tool/);
  assert.equal(refused.error.replace("navigation_set", "X"), unknown.error.replace("navigation_nope", "X"));
  const { token } = await access(ALL, "read");
  const names = await listed(token);
  assert.ok(names.includes("navigation_get") && names.includes("home_sections_list"));
  assert.ok(!names.includes("navigation_set") && !names.includes("home_sections_set"));
  assert.match((await call(token, "home_sections_set", { sections: [] })).error, /Unknown tool/);
  assert.equal((await menuNow()).length, 0);
  assert.equal(await Q.pendingCount(), 0);
});

test("navigation_get: languages, limits, what can be added, and entries in the exact shape navigation_set accepts (round trip)", async () => {
  const { token } = await direct();
  await call(token, "navigation_set", { entries: SHOWCASE() });
  const got = (await call(token, "navigation_get")).value;
  assert.deepEqual(got.languages, ["en", "fr"]);
  assert.deepEqual([got.limits.entries, got.limits.perSubmenu], [40, 8]);
  assert.deepEqual(got.canAdd.sitePages.map((p) => p.page), ["home", "privacy"]);
  assert.ok(got.canAdd.modulePages.some((p) => p.instance === blog.key && p.address === "/blog"));
  assert.equal(got.entries.length, 6);
  assert.deepEqual(got.entries[1], { label: both("What is Curiosa", "Qu'est-ce que Curiosa"), instance: "pages", entry: aboutPage, kind: "content_entry", name: "What is Curiosa", address: "/what-is-curiosa", shown: true });
  assert.equal(got.entries[4].externalUrl, "https://example.org/press-kit");
  // sending it back unchanged is accepted and changes nothing
  const again = (await call(token, "navigation_set", { entries: got.entries })).value;
  assert.equal(again.status, "done");
  assert.match(again.message, /already like this/);
  assert.equal((await audits("navigation.update")).length, 1, "a no-op writes no second journal line");
});

test("showcase scenario: the menu (Home, What is Curiosa, Install, Blog, Press kit, Contact) and a home page with the banner then a page's content, with no admin screen", async () => {
  const { token } = await direct();
  const nav = (await call(token, "navigation_set", { entries: SHOWCASE() })).value;
  assert.equal(nav.status, "done", JSON.stringify(nav));
  const en = await resolvePublicMenu("en", "en");
  assert.deepEqual(en.map((i) => i.label), ["Home", "What is Curiosa", "Install", "Blog", "Press kit", "Contact"]);
  assert.deepEqual(en.map((i) => i.href), ["/", "/what-is-curiosa", "/install", "/blog", "https://example.org/press-kit", "/contact"]);
  const fr = await resolvePublicMenu("fr", "en");
  assert.deepEqual(fr.map((i) => i.label), ["Accueil", "Qu'est-ce que Curiosa", "Installer", "Blog", "Dossier de presse", "Contact"]);

  const list = (await call(token, "home_sections_list")).value;
  const hero = list.canAdd.moduleSections.find((s) => s.instance === banner.key && s.section === "hero");
  assert.ok(hero, "the banner of the installed hero module is offered");
  assert.ok(list.canAdd.moduleSections.some((s) => s.instance === "pages" && s.section === "latest"), "the latest entries of the pages instance are offered");
  const chooser = list.canAdd.moduleSections.find((s) => s.instance === "pages" && s.section === "entry");
  assert.deepEqual(chooser.options[0].choices.map((c) => c.id).sort(), [aboutPage, contactPage, installPage].sort(), "the full content of a page can be chosen among the published entries");
  assert.ok(list.canAdd.textBlocks.some((b) => b.kind === "cta"));
  const set = (await call(token, "home_sections_set", { sections: [
    { instance: banner.key, section: "hero", isolated: true },
    { instance: "pages", section: "entry", options: { entry: aboutPage } },
    { block: { kind: "cta", title: both("Try it", "Essayez"), text: both("Install in ten minutes.", "Installez en dix minutes."), buttonLabel: both("Install", "Installer"), buttonUrl: "/install" } },
  ] })).value;
  assert.equal(set.status, "done", JSON.stringify(set));
  const stored = await getSetting("home.sections");
  assert.deepEqual(stored.map((s) => [s.instance, s.section]), [[banner.key, "hero"], ["pages", "entry"], ["core", "block"]]);
  assert.equal(stored[0].isolated, true);
  assert.deepEqual(stored[1].options, { entry: aboutPage });
  const rendered = await runSection("pages", "entry", stored[1].options, "en");
  assert.deepEqual([rendered[0].type, rendered[0].title, rendered[0].body], ["entryContent", "What is Curiosa", "Plain text"], "the FULL content of the page, not a card");
  const cta = await runSection("core", "block", stored[2].options, "fr");
  assert.equal(cta[0].title, "Essayez");
  const back = (await call(token, "home_sections_list")).value.sections;
  assert.deepEqual(back.map((s) => s.kind), ["module_section", "module_section", "text_block"]);
});

test("section \"entry\": the full content of one published page, in the visitor's language with the fallback chain; broken when unpublished; nothing is injected", async () => {
  const { token } = await direct();
  await db.prisma.entryTranslation.create({ data: { entryId: aboutPage, instanceId: pages.id, locale: "fr", slug: "quest-ce-que-curiosa", title: "Qu'est-ce que Curiosa", summary: "Résumé", body: "Corps **gras**" } });
  const set = await call(token, "home_sections_set", { sections: [{ instance: "pages", section: "entry", options: { entry: aboutPage } }] });
  assert.equal(set.value.status, "done", JSON.stringify(set));
  const opts = { entry: aboutPage };
  const fr = await runSection("pages", "entry", opts, "fr");
  assert.deepEqual([fr[0].lang, fr[0].fallback, fr[0].title, fr[0].summary, fr[0].body], ["fr", false, "Qu'est-ce que Curiosa", "Résumé", "Corps **gras**"]);
  // a language the page was not written in falls back along the i18n chain (site language), and says so
  const de = await runSection("pages", "entry", opts, "de");
  assert.deepEqual([de[0].lang, de[0].fallback, de[0].title], ["en", true, "What is Curiosa"]);
  // the list reports it as shown, then broken once unpublished; the section then renders nothing
  assert.equal((await call(token, "home_sections_list")).value.sections[0].shown, true);
  await db.prisma.entry.update({ where: { id: aboutPage }, data: { status: "draft" } });
  assert.deepEqual(await runSection("pages", "entry", opts, "en"), []);
  const broken = (await call(token, "home_sections_list")).value.sections[0];
  assert.deepEqual([broken.shown, /not published any more/.test(broken.problem)], [false, true]);
  // an entry of another instance is never shown by this instance's section
  const other = await createEntry(db.prisma, { instanceId: blog.id, locale: "en", title: "Post", body: "x", status: "published" });
  assert.deepEqual(await runSection("pages", "entry", { entry: other.id }, "en"), []);
  // nothing is injected: HTML in the text is escaped by the page renderer (the same Markdown component as the entry page)
  await db.prisma.entry.update({ where: { id: aboutPage }, data: { status: "published" } });
  await db.prisma.entryTranslation.updateMany({ where: { entryId: aboutPage, locale: "en" }, data: { body: 'Hi <script>alert(1)</script> <img src=x onerror=alert(2)> [bad](javascript:alert(3))' } });
  const [block] = await runSection("pages", "entry", opts, "en");
  const html = renderToStaticMarkup(Markdown({ text: block.body }));
  assert.ok(!/<(script|img)/i.test(html) && !/href="javascript:/i.test(html) && html.includes("&lt;script&gt;"), html);
});

test("section \"entry\" is validated: a published entry of THAT instance is required; unknown instance, draft, other instance and missing entry are refused", async () => {
  const { token } = await direct();
  const draft = (await createEntry(db.prisma, { instanceId: pages.id, locale: "en", title: "Draft", status: "draft" })).id;
  const post = (await createEntry(db.prisma, { instanceId: blog.id, locale: "en", title: "Post", status: "published" })).id;
  const bad = async (options, re, instance = "pages") => { const r = await call(token, "home_sections_set", { sections: [{ instance, section: "entry", options }] }); assert.match(r.error ?? "", re, JSON.stringify(options)); assert.equal(await getSetting("home.sections"), undefined); };
  await bad({}, /give the id of a PUBLISHED entry of "pages".*Example/);
  await bad({ entry: draft }, /PUBLISHED entry/);
  await bad({ entry: post }, /PUBLISHED entry of "pages"/);
  await bad({ entry: "nope" }, /PUBLISHED entry/);
  await bad({ entry: aboutPage }, /Unknown instance: "ghost"/, "ghost");
  await bad({ entry: aboutPage, colour: 1 }, /"colour" is not an option/);
  assert.equal((await call(token, "home_sections_set", { sections: [{ instance: "pages", section: "entry", options: { entry: aboutPage } }] })).value.status, "done");
});

test("add, reorder and remove: all are \"send the new list\"; the summary says what changed", async () => {
  const { token } = await access();
  const first = (await call(token, "navigation_set", { entries: SHOWCASE() })).value;
  assert.equal(first.status, "pending_approval");
  assert.deepEqual(first.plan.change.summary.added.slice(0, 2), ["Home", "What is Curiosa"]);
  assert.equal((await M.approveRequest(first.requestId, owner)).ok, true);
  const s = SHOWCASE();
  // reorder: Contact first
  const reordered = (await call(token, "navigation_set", { entries: [s[5], s[0], s[1], s[2], s[3], s[4]] })).value;
  assert.deepEqual([reordered.plan.change.summary.reordered, reordered.plan.change.summary.added, reordered.plan.change.summary.removed], [true, [], []]);
  await M.approveRequest(reordered.requestId, owner);
  assert.equal((await resolvePublicMenu("en", "en"))[0].label, "Contact");
  // remove Install, add Privacy
  const next = [s[5], s[0], s[1], s[3], s[4], { page: "privacy", label: both("Privacy", "Confidentialité") }];
  const changed = (await call(token, "navigation_set", { entries: next })).value;
  assert.deepEqual([changed.plan.change.summary.added, changed.plan.change.summary.removed], [["Privacy"], ["Install"]]);
  await M.approveRequest(changed.requestId, owner);
  assert.deepEqual((await resolvePublicMenu("en", "en")).map((i) => i.label), ["Contact", "Home", "What is Curiosa", "Blog", "Press kit", "Privacy"]);
});

test("submenus: one level, 8 entries, a label in every language, at least one child", async () => {
  const { token } = await direct();
  const ok = await call(token, "navigation_set", { entries: [{ page: "home" }, { label: both("Learn", "Découvrir"), children: [{ instance: "pages", entry: aboutPage }, { instance: "pages", entry: installPage }] }] });
  assert.equal(ok.value.status, "done", JSON.stringify(ok));
  const items = await resolvePublicMenu("en", "en");
  assert.deepEqual([items[1].label, items[1].children.map((c) => c.label)], ["Learn", ["What is Curiosa", "Install"]]);
  assert.match((await call(token, "navigation_set", { entries: [{ label: both("A", "A"), children: [{ label: both("B", "B"), children: [{ page: "home" }] }] }] })).error, /another submenu/);
  assert.match((await call(token, "navigation_set", { entries: [{ label: both("A", "A"), children: [] }] })).error, /give a target/);
  assert.match((await call(token, "navigation_set", { entries: [{ children: [{ page: "home" }] }] })).error, /label is needed/);
  const nine = Array.from({ length: 9 }, (_, i) => ({ externalUrl: `https://example.org/${i}`, label: both(`L${i}`, `L${i}`) }));
  assert.match((await call(token, "navigation_set", { entries: [{ label: both("Many", "Beaucoup"), children: nine }] })).error, /8 entries at most/);
});

test("refused with plain words and an example, and NOTHING is saved: unknown or unpublished targets, languages, addresses, duplicates, caps", async () => {
  const { token } = await direct();
  await call(token, "navigation_set", { entries: [{ page: "home" }] });
  const before = JSON.stringify(await menuNow());
  const draft = (await createEntry(db.prisma, { instanceId: pages.id, locale: "en", title: "Draft", status: "draft" })).id;
  const bad = async (entries, re) => { const r = await call(token, "navigation_set", { entries }); assert.match(r.error ?? "", re, JSON.stringify(entries)); assert.equal(JSON.stringify(await menuNow()), before, "nothing was saved"); };
  await bad([{ page: "nowhere" }], /unknown page "nowhere".*home, privacy/);
  await bad([{ instance: "ghost" }], /unknown instance "ghost"/);
  await bad([{ instance: "pages", entry: draft }], /no published entry/);
  await bad([{ instance: "pages", entry: "nope" }], /no published entry "nope"/);
  await bad([{ path: "/does-not-exist" }], /no page of this site is at "\/does-not-exist"/);
  await bad([{ path: "contact" }], /starting with "\/"/);
  await bad([{ externalUrl: "http://example.org", label: both("A", "A") }], /full https address/);
  await bad([{ externalUrl: "https://user:pass@example.org", label: both("A", "A") }], /without a password/);
  await bad([{ externalUrl: "javascript:alert(1)", label: both("A", "A") }], /https address/);
  await bad([{ externalUrl: "https://example.org" }], /label is needed.*en, fr/);
  await bad([{ externalUrl: "https://example.org", label: { en: "Only English" } }], /missing in fr/);
  await bad([{ page: "home", label: { en: "A", fr: "B", de: "C" } }], /"de" is not a language of this site/);
  await bad([{ page: "home", label: both("<b>Home</b>", "Accueil") }], /contains HTML/);
  await bad([{ page: "home", label: both("x".repeat(81), "Accueil") }], /longer than 80/);
  await bad([{ page: "home" }, { page: "home" }], /appears twice/);
  await bad([{ page: "home", instance: "pages" }], /ONE target/);
  await bad([{ page: "home", colour: "red" }], /unexpected field "colour"/);
  await bad([], /would be empty/);
  await bad(Array.from({ length: 41 }, (_, i) => ({ externalUrl: `https://example.org/${i}`, label: both("a", "a") })), /40 entries at most/);
  assert.match((await call(token, "navigation_set", {})).error, /Give "entries"/);
  assert.match((await call(token, "navigation_set", { entries: [], more: 1 })).error, /unexpected argument "more"/);
  // every problem of one call is listed, not just the first
  const many = (await call(token, "navigation_set", { entries: [{ page: "nowhere" }, { instance: "ghost" }] })).error;
  assert.match(many, /entries\[0\].*entries\[1\]/);
  assert.equal(await Q.pendingCount(), 0, "a refusal never creates a request");
});

test("a path starting with / finds the page: home, module page, entry at the root or under a module, short link", async () => {
  const { token } = await direct();
  await db.prisma.redirect.create({ data: { path: "ig", targetUrl: "https://example.org/ig", active: true } });
  const entries = ["/", "/blog", "/install", "/fr/contact", "/ig"].map((path) => ({ path }));
  const r = await call(token, "navigation_set", { entries });
  assert.equal(r.value.status, "done", JSON.stringify(r));
  assert.deepEqual((await menuNow()).map((n) => n.kind), ["system", "instance", "entry", "entry", "redirect"]);
  const got = (await call(token, "navigation_get")).value.entries;
  assert.deepEqual(got.map((e) => e.kind), ["site_page", "module_page", "content_entry", "content_entry", "short_link"]);
  assert.equal(got[4].path, "/ig");
});

test("approval \"ask me first\": a request, nothing changed, the owner reads it in words and approves; a change by someone else in between is not overwritten", async () => {
  const { token } = await access();
  const r = (await call(token, "navigation_set", { entries: SHOWCASE() })).value;
  assert.equal(r.status, "pending_approval");
  assert.equal(r.action, "navigation_set");
  assert.equal((await menuNow()).length, 0, "nothing before the approval");
  assert.equal((await call(token, "maintenance_request_status", { requestId: r.requestId })).value.status, "pending_approval");
  const req = await Q.getRequest(r.requestId);
  assert.match(describeRequest(req, makeTranslator("en"), (x) => x), /Change the menu of your site: 0 entries now, 6 afterwards\. Added: Home, What is Curiosa, Install, Blog, Press kit, Contact\./);
  assert.match(describeRequest(req, makeTranslator("fr"), (x) => x), /Changer le menu de votre site : 0 entrées aujourd'hui, 6 ensuite\. Ajouté : Home/);
  assert.equal((await call(token, "navigation_set", { entries: SHOWCASE() })).value.requestId, r.requestId, "the same call returns the waiting request");
  // someone edits the menu by hand before the owner answers
  const edited = JSON.stringify({ version: 1, items: [{ kind: "system", ref: "privacy" }] });
  await db.prisma.setting.upsert({ where: { key_locale: { key: "nav.menu", locale: "" } }, create: { key: "nav.menu", locale: "", value: edited }, update: { value: edited } });
  const stale = await M.approveRequest(r.requestId, owner);
  assert.equal(stale.ok, false);
  assert.match(stale.message, /changed by someone else/);
  assert.deepEqual((await menuNow()).map((n) => n.ref), ["privacy"], "the person's menu is kept");
  // a fresh request on the new state is approved normally
  const fresh = (await call(token, "navigation_set", { entries: SHOWCASE() })).value;
  assert.equal((await M.approveRequest(fresh.requestId, owner)).ok, true);
  assert.equal((await menuNow()).length, 6);
  assert.equal((await M.approveRequest(fresh.requestId, owner)).ok, false, "a second approval does nothing");
});

test("approval \"act without asking\": applied at once, no request; the previous state is kept and restorable from the admin (only while untouched)", async () => {
  const { token } = await direct();
  await call(token, "navigation_set", { entries: [{ page: "home", label: both("Start", "Début") }] });
  const r = (await call(token, "navigation_set", { entries: SHOWCASE() })).value;
  assert.equal(r.status, "done");
  assert.equal((await Q.listRequests()).length, 0);
  const point = await NAV.navigationRestorePoint();
  assert.equal(point.by, "Camille");
  assert.equal((await NAV.restoreNavigation("owner@example.org")).ok, true);
  assert.deepEqual((await menuNow()).map((n) => n.label?.en), ["Start"], "the menu from before the AI change is back");
  assert.equal(await NAV.navigationRestorePoint(), null, "one restore, then nothing left to restore");
  assert.deepEqual(await NAV.restoreNavigation("owner@example.org"), { ok: false, reason: "none" });
  // a person edits after the AI: restoring would erase their work, so it is refused
  await call(token, "navigation_set", { entries: SHOWCASE() });
  await db.prisma.setting.update({ where: { key_locale: { key: "nav.menu", locale: "" } }, data: { value: JSON.stringify({ version: 1, items: [{ kind: "system", ref: "home" }] }) } });
  assert.equal(await NAV.navigationRestorePoint(), null);
  assert.deepEqual(await NAV.restoreNavigation("owner@example.org"), { ok: false, reason: "changed" });
});

test("home page: keep by id, reorder, remove, replace; a module section is checked against what its module declares", async () => {
  const { token } = await direct();
  const make = (await call(token, "home_sections_set", { sections: [
    { instance: banner.key, section: "hero" },
    { instance: "pages", section: "latest", options: { count: 2 }, size: "medium" },
    { instance: blog.key, section: "latest" },
  ] })).value;
  assert.equal(make.status, "done", JSON.stringify(make));
  const [a, b, c] = (await call(token, "home_sections_list")).value.sections;
  assert.deepEqual([b.options, b.size, c.options], [{ count: 2 }, "medium", { count: 3 }]);
  // reorder + remove by ids alone
  const r = (await call(token, "home_sections_set", { sections: [{ id: c.id }, { id: a.id }] })).value;
  assert.equal(r.status, "done");
  assert.deepEqual((await getSetting("home.sections")).map((s) => s.id), [c.id, a.id]);
  // replace: an id with fields keeps the id and takes the new definition
  await call(token, "home_sections_set", { sections: [{ id: c.id, instance: blog.key, section: "latest", options: { count: 5 } }, { id: a.id }] });
  const after = await getSetting("home.sections");
  assert.deepEqual([after[0].id, after[0].options], [c.id, { count: 5 }]);
  const bad = async (sections, re) => { const x = await call(token, "home_sections_set", { sections }); assert.match(x.error ?? "", re, JSON.stringify(sections)); assert.deepEqual((await getSetting("home.sections")).map((s) => s.id), [c.id, a.id], "nothing was saved"); };
  await bad([{ id: "nope" }], /no section with the id "nope"/);
  await bad([{ instance: "ghost", section: "x" }], /Unknown instance: "ghost"/);
  await bad([{ instance: "pages", section: "hero" }], /does not offer a section "hero"\. It offers: latest/);
  await bad([{ instance: "pages", section: "latest", options: { count: "many" } }, { instance: "pages", section: "latest", options: { colour: 1 } }], /options\.count.*options.*"colour" is not an option/);
  await bad([{ instance: "pages", section: "latest", size: "huge" }], /size: one of small, medium, large, full/);
  await bad([{ id: c.id }, { id: c.id }], /listed twice/);
  await bad([{ block: { kind: "cta", title: both("a", "a") }, instance: "pages", section: "latest" }], /"block" OR an "instance"/);
});

test("text blocks are data: every language, plain text only, links to the site or https, pictures of the site or https; never HTML, scripts or styles", async () => {
  const { token } = await direct();
  const cta = (over = {}) => ({ block: { kind: "cta", title: both("Hello", "Bonjour"), ...over } });
  const bad = async (section, re) => { const x = await call(token, "home_sections_set", { sections: [section] }); assert.match(x.error ?? "", re, JSON.stringify(section)); assert.equal(await getSetting("home.sections"), undefined, "nothing was saved"); };
  await bad(cta({ title: { en: "Only English" } }), /the fr text is missing/);
  await bad(cta({ title: both("<script>alert(1)</script>", "x") }), /contains HTML/);
  await bad(cta({ text: both("<img src=x onerror=alert(1)>", "x") }), /contains HTML/);
  await bad(cta({ buttonLabel: both("Go", "Aller"), buttonUrl: "javascript:alert(1)" }), /address of this site starting with "\/"/);
  await bad(cta({ buttonLabel: both("Go", "Aller") }), /needs both buttonLabel and buttonUrl/);
  await bad(cta({ images: ["http://example.org/a.png"] }), /images: up to 3/);
  await bad(cta({ bg: { src: "javascript:1" } }), /block\.bg/);
  await bad(cta({ style: "x" }), /unexpected field "style"/);
  await bad({ block: { kind: "iframe", title: both("a", "a") } }, /kind: must be one of media, tabs, stats, cta, video/);
  await bad({ block: { kind: "cta" } }, /nothing to show/);
  await bad(cta({ title: both("x".repeat(161), "x") }), /longer than 160/);
  const ok = await call(token, "home_sections_set", { sections: [cta({ buttonLabel: both("Go", "Aller"), buttonUrl: "https://example.org/go", images: ["https://example.org/a.png"], tone: "accent" }), { block: { kind: "stats", items: [{ title: both("42", "42"), heading: both("Pages", "Pages") }] } }] });
  assert.equal(ok.value.status, "done", JSON.stringify(ok));
  const back = (await call(token, "home_sections_list")).value.sections;
  assert.equal(back[0].block.buttonUrl, "https://example.org/go");
  assert.equal(back[1].block.items[0].title.fr, "42");
});

test("home page limits: 30 sections, 60 KB", async () => {
  const { token } = await direct();
  const block = (i) => ({ block: { kind: "cta", title: both(`T${i}`, `T${i}`) } });
  assert.match((await call(token, "home_sections_set", { sections: Array.from({ length: 31 }, (_, i) => block(i)) })).error, /30 sections at most/);
  const big = (i) => ({ block: { kind: "media", title: both("T", "T"), text: both("x".repeat(6000), "y".repeat(6000)) } , i });
  assert.match((await call(token, "home_sections_set", { sections: Array.from({ length: 6 }, (_, i) => ({ block: big(i).block })) })).error, /too large/);
});

test("approval for the home page: a request in words; applied only if nothing changed since; restorable from the admin", async () => {
  const { token } = await access();
  const r = (await call(token, "home_sections_set", { sections: [{ instance: banner.key, section: "hero" }, { block: { kind: "cta", title: both("Try", "Essayez") } }] })).value;
  assert.equal(r.status, "pending_approval");
  assert.equal(await getSetting("home.sections"), undefined);
  const text = describeRequest(await Q.getRequest(r.requestId), makeTranslator("en"), (x) => x);
  assert.match(text, /Change the home page of your site: 0 sections now, 2 afterwards\. Added: Banner \(Banner\), cta block “Try”\./);
  await setSetting("home.sections", [{ id: "mine", instance: "core", section: "block", options: { block: { kind: "cta", title: { en: "Mine", fr: "Le mien" } } } }]);
  assert.match((await M.approveRequest(r.requestId, owner)).message, /changed by someone else/);
  assert.deepEqual((await getSetting("home.sections")).map((s) => s.id), ["mine"]);
  await setSetting("home.sections", []);
  const again = (await call(token, "home_sections_set", { sections: [{ instance: banner.key, section: "hero" }] })).value;
  assert.equal((await M.approveRequest(again.requestId, owner)).ok, true);
  assert.equal((await HOME.homeRestorePoint()).by, "Camille");
  assert.equal((await HOME.restoreHome("owner@example.org")).ok, true);
  assert.deepEqual(await getSetting("home.sections") ?? [], []);
});

test("journal: who, what, when, labels only (never a text); the request and its approval are journalled; the previous state is kept for the owner", async () => {
  const { token } = await access();
  const r = (await call(token, "navigation_set", { entries: SHOWCASE() })).value;
  assert.equal((await audits("mcp.maintenance.request")).length, 1);
  await M.approveRequest(r.requestId, owner);
  const nav = await audits("navigation.update");
  assert.equal(nav.length, 1);
  assert.deepEqual([nav[0].actor, nav[0].actorKind], ["mcp:Camille", "assistant"]);
  assert.match(nav[0].target, /^0 -> 6 entries; added: Home, What is Curiosa/);
  assert.equal((await audits("mcp.maintenance.approve")).length, 1);
  assert.equal((await audits("mcp.maintenance.navigation_set")).length, 1);
  await call(token, "home_sections_set", { sections: [{ block: { kind: "cta", title: both("Private launch title", "Titre prive"), text: both("Secret paragraph", "Paragraphe secret") } }] }).then((x) => M.approveRequest(x.value.requestId, owner));
  const home = await audits("home.update");
  assert.equal(home.length, 1);
  assert.match(home[0].target, /added: cta block “Private launch title”/, "the label of the block is journalled");
  assert.ok(!JSON.stringify(await db.prisma.auditLog.findMany()).includes("Secret paragraph"), "never the text of a block");
  assert.ok((await NAV.navigationRestorePoint()) && (await HOME.homeRestorePoint()), "the previous states are kept");
});

test("rate limit: the menu and the home page use the \"content\" class (120 per hour), not the 12-per-hour counter of risky actions", async () => {
  const { token, id } = await direct(["navigation_get", "navigation_set", "maintenance_backup_run"]);
  const actor = { name: "Camille", tokenId: id };
  const set = () => M.callLevel3("navigation_set", { entries: [{ page: "home" }] }, actor);
  for (let i = 0; i < SL.MAX_CONTENT_ACTIONS_PER_HOUR; i++) assert.equal((await set()).status, "done", `call ${i + 1}`);
  await assert.rejects(set, /Too many menu or home page changes.*limit 120/);
  // the risky counter was not used up by these 120 calls
  assert.ok(!/Too many maintenance actions/.test((await call(token, "maintenance_backup_run")).error ?? ""));
  // and the other way round: using up the risky counter does not block the menu
  SL.resetContentSlots();
  for (let i = 0; i < M.MAX_ACTIONS_PER_HOUR; i++) await call(token, "maintenance_backup_run");
  assert.match((await call(token, "maintenance_backup_run")).error ?? "", /Too many maintenance actions/);
  assert.equal((await set()).status, "done");
});

test("size limit: a body above 1 MB is refused by the server before anything is read", async () => {
  const { token } = await access();
  const res = await rpc(token, "tools/call", { name: "navigation_set", arguments: { entries: [{ externalUrl: "https://example.org/" + "a".repeat(1_100_000), label: both("a", "a") }] } });
  assert.equal(res.status, 413);
});

test("maintenance_my_access names the new rights in plain words when they are not ticked, and the approval text covers them", async () => {
  const { token } = await access(["maintenance_my_access"]);
  const me = (await call(token, "maintenance_my_access")).value;
  const missing = Object.fromEntries(me.notGranted.map((n) => [n.tool, n]));
  for (const n of ["navigation_get", "navigation_set", "home_sections_list", "home_sections_set"]) assert.ok(missing[n]?.rightToTick.length > 20, n);
  assert.equal(missing.navigation_set.kind, "request");
  assert.equal(missing.navigation_get.kind, "read");
  assert.match(me.approvalSetting.meaning, /menu or the home page/);
});

test("profiles: readers in \"read\", writers in \"assistant\" (so also in \"full\"); every tool of the catalogue is still assigned", async () => {
  const catalogue = await listMcpToolCatalogue();
  assert.deepEqual(catalogue.filter((t) => P.placementOf(t) === "unassigned").map((t) => t.name), []);
  for (const n of ["navigation_get", "home_sections_list"]) assert.equal(P.placementOf(catalogue.find((t) => t.name === n)), "read", n);
  for (const n of ["navigation_set", "home_sections_set"]) {
    const t = catalogue.find((x) => x.name === n);
    assert.equal(P.placementOf(t), "assistant", n);
    assert.deepEqual(["read", "assistant", "full"].map((p) => P.profileAllows(p, t)), [false, true, true], n);
  }
  // a read-only access gets the readers from the "assistant" preset and the writers are reported as blocked
  const ro = P.applyProfile("assistant", catalogue, {}, "read");
  assert.ok(ro.blocked.includes("navigation_set") && ro.blocked.includes("home_sections_set"));
});

test("French and English: every right, request and notice of this feature exists in both languages with the same variables, in plain words", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => /^aim\.(tool\.(navigation_get|navigation_set|home_sections_list|home_sections_set)|action\.(navigation_set|home_sections_set)|risk\.(navigation_set|home_sections_set)|req\.(navigation_set|home_sections_set|change\.)|undo\.)/.test(k));
  assert.equal(keys.length, 4 + 2 + 2 + 2 + 5 + 6);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    assert.ok(typeof fr[k] === "string" && fr[k].trim(), `${k} missing in French`);
    assert.equal(vars(fr[k]), vars(en[k]), `${k}: same variables`);
    assert.ok(!/!/.test(en[k] + fr[k]) && !/\b(Veuillez|token|jeton|webhook|slug|payload|JSON|API)\b/i.test(en[k] + fr[k]), `${k}: plain words`);
  }
});
