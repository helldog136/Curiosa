import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";

// The brand SVG files of the repository carry role, aria-label and <title>. The sanitiser (shared by the admin logo upload, the media_upload
// tool of the assistants, page backgrounds and skins) must accept these safe accessibility features and keep refusing everything dangerous.
const { sanitizeSvg, LOGO_SVG_LIMITS } = await import("@/core/svg");

const BRAND_DIR = path.join(process.cwd(), "docs", "brand");
const BRAND_FILES = fs.readdirSync(BRAND_DIR).filter((f) => f.endsWith(".svg"));
const wrap = (inner, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs ? ` ${attrs}` : ""}>${inner}</svg>`;
const clean = (svg) => { const r = sanitizeSvg(svg, undefined, "contain", "center", LOGO_SVG_LIMITS); assert.equal(r.ok, true, JSON.stringify(r)); return r.svg; };
const refused = (svg) => { const r = sanitizeSvg(svg, undefined, "contain", "center", LOGO_SVG_LIMITS); assert.equal(r.ok, false, `should be refused: ${String(svg).slice(0, 90)}`); return r.error; };

test("brand files: there are some, and every docs/brand/*.svg passes the sanitiser", () => {
  assert.ok(BRAND_FILES.length >= 5, `brand files found: ${BRAND_FILES.join(", ")}`);
  for (const file of BRAND_FILES) {
    const out = clean(fs.readFileSync(path.join(BRAND_DIR, file), "utf8"));
    assert.match(out, /<svg [^>]*role="img"/, `${file}: role kept`);
    assert.match(out, /aria-label="Curiosa"/, `${file}: aria-label kept`);
    assert.match(out, /<title>Curiosa<\/title>/, `${file}: title kept`);
    assert.ok(!/<script|on\w+=|href=/i.test(out), `${file}: nothing active in the result`);
  }
});

test("brand files: the admin logo path (saveSvgUpload) stores every docs/brand/*.svg", async () => {
  process.env.DATA_DIR = makeTempDir("curiosa-svg-brand-");
  const { saveSvgUpload } = await import("@/core/logoUpload");
  for (const file of BRAND_FILES) {
    const r = await saveSvgUpload(fs.readFileSync(path.join(BRAND_DIR, file)));
    assert.match(r.url ?? `refused: ${JSON.stringify(r)}`, /^\/uploads\/[0-9a-f-]{36}\.svg$/, file);
  }
});

test("accessibility: role, aria-label, aria-labelledby, aria-hidden, focusable, title and desc are accepted and written back", () => {
  const out = clean(wrap('<title id="t">Logo of Etoile Nord</title><desc>Four rounded bricks forming a C</desc><rect width="1" height="1" aria-hidden="true"/>', 'role="graphics-document" aria-labelledby="t" focusable="false"'));
  assert.match(out, /<svg [^>]*role="graphics-document"/);
  assert.match(out, /aria-labelledby="t"/);
  assert.match(out, /focusable="false"/);
  assert.match(out, /<title id="t">Logo of Etoile Nord<\/title>/);
  assert.match(out, /<desc>Four rounded bricks forming a C<\/desc>/);
  assert.match(out, /<rect [^>]*aria-hidden="true"/);
  for (const role of ["img", "presentation", "none", "graphics-document"]) assert.match(clean(wrap("<rect/>", `role="${role}"`)), new RegExp(`role="${role}"`));
  assert.match(clean(wrap("<rect/>", `aria-label="Étoile du nord, logo d'accueil"`)), /aria-label="Étoile du nord, logo d'accueil"/, "accents and apostrophes are plain text");
  assert.equal(clean(wrap("<title>   </title><rect/>")), '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><rect/></svg>', "an empty title is dropped");
});

test("accessibility: the plain text is stored escaped, never as markup", () => {
  const out = clean(wrap("<title>Tom's logo</title><rect/>", `aria-label="It's 100% round"`));
  assert.ok(out.includes("<title>Tom's logo</title>") && out.includes(`aria-label="It's 100% round"`));
  assert.ok(!/<(?!\/?(svg|title|rect)\b)/.test(out), out);
});

test("attacks still refused: scripts, handlers, outside references, foreignObject, styles, links, entities", () => {
  const cases = [
    [wrap("<script>alert(1)</script>"), /<script>/],
    [wrap('<rect onclick="x()"/>'), /event/],
    [wrap("<rect/>", 'onload="alert(1)"'), /event/],
    [wrap('<image href="https://evil.example/x.png"/>'), /<image>/],
    [wrap('<use href="https://evil.example/x.svg#a"/>'), /#id/],
    [wrap('<use xlink:href="data:image/svg+xml;base64,AAAA"/>'), /#id|special|not accepted/],
    [wrap('<a href="javascript:alert(1)"><rect/></a>'), /<a>/],
    [wrap("<foreignObject><div/></foreignObject>"), /foreignObject/],
    [wrap("<style>@import url(https://evil.example/x.css)</style>"), /<style>/],
    [wrap('<rect style="fill:url(https://evil.example/x)"/>'), /url\(#id\)/],
    [wrap('<rect fill="url(https://evil.example/x)"/>'), /url\(#id\)/],
    [wrap("<text>hello</text>"), /<text>/],
    ['<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap("<rect/>"), /DOCTYPE/],
    [wrap("<rect/>", 'aria-label="&#60;script&#62;"'), /plain text/],
    [wrap("<title>&lt;b&gt;</title>"), /plain text/],
  ];
  for (const [svg, re] of cases) assert.match(refused(svg), re, svg.slice(0, 80));
});

test("accessibility attacks refused: markup, scripts and tricks hidden in title, desc and aria attributes", () => {
  // <title> holding script-like text, an element, a CDATA section or an entity
  assert.match(refused(wrap("<title><script>alert(1)</script></title>")), /plain text/);
  assert.match(refused(wrap("<title>Logo <b>bold</b></title>")), /plain text/);
  assert.match(refused(wrap("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>")), /plain text/);
  assert.match(refused(wrap("<desc>a<img src=x onerror=alert(1)>b</desc>")), /plain text/);
  assert.match(refused(wrap("<title><![CDATA[<script>]]></title>")), /CDATA/);
  assert.match(refused(wrap("<title>never closed")), /plain text|text/);
  assert.match(refused(wrap("<title>a</desc>")), /plain text/);
  assert.match(refused(wrap("</title><script>alert(1)</script>")), /misplaced|<script>/);
  // length caps (title 200, desc 500, aria-label 120) and invisible / control characters
  assert.match(refused(wrap(`<title>${"a".repeat(201)}</title>`)), /too long/);
  assert.match(refused(wrap(`<desc>${"a".repeat(501)}</desc>`)), /too long/);
  assert.match(refused(wrap("<rect/>", `aria-label="${"a".repeat(121)}"`)), /too long/);
  assert.match(refused(wrap("<rect/>", `aria-label="${"a".repeat(100000)}"`)), /too heavy|too long/);
  assert.match(refused(wrap("<title>evil‮txt.exe</title>")), /plain text/);
  assert.match(refused(wrap("<title>a\u0000b</title>")), /plain text/);
  // role: a value outside the allow-list, whatever it looks like
  for (const role of ["button", "link", "application", "img button", "IMG", "javascript:alert(1)", "", "img;x"]) assert.match(refused(wrap("<rect/>", `role="${role}"`)), /role/, `role=${role}`);
  refused(wrap("<rect/>", `role="<script>"`));
  // aria-label: markup, quotes, entities
  for (const label of ["<script>alert(1)</script>", "a&amp;b", "x<y", "a>b"]) refused(wrap("<rect/>", `aria-label="${label}"`));
  // aria-labelledby, aria-hidden, focusable: strict values only
  assert.match(refused(wrap("<rect/>", 'aria-labelledby="https://evil.example/x"')), /ids/);
  assert.match(refused(wrap("<rect/>", 'aria-labelledby="a;b"')), /ids/);
  assert.match(refused(wrap("<rect/>", 'aria-hidden="yes"')), /true or false/);
  assert.match(refused(wrap("<rect/>", 'focusable="javascript:1"')), /true, false or auto/);
  // duplicates, and accessibility values never slip in through style=""
  assert.match(refused(wrap("<rect/>", 'role="img" role="none"')), /duplicate/);
  assert.ok(!clean(wrap('<rect style="role:button;aria-label:x"/>')).includes("role"), "style properties that are not drawing properties are dropped");
});
