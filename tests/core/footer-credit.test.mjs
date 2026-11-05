// Footer credit link: ONE constant (src/core/credit.ts) gives the address, English by default and French for a French visitor; no old address is left in the core.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
await useTestDb();

const React = (await import("react")).default;
const { renderToStaticMarkup, renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
/** Renders to the end, Suspense included (the footer reads data). */
const html = (el) => new Promise((resolve, reject) => {
  let out = "";
  const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
  const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
});
const { CREDIT_SITE_URL, CREDIT_SITE_URL_FR, CREDIT_URL, creditSiteUrl } = await import("@/core/credit");
const { Footer } = await import("@/components/site/Footer");
const { CuriosaMark } = await import("@/components/brand/CuriosaMark");
const { demoConfig } = await import("../../testsupport/skins/bench/stubs/settings.mjs");

const footer = (locale) => html(React.createElement(Footer, { config: demoConfig({ locale }), locale }));
const creditLink = (out) => /<p data-testid="credit"[^>]*>[\s\S]*?<a ([^>]*)>Curiosa<\/a>/.exec(out)?.[1] ?? "";

test("the credit points to the project site: English address by default, French address for French, English for any other language", () => {
  assert.equal(CREDIT_SITE_URL, "https://curiosa.helldog136.be");
  assert.equal(CREDIT_SITE_URL_FR, "https://curiosa.helldog136.be/fr");
  assert.equal(creditSiteUrl("fr"), CREDIT_SITE_URL_FR);
  for (const l of ["en", "de", "nl", "es", "", "fr-CA"]) assert.equal(creditSiteUrl(l), CREDIT_SITE_URL, l);
});

test("the public footer renders the right link for en and fr, with rel=noopener, the locked wordmark and the translated lead-in", async () => {
  for (const [locale, href, lead] of [["en", "https://curiosa.helldog136.be", "Powered by"], ["fr", "https://curiosa.helldog136.be/fr", "Propulsé par"]]) {
    const out = await footer(locale);
    const a = creditLink(out);
    assert.ok(a.includes(`href="${href}"`), `${locale}: ${a}`);
    assert.match(a, /rel="noopener"/);
    assert.match(a, /data-skin-part="brand-mark"/);
    assert.match(a, /data-curiosa-wordmark=""/);
    assert.match(out, new RegExp(`data-testid="credit"[^>]*>${lead}(<!-- -->)? <a `));
    assert.doesNotMatch(out, /github\.com\/helldog136/, "no repository address in the public footer");
  }
});

test("the admin footer keeps the project repository (the mark without a language)", () => {
  const out = renderToStaticMarkup(React.createElement(CuriosaMark, { newTab: true }));
  assert.ok(out.includes(`href="${CREDIT_URL}"`));
  assert.match(out, /target="_blank"/);
});

test("the footer address is written in ONE place of the core", () => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(tsx?|mjs|json)$/.test(e.name) && /curiosa\.helldog136\.be/.test(fs.readFileSync(f, "utf8"))) hits.push(f); } };
  walk("src");
  assert.deepEqual(hits, [path.join("src", "core", "credit.ts")]);
});
