// Personal catalogues on the screen (core 0.47.0): the real components rendered with react-dom/server, in FR and EN. R1-R33 as automatic checks: one visible field on the
// short path, the code field only on demand, a summary with what the repository offers, ONE primary button, the plain sentence about the server, short labels (R10),
// words of the person (R9), the window of "Remove" says what stays, FR/EN parity (R29), nothing secret in the markup.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
after(() => db.close());
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { PERSONAL_LABEL_KEYS } = await import("@/app/admin/(panel)/extensions/personal/labels");
const { AddCatalogue, CatalogueActions } = await import("@/app/admin/(panel)/extensions/personal/PersonalClient");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");

const labelsOf = (t) => Object.fromEntries(PERSONAL_LABEL_KEYS.map((k) => [k, t(k)]));
const render = (el) => renderToStaticMarkup(React.createElement(HelpTipProvider, { label: "Help: {name}" }, el));
const inputs = (html, type) => [...html.matchAll(/<input[^>]*>/g)].filter((m) => m[0].includes(` type="${type}"`)).length;
const esc = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const URL_ = "https://github.com/etoile_nord/my-extensions";
const VIEW = { ok: true, address: URL_, name: "my-extensions", access: { state: "configured", repo: "etoile_nord/my-extensions", savedAt: "2026-11-20T10:00:00.000Z" }, alreadyAdded: false,
  offers: [{ id: "etoile-nord", name: "Etoile", version: "1.0.0", ready: true }, { id: "lune-douce", name: "Lune", version: "2.0.0", ready: false, needsCore: "9.0.0" }],
  refused: [{ id: "blog", text: "blog: the official catalogue already has an extension with this name. It is not offered." }] };

test("FR and EN have the same personal texts, with the same {variables}", () => {
  const en = makeTranslator("en"), fr = makeTranslator("fr");
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of [...PERSONAL_LABEL_KEYS, "personal.refused.clash", "personal.refused.duplicate", "personal.refused.elsewhere", "personal.intro", "personal.tip", "hub.tab.personal", "catalogue.pill.personal", "catalogue.personalWarning", "backup.report.moduleAccess"]) {
    assert.notEqual(en(k), k, `EN ${k}`); assert.notEqual(fr(k), k, `FR ${k}`);
    assert.equal(vars(en(k)), vars(fr(k)), `${k}: same variables`);
  }
});

for (const locale of ["fr", "en"]) {
  const t = makeTranslator(locale);
  const labels = labelsOf(t);

  test(`[${locale}] short path: one visible field (the address), no code field, one primary button`, () => {
    const html = render(React.createElement(AddCatalogue, { labels }));
    assert.equal(inputs(html, "url"), 1);
    assert.equal(inputs(html, "password"), 0, "the code field is not there until it is needed (R7)");
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.ok(html.includes(esc(t("personal.check"))));
  });

  test(`[${locale}] private repository: the code field appears with its error under it`, () => {
    const html = render(React.createElement(AddCatalogue, { labels, initial: { url: URL_, needsCode: true, codeError: t("access.error.rejected") } }));
    assert.equal(inputs(html, "password"), 1);
    const i = html.indexOf('name="code"');
    assert.ok(i > 0 && html.indexOf(esc(t("access.error.rejected")), i) > i);
    assert.ok(html.includes(esc(t("personal.check.code"))));
  });

  test(`[${locale}] summary: what is offered, what is refused and why, the name, ONE primary button and the sentence about the server`, () => {
    const html = render(React.createElement(AddCatalogue, { labels, initial: { url: URL_, view: VIEW } }));
    assert.ok(html.includes("Etoile") && html.includes("Lune"));
    assert.ok(html.includes(esc(t("personal.needsCore", { core: "9.0.0" }))), "an extension this site cannot install is said, with the version it needs");
    assert.ok(html.includes("blog: the official catalogue"));
    assert.ok(html.includes(esc(t("personal.found", { n: 2, ready: 1 }))));
    assert.ok(html.includes(esc(t("personal.trust"))), "the plain warning stays on screen (R24)");
    assert.equal(inputs(html, "url"), 0);
    assert.equal(inputs(html, "text") + inputs(html, "search"), 1, "only the name is left to fill, prefilled");
    assert.ok(html.includes(esc(t("personal.add"))));
    assert.ok(!/(github_pat_|Authorization|x-access-token)/i.test(html));
  });

  test(`[${locale}] a row: at most two visible actions; the remove window says what stays`, () => {
    const el = (installed) => React.createElement(CatalogueActions, { id: "c", name: "Camille", address: URL_, installed, access: { state: "configured", repo: "etoile_nord/my-extensions" }, needsAccess: false, labels, initial: { open: "remove" } });
    const html = render(el(3));
    assert.equal((html.match(/data-testid="catalogue-primary"/g) ?? []).length, 1);
    assert.ok(html.includes(esc(t("personal.remove.kept", { n: 3 }))), "keeps running, only stops receiving updates");
    assert.ok(render(el(0)).includes(esc(t("personal.remove.nothing"))));
    const needs = render(React.createElement(CatalogueActions, { id: "c", name: "Camille", address: URL_, installed: 0, access: { state: "reenter", repo: "etoile_nord/my-extensions" }, needsAccess: true, labels }));
    assert.ok(needs.includes(esc(t("access.edit"))), "when access is needed the main button is the access one");
  });

  test(`[${locale}] labels are short, without a final colon (R10), and say no internal word (R9)`, () => {
    for (const k of ["personal.url", "personal.name", "personal.check", "personal.check.code", "personal.add", "personal.refresh", "personal.remove"]) {
      assert.ok(t(k).length <= 60 && !t(k).endsWith(":") && !t(k).endsWith(" :"), k);
    }
    const visible = [...PERSONAL_LABEL_KEYS.filter((k) => k.startsWith("personal.")), "personal.intro", "personal.error.index", "personal.error.access", "personal.reason.access"].map((k) => t(k)).join(" ");
    assert.ok(!/\b(token|jeton|webhook|slug|payload|JSON|OAuth|hash|SSE|cache|route|instance|clé)\b/i.test(visible), visible);
    assert.ok(!/!/.test(visible), "no exclamation mark (R13)");
  });
}
