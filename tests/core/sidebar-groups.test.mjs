// Sidebar sections (Content, Community, Tools, Connections) and the names of the core entries: R12 (no two entries share a name or a first word),
// "Short links" in both modes, old addresses untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const PANEL = "src/app/admin/(panel)";
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const P = await import("@/core/modules/menuPlacement");
const L = await import("@/core/adminLinks");

// The entries of the sidebar that belong to the core, in display order (keys as used in layout.tsx).
const CORE_ENTRIES = ["nav.dashboard", "nav.homeMenu", "nav.appearance", "nav.settings", "nav.redirects", "nav.extensions", "nav.overlayPages", "nav.assistants", "nav.users", "nav.maintenance", "nav.myAccount", "nav.viewSite"];
const HEADINGS = ["nav.content", "nav.community", "nav.tools", "nav.connections", "nav.site", "nav.admin", "nav.account"];

test("every core entry key is used by the layout, in both languages", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  for (const k of [...CORE_ENTRIES, ...HEADINGS]) {
    assert.ok(en[k] && fr[k], `${k} exists in EN and FR`);
    // nav.content, nav.community and nav.tools are built as `nav.${id}` from the section list.
    const used = layout.includes(`"${k}"`) || (["nav.content", "nav.community", "nav.tools"].includes(k) && layout.includes("t(`nav.${id}`)"));
    assert.ok(used, `${k} is used by layout.tsx`);
  }
});

test("R12: no two sidebar entries share a name or a first word, in English and in French", () => {
  for (const [lang, d] of [["en", en], ["fr", fr]]) {
    const names = CORE_ENTRIES.map((k) => d[k]);
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `${lang}: same name twice`);
    const first = names.map((n) => n.toLowerCase().split(/\s+/)[0]);
    assert.equal(new Set(first).size, first.length, `${lang}: same first word twice (${first.join(", ")})`);
    const heads = HEADINGS.map((k) => d[k].toLowerCase());
    assert.equal(new Set(heads).size, heads.length, `${lang}: same heading twice`);
  }
});

test("the section headings are the new words, with no \"My\" and no leftover sub-group", () => {
  assert.deepEqual(HEADINGS.slice(0, 4).map((k) => en[k]), ["Content", "Community", "Tools", "Connections"]);
  assert.deepEqual(HEADINGS.slice(0, 4).map((k) => fr[k]), ["Contenu", "Communauté", "Outils", "Connexions"]);
  for (const k of ["nav.myContent", "nav.myCommunity", "nav.mySite", "navgroup.utility", "navgroup.widget", "navgroup.other", "nav.redirects.simple"]) assert.ok(!(k in en) && !(k in fr), `${k} is gone`);
  assert.equal(en["nav.site"], "Site");
  assert.deepEqual(P.MENU_SECTIONS, ["content", "community", "tools", "connections"]);
});

test("Short links: one name in both modes, for the sidebar, the page title and the intro (B.7)", () => {
  assert.equal(en["nav.redirects"], "Short links");
  assert.equal(fr["nav.redirects"], "Liens courts");
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /<NavLink href=\{REDIRECTS_HREF\}>\{t\("nav\.redirects"\)\}<\/NavLink>/);
  const page = read(`${PANEL}/redirects/page.tsx`);
  assert.match(page, /<h1 className=\{ui\.pageTitle\}>\{t\("nav\.redirects"\)\}<\/h1>/);
  assert.match(page, /t\("redirects\.line", \{ site \}\)/);
  assert.match(en["redirects.line"], /^A short address on your site that sends visitors elsewhere\. Example: /);
  assert.match(fr["redirects.line"], /^Une adresse courte de votre site qui envoie votre public ailleurs\. Par exemple : /);
  for (const d of [en, fr]) for (const k of ["nav.redirects", "redirects.line", "redirects.empty", "redirects.add"]) assert.ok(!/redirect|redirection|shortcut|raccourci/i.test(d[k]), `${k}: one word only`);
  assert.ok(!/Link shortcuts|Raccourcis de liens/.test(JSON.stringify(en) + JSON.stringify(fr)), "the old names are gone from the texts");
});

test("old addresses: the Short links page, the site menu and the social page keep their routes", () => {
  assert.equal(L.REDIRECTS_HREF, "/admin/redirects");
  for (const f of ["redirects/page.tsx", "navigation/page.tsx", "social/page.tsx", "home/page.tsx"]) assert.ok(fs.existsSync(`${PANEL}/${f}`), f);
});

test("Connections is a collapsed group (open on its own pages, state kept in the cookie); the other three are plain lists", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /<NavGroup id="connections" title=\{t\("nav\.connections"\)\}/);
  assert.match(layout, /openByDefault=\{false\}/);
  assert.match(layout, /menu\.connections\.length > 0/, "an empty Connections group is not shown");
  assert.match(layout, /\(\[id, items\]\) => items\.length > 0 && \(/, "an empty section is not shown");
  assert.ok(!layout.includes("menu.community.items") && !layout.includes("collapsible"), "no sub-groups inside Community any more");
});

test("pages of an unpinned instance stay under Extensions, whatever section they would have had", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /const shown = new Set\(\[\.\.\.menu\.content, \.\.\.menu\.community, \.\.\.menu\.tools, \.\.\.menu\.connections\]\)/);
  assert.match(layout, /nav\.filter\(\(m\) => !shown\.has\(m\)\)/);
});

test("the Extensions list says Tools too, and its overlay family is \"OBS helpers\" (R12: not the same word as the Overlay pages entry)", () => {
  assert.equal(en["family.tools"], "Tools"); assert.equal(fr["family.tools"], "Outils");
  assert.equal(en["family.overlays"], "OBS helpers"); assert.equal(fr["family.overlays"], "Outils pour OBS");
  assert.ok(en["family.tools.help"].length <= 90 && fr["family.tools.help"].length <= 100);
});
