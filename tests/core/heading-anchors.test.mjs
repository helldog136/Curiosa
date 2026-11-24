// Anchor ids on the Markdown headings (core/headingId.ts + components/site/Markdown.tsx): GitHub-style slugs, duplicates, reserved ids of the site chrome,
// untrusted text without ids, scroll margin under a sticky header, and GFM tables (a header row directly followed by the separator row).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { headingSlug, createHeadingSlugger, RESERVED_HEADING_IDS, HEADING_ID_MAX, HEADING_ID_FALLBACK } = await import("@/core/headingId");
const { Markdown } = await import("@/components/site/Markdown");
const render = (text, props = {}) => renderToStaticMarkup(React.createElement(Markdown, { text, ...props }));
const ids = (html) => [...html.matchAll(/<h[1-6][^>]*\sid="([^"]*)"/g)].map((m) => m[1]);

test("slug: lowercase, accents kept, spaces to hyphens, punctuation removed", () => {
  assert.equal(headingSlug("Pas à pas, sans assistant"), "pas-à-pas-sans-assistant");
  assert.equal(headingSlug("Code d'installation"), "code-dinstallation");
  assert.equal(headingSlug("Code d’installation"), "code-dinstallation");
  assert.equal(headingSlug("Why? Because: yes!"), "why-because-yes");
  assert.equal(headingSlug("ARM et x86_64"), "arm-et-x86_64");
  assert.equal(headingSlug("  Lexicon  "), "lexicon");
  assert.equal(headingSlug("Étape 1 : Le serveur"), "étape-1--le-serveur"); // GitHub keeps both hyphens
  assert.equal(headingSlug("étape"), "étape", "decomposed accents are normalised");
});

test("slug: empty or symbol-only headings get a fallback, very long ones are capped", () => {
  assert.equal(headingSlug(""), HEADING_ID_FALLBACK);
  assert.equal(headingSlug("???"), HEADING_ID_FALLBACK);
  assert.equal(headingSlug("🚀"), HEADING_ID_FALLBACK);
  const long = headingSlug("mot ".repeat(100));
  assert.ok(long.length <= HEADING_ID_MAX);
  assert.ok(!long.endsWith("-"));
  assert.equal(headingSlug("é".repeat(500)).length, HEADING_ID_MAX);
});

test("slugger: duplicates get -1, -2 and never collide with a natural 'x-1' heading or a reserved id", () => {
  const s = createHeadingSlugger(new Set());
  assert.deepEqual(["Intro", "Intro", "Intro", "Intro 1", "Intro"].map(s), ["intro", "intro-1", "intro-2", "intro-1-1", "intro-3"]);
  assert.deepEqual(["", ""].map(createHeadingSlugger(new Set())), ["section", "section-1"]);
  const r = createHeadingSlugger();
  assert.equal(r("Content"), "content-1");
  assert.equal(r("Content"), "content-2");
});

test("every literal id of the site components is reserved, so no heading can shadow the site chrome", () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name)) files.push(p); } };
  walk("src/components/site"); walk("src/app/(site)");
  const missing = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bid="([a-z][a-z0-9-]*)"/g)) if (!RESERVED_HEADING_IDS.has(m[1])) missing.add(`${f}: ${m[1]}`);
  assert.deepEqual([...missing], []);
});

test("rendering: every heading level has an id and keeps its skin attributes", () => {
  const html = render("# Un\n\n## Pas à pas, sans assistant\n\n### Code d'installation\n\n#### Quatre\n\n##### Cinq\n\n###### Six");
  assert.deepEqual(ids(html), ["un", "pas-à-pas-sans-assistant", "code-dinstallation", "quatre", "cinq", "six"]);
  assert.equal((html.match(/data-skin-part="heading"/g) ?? []).length, 6);
  assert.match(html, /<h2 id="pas-à-pas-sans-assistant" data-skin-part="heading" data-level="2"/);
  assert.match(html, /<h3 id="code-dinstallation" data-skin-part="heading" data-level="3"/);
});

test("rendering: inline code, links, emphasis and images in a heading; duplicates and empty headings", () => {
  const html = render("## Le `script` [ici](https://example.org) **gras**\n\n## Doublon\n\n## Doublon\n\n## ![logo](/x.png)\n\n## \n\n## Content");
  assert.deepEqual(ids(html), ["le-script-ici-gras", "doublon", "doublon-1", "section", "section-1", "content-1"]);
});

test("rendering: in-page links match the ids (percent-encoding is the browser's job)", () => {
  const html = render("[pas à pas](#pas-à-pas-sans-assistant)\n\n## Pas à pas, sans assistant");
  const href = html.match(/href="(#[^"]*)"/)[1];
  assert.equal(href, "#pas-%C3%A0-pas-sans-assistant", "the renderer percent-encodes the fragment");
  assert.equal(decodeURIComponent(href.slice(1)), ids(html)[0], "decoded, it is the id");
  assert.deepEqual(ids(html), ["pas-à-pas-sans-assistant"]);
});

test("rendering: untrusted text and anchors={false} get no ids; headings carry a scroll margin for a sticky header", () => {
  assert.deepEqual(ids(render("## Titre", { untrusted: true })), []);
  assert.deepEqual(ids(render("## Titre", { anchors: false })), []);
  assert.deepEqual(ids(render("## Titre", { untrusted: true, anchors: true })), ["titre"]);
  const html = render("## A\n\n### B");
  assert.equal((html.match(/class="scroll-mt-24 /g) ?? []).length, 2);
});

test("tables: a header row directly followed by the separator and body rows renders as a table", () => {
  const html = render(fs.readFileSync("tests/fixtures/markdown-table.md", "utf8"));
  assert.match(html, /<table data-skin-part="table"/);
  assert.equal((html.match(/<th /g) ?? []).length, 2);
  assert.equal((html.match(/<tr data-skin-part="table-row"/g) ?? []).length, 4);
  assert.match(html, /<th [^>]*>Point à vérifier<\/th>/);
  assert.match(html, /href="#arm-et-x86_64"/);
  assert.ok(!html.includes("|---|"), "the separator row is not left as text");
});
