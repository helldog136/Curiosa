// The "Home and menu" entry: one link in the sidebar, four tabs (Home, Menu, Link and button, Social buttons), each page keeping its own address.
// Old addresses keep working: /admin/home, /admin/navigation and /admin/social are still the pages; /admin/navigation#header maps to the new tab page.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { prisma } = db;
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
function renderAll(el) {
  return new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _e, cb) { out += chunk.toString(); cb(); } });
    const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
  });
}
const { RedirectError } = await import("next/navigation");
const L = await import("@/core/adminLinks");
const { setSetting } = await import("@/core/settings");

after(() => db.close());
const PANEL = "src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en"]); await setSetting("setup.completed", true);
  owner = await prisma.user.create({ data: { email: "camille@example.org", name: "Camille", role: "owner", passwordHash: "x", locale: "en" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
async function render(file, props = {}) {
  as(owner);
  const mod = await import(`../../${PANEL}/${file}`);
  try { return await renderAll(await mod.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}), ...props })); }
  catch (e) { if (e instanceof RedirectError) return `redirect:${e.url}`; throw e; }
}
const tabs = (html) => [...html.matchAll(/<a [^>]*data-tab="([a-z]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]);
const current = (html) => html.match(/<a [^>]*aria-current="page"[^>]*data-tab="([a-z]+)"|<a [^>]*data-tab="([a-z]+)"[^>]*aria-current="page"/)?.slice(1).find(Boolean);

test("the four addresses of the tabs", () => {
  assert.deepEqual(L.HOME_MENU_TAB_HREFS, { home: "/admin/home", menu: "/admin/navigation", header: "/admin/navigation/header", social: "/admin/social" });
});

test("every page of the entry shows the same title, one h1 and the four tabs, with its own tab current", async () => {
  for (const [file, id] of [["home/page.tsx", "home"], ["navigation/page.tsx", "menu"], ["navigation/header/page.tsx", "header"], ["social/page.tsx", "social"]]) {
    const html = await render(file);
    assert.deepEqual(tabs(html), [["home", "Home"], ["menu", "Menu"], ["header", "Link and button"], ["social", "Social buttons"]], file);
    assert.equal(current(html), id, `${file}: current tab`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${file}: one h1`);
    assert.match(html, /<h1[^>]*>[^]*?Home and menu<\/h1>/, file);
    for (const [, href] of Object.entries(L.HOME_MENU_TAB_HREFS)) assert.ok(html.includes(`href="${href}"`), `${file}: link ${href}`);
  }
});

test("the tabs are links: no client tab bar, so the heavy editors are not rendered together", async () => {
  const html = await render("navigation/page.tsx");
  assert.doesNotMatch(html, /role="tablist"/);
  assert.doesNotMatch(html, /name="headerButtonHref"/, "the header form lives on its own page now");
  const header = await render("navigation/header/page.tsx");
  assert.match(header, /name="headerButtonHref"/);
  assert.match(header, /name="headerSecondaryHref"/);
  assert.doesNotMatch(read(`${PANEL}/navigation/page.tsx`), /components\/admin\/Tabs"/);
});

test("old address: the menu page still maps #header to the new tab page", () => {
  const page = read(`${PANEL}/navigation/page.tsx`);
  assert.match(page, /<LegacyHash map=\{\{ header: NAVIGATION_HEADER_HREF \}\} \/>/);
  assert.equal(L.NAVIGATION_HEADER_HREF, "/admin/navigation/header");
  assert.match(read(`${PANEL}/settings/page.tsx`), /header: NAVIGATION_HEADER_HREF/, "the old settings anchor reaches the same page");
});

test("the sidebar has one link for the entry, highlighted on all four pages, and none of the three old ones", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  const site = layout.slice(layout.indexOf('t("nav.site")'), layout.indexOf('t("nav.admin")'));
  assert.match(site, /<NavLink href=\{HOME_HREF\} also=\{\[NAVIGATION_HREF, NAVIGATION_HEADER_HREF, SOCIAL_HREF\]\}>\{t\("nav\.homeMenu"\)\}<\/NavLink>/);
  assert.ok(!site.includes("nav.social") && !site.includes("nav.navigation") && !/href=\{NAVIGATION_HREF\}>/.test(site));
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  assert.equal(en["nav.homeMenu"], "Home and menu"); assert.equal(fr["nav.homeMenu"], "Accueil et menu");
  assert.equal(en["navigation.title"], "Site menu"); assert.equal(fr["navigation.title"], "Menu du site");
  for (const k of ["nav.social", "nav.navigation", "nav.navigation.simple"]) assert.ok(!(k in en) && !(k in fr), k);
});

test("tab labels: short, no colon, unique inside the page and different from the entry name (R10, R12)", () => {
  for (const lang of ["en", "fr"]) {
    const d = JSON.parse(read(`src/locales/${lang}.json`));
    const labels = ["home", "menu", "header", "social"].map((id) => d[`homemenu.tab.${id}`]);
    assert.equal(new Set(labels).size, 4);
    for (const l of labels) assert.ok(l.length <= 60 && !l.includes(":"), l);
    assert.ok(!labels.includes(d["nav.homeMenu"]));
  }
});

test("the old direct links in the page code point to the tab bar constants, not to literals", () => {
  assert.match(read("src/components/admin/HomeMenuHeader.tsx"), /HOME_MENU_TAB_HREFS\[id\]/);
});
