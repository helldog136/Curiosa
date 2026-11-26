// Admin tab titles (WCAG 2.4.2) and the skip link (WCAG 2.4.1), redesign phase C1b. Reads the source (no browser). It fails when:
//  1. an admin page that renders something has no `generateMetadata` built with `adminTitle` (the title would be the generic « Admin » of the layout);
//  2. two pages share the same name (EN or FR), a name is empty, or a name is just « Admin »;
//  3. the title is not « <page> – <site name> – Admin »;
//  4. the skip link is not the first thing of the panel layout, does not target the content area, or has no visible focus style.
// No baseline: a new page without a title fails.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (p) => fs.readFileSync(p, "utf8");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const { composeAdminTitle } = await import("@/core/adminTitleText");
const { SkipLink, ADMIN_MAIN_ID } = await import("@/components/admin/SkipLink");

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith("@") ? [] : pages(p); // @modal slots only repeat the page they open over
    return e.name === "page.tsx" ? [p] : [];
  });
}
const ALL = pages("src/app/admin");

/** Pages that only redirect (no content of their own): the browser never shows their title. Checked below: they must really only redirect. */
const REDIRECT_ONLY = new Set([
  "ai-visibility", "catalogue", "catalogue/details", "integrations", "maintenance-ia", "mcp", "mcp/[id]", "modules", "overlays", "settings/rawg-covers",
].map((p) => `src/app/admin/(panel)/${p}/page.tsx`));
/** The setup wizard keeps its own title (no site name yet, and the language is chosen on the page itself). */
const OWN_TITLE = new Set(["src/app/admin/(auth)/setup/page.tsx"]);

test("the list of admin pages is the one this test knows (a new route must be classified)", () => {
  assert.ok(ALL.length >= 55, `found ${ALL.length} pages`);
  for (const p of REDIRECT_ONLY) assert.ok(fs.existsSync(p), `${p} exists`);
});

test("redirect-only pages really only redirect", () => {
  for (const p of REDIRECT_ONLY) {
    const s = read(p);
    assert.match(s, /redirect(Legacy)?\(/, `${p} redirects`);
    assert.ok(!/<[A-Za-z][^>]*>/.test(s.replace(/<(Record|RawQuery|Params|string|ModuleQuery|Promise)[^>]*>/g, "")), `${p} renders nothing`);
  }
});

const titled = ALL.filter((p) => !REDIRECT_ONLY.has(p) && !OWN_TITLE.has(p));
const statics = []; // pages whose name is only translation keys: their names must all differ

test("every page that renders has generateMetadata built with adminTitle", () => {
  for (const p of titled) {
    const s = read(p);
    assert.match(s, /export async function generateMetadata\(/, `${p}: generateMetadata`);
    assert.match(s, /return adminTitle\(/, `${p}: uses adminTitle`);
    assert.ok(!/<title[ >]/.test(s), `${p}: no hoisted <title> next to the metadata API`);
    const body = s.slice(s.indexOf("export async function generateMetadata("), s.indexOf("export default"));
    const keys = [...body.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]);
    const dynamic = /need:/.test(body);
    for (const k of keys) {
      assert.ok(en[k] && fr[k], `${p}: ${k} exists in EN and FR`);
      assert.notEqual(en[k].trim().toLowerCase(), "admin", `${p}: ${k} is not just « Admin »`);
    }
    assert.ok(keys.length > 0 || dynamic, `${p}: a name`);
    if (!dynamic) statics.push({ p, keys });
  }
});

test("no two pages share the same name, in English and in French", () => {
  for (const [lang, d] of [["en", en], ["fr", fr]]) {
    const seen = new Map();
    for (const { p, keys } of statics) {
      const name = keys.map((k) => d[k]).join(" · ").toLowerCase();
      assert.ok(!seen.has(name), `${lang}: « ${name} » is the title of both ${seen.get(name)} and ${p}`);
      seen.set(name, p);
    }
  }
  // The pages under one data item add what they show (tab, state) so that two tabs of the same item never read alike.
  const skin = read("src/app/admin/(panel)/overlay-pages/[id]/skin/page.tsx");
  assert.match(skin, /ovp\.tab\.skin/);
});

test("the title is « page – site name – Admin »", () => {
  assert.equal(composeAdminTitle("Settings", "Etoile Nord"), "Settings – Etoile Nord – Admin");
  assert.equal(composeAdminTitle("Réglages", "Lune Douce"), "Réglages – Lune Douce – Admin");
  // an unknown page name never leaves an empty slot, and a part is never doubled
  assert.equal(composeAdminTitle("", "Etoile Nord"), "Etoile Nord – Admin");
  assert.equal(composeAdminTitle("Camille", "camille"), "Camille – Admin");
  assert.equal(composeAdminTitle("  Two   words ", "Site"), "Two words – Site – Admin");
  // every static page name gives a title that is not « Admin » alone
  for (const { keys } of statics) for (const d of [en, fr]) assert.notEqual(composeAdminTitle(keys.map((k) => d[k]).join(" · "), "Site"), "Site – Admin");
});

test("adminTitle is absolute (the layout template never doubles it) and never redirects", () => {
  const s = read("src/core/adminTitle.ts");
  assert.match(s, /absolute: composeAdminTitle/);
  assert.ok(!/redirect\(/.test(s), "a title never redirects");
  assert.match(s, /accessGate\(/, "data-reading labels only run for someone who passes the gate");
  assert.ok(!/allowForced|allowUnenrolled/.test(s.replace(/\/\*[\s\S]*?\*\//g, "")), "the title helper uses the strict session and gate: never allowForced / allowUnenrolled");
  assert.match(s, /currentUser\(\)\.catch\(\(\) => null\)/, "an unreadable or restricted session is a null user");
  assert.match(s, /opts\.need === undefined \|\| accessGate\(user, opts\.need\) === "ok"/, "a null or restricted user never passes the gate, so a data label gives the fallback");
  // no page that a forced-password session may open reads data for its title: only static translated labels
  for (const f of ["src/app/admin/(auth)/choose-password/page.tsx", "src/app/admin/(auth)/no-access/page.tsx", "src/app/admin/(auth)/login/page.tsx"]) {
    const m = read(f).match(/adminTitle\(([^;]*)\);/);
    assert.ok(m && !/need:|prisma|await/.test(m[1]), `${f}: static title only`);
  }
});

test("skip link: first in the panel layout, targets the content area, visible on focus", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  const at = (needle) => layout.indexOf(needle);
  const skip = at("<SkipLink");
  assert.ok(skip > 0, "layout renders the skip link");
  // Nothing focusable comes before it in the returned markup.
  const ret = layout.slice(layout.indexOf("  return (\n    <div"));
  const first = ret.search(/<(a|button|input|select|textarea|NavLink|NavGroup|MobileMenu|SettingsSearch|PendingButton|form)\b/);
  assert.equal(ret.indexOf("<SkipLink"), ret.search(/<SkipLink/), "found");
  assert.ok(ret.indexOf("<SkipLink") < first, "the skip link precedes every other focusable element");
  assert.match(layout, /<main id=\{ADMIN_MAIN_ID\} tabIndex=\{-1\}/, "the content area is the target and can take the focus");
  assert.ok(en["nav.skip"] && fr["nav.skip"]);
  const html = renderToStaticMarkup(React.createElement(SkipLink, { label: en["nav.skip"] }));
  assert.match(html, /^<a href="#admin-main"/, "an anchor to the content area");
  assert.equal(ADMIN_MAIN_ID, "admin-main");
  assert.match(html, /sr-only/, "hidden until focused");
  assert.match(html, /focus:not-sr-only/, "shown on focus");
  assert.match(html, /focus:outline/, "a visible focus outline");
  assert.ok(html.includes(">Skip to content<"));
});

test("only the panel layout owns the id of the content area", () => {
  for (const p of ALL) assert.ok(!read(p).includes(`id="${"admin-main"}"`), p);
});
