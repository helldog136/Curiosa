// Private repository access on the screen (core 0.42.0): the real components rendered with react-dom/server, in FR and EN. R1-R33 as automatic checks:
// one visible field on the short path, the code field only on demand (with its error, example and "?" bubble), a summary line and ONE "Edit" once configured,
// a named "Remove access", words of the person (R9), short labels (R10), FR/EN parity (R29), no code anywhere in the markup.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
after(() => db.close());
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { appearanceLabels } = await import("@/app/admin/(panel)/appearance/labels");
const { AppearanceLabelsProvider } = await import("@/app/admin/(panel)/appearance/AppearanceLabels");
const { PersonalRepo } = await import("@/app/admin/(panel)/appearance/PersonalRepo");
const { PrivateRepoGate } = await import("@/components/admin/PrivateAccess");
const { ACCESS_LABEL_KEYS } = await import("@/components/admin/accessLabelKeys");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const G = await import("@/core/gitAccess");
const { AccessSummary } = await import("@/components/admin/PrivateAccess");

const render = (locale, initial) => renderToStaticMarkup(React.createElement(AppearanceLabelsProvider, { labels: appearanceLabels(makeTranslator(locale)) }, React.createElement(PersonalRepo, { locale, initial })));
const inputs = (html, type) => [...html.matchAll(/<input[^>]*>/g)].filter((m) => m[0].includes(` type="${type}"`)).length;
const esc = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const REPO = "test-owner/private-assets";
const URL_ = "https://github.com/test-owner/private-assets";

for (const locale of ["fr", "en"]) {
  const t = makeTranslator(locale);
  test(`[${locale}] short path: one visible field (the address), no code field, one primary action`, () => {
    const html = render(locale);
    assert.equal(inputs(html, "url"), 1);
    assert.equal(inputs(html, "password"), 0, "the code field is not there until it is needed (R7)");
    assert.ok(!html.includes('data-testid="access-summary"'));
  });

  test(`[${locale}] refused: the code field appears with its label, example, "?" bubble and the neutral error under the address`, () => {
    const html = render(locale, { url: URL_, needsCode: true, urlError: t("skins.error.access") });
    assert.equal(inputs(html, "password"), 1);
    assert.ok(html.includes(esc(t("access.field.label"))), "label");
    assert.ok(html.includes(esc(t("access.field.example"))), "example");
    assert.ok(html.includes(esc(t("skins.error.access"))), "the neutral message");
    assert.ok(/aria-describedby="[^"]*err-repoUrl/.test(html) && html.includes('aria-invalid="true"'));
    assert.match(html, /autoComplete="new-password"|autocomplete="new-password"/i);
    assert.ok(/data-1p-ignore|data-lpignore/.test(html), "password managers are told to leave it alone");
  });

  test(`[${locale}] wrong code: the error is under the code field`, () => {
    const html = render(locale, { url: URL_, needsCode: true, codeError: t("access.error.rejected") });
    const i = html.indexOf('name="code"');
    assert.ok(i > 0 && html.indexOf(esc(t("access.error.rejected")), i) > i, "error after the code field");
  });

  test(`[${locale}] configured: a summary line, ONE Edit window, a named Remove access; no code field in the page flow`, () => {
    const html = render(locale, { url: URL_, access: { state: "configured", repo: REPO, savedAt: "2026-11-19T10:00:00.000Z" } });
    assert.ok(html.includes(esc(t("access.configured"))) && html.includes(REPO));
    assert.equal((html.match(new RegExp(`>${esc(t("access.edit"))}<`, "g")) ?? []).length, 1, "one Edit button");
    assert.ok(html.includes(esc(t("access.remove"))));
    assert.ok(html.includes(esc(t("access.field.keep"))), "the window says an empty field keeps the current code");
    const outside = html.replace(/<dialog[\s\S]*?<\/dialog>/g, "");
    assert.equal(inputs(outside, "password"), 0, "no field is visible once configured (R33)");
    assert.ok(!html.includes(esc(t("access.reenter.why"))));
  });

  test(`[${locale}] restored backup: the state is said in words, with the reason, and the way out`, () => {
    const html = render(locale, { url: URL_, access: { state: "reenter", repo: REPO } });
    assert.ok(html.includes(esc(t("access.reenter"))) && html.includes(esc(t("access.reenter.why"))) && html.includes(esc(t("access.edit"))));
  });

  test(`[${locale}] extensions: the gate shows the field with the error, or the summary when a code is saved`, () => {
    const labels = Object.fromEntries(ACCESS_LABEL_KEYS.map((k) => [k, t(k)]));
    const wrap = (el) => renderToStaticMarkup(React.createElement(HelpTipProvider, { label: "Help: {name}" }, el));
    const none = wrap(React.createElement(PrivateRepoGate, { url: URL_, access: { state: "none" }, labels, error: t("modules.error.access") }));
    assert.equal(inputs(none, "password"), 1);
    assert.ok(none.includes(esc(t("modules.error.access"))));
    const saved = wrap(React.createElement(PrivateRepoGate, { url: URL_, access: { state: "configured", repo: REPO }, labels, error: t("modules.error.access") }));
    assert.ok(saved.includes(esc(t("access.configured"))) && saved.includes(esc(t("modules.error.access"))));
  });
}

test("the texts follow the rules of the person: no code words (R9), labels short and without colon (R10), help bubble holds the steps, no exclamation or 'Veuillez' (R13), parity (R29)", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => k.startsWith("access.") || ["skins.error.access", "modules.error.access", "appearance.update.access"].includes(k));
  assert.ok(keys.length >= 25);
  const banned = /\b(token|jeton|cl[ée]|slug|webhook|payload|api|json|cache|hash|oauth)\b/i;
  for (const [lang, d] of [["en", en], ["fr", fr]]) for (const k of keys) {
    assert.equal(typeof d[k], "string", `${lang} ${k}`);
    const text = d[k];
    const helpBubble = k === "access.field.help";   // GitHub's own page is named in it: the third party imposes the word
    if (!helpBubble) assert.ok(!banned.test(text), `${lang} ${k}: ${text}`);
    assert.ok(!/!|Veuillez|Please/.test(text), `${lang} ${k}`);
    if (/^access\.(field\.label|configured|reenter|edit|remove|edit\.save)$/.test(k)) assert.ok(text.length <= 60 && !/:/.test(text), `${lang} ${k}`);
    assert.deepEqual([...(en[k].match(/\{\w+\}/g) ?? [])].sort(), [...(fr[k].match(/\{\w+\}/g) ?? [])].sort(), `variables ${k}`);
  }
  assert.ok(en["access.field.help"].length > 60 && fr["access.field.help"].length > 60, "long help lives in the bubble");
  assert.equal(en["skins.error.access"], "Address or access code to check.");
  assert.equal(fr["skins.error.access"], "Adresse ou code d'accès à vérifier.");
  assert.equal(fr["modules.error.access"], fr["skins.error.access"]);
});

const CODE = "github_pat_11FAKEFAKE0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";

test("F4: every form that holds a password field posts (method=post): a submit before the page is ready never puts the code in a URL", () => {
  const labels = Object.fromEntries(ACCESS_LABEL_KEYS.map((k) => [k, makeTranslator("en")(k)]));
  const wrap = (el) => renderToStaticMarkup(React.createElement(HelpTipProvider, { label: "Help: {name}" }, el));
  const pages = [
    wrap(React.createElement(PrivateRepoGate, { url: URL_, access: { state: "none" }, labels, error: "x" })),
    wrap(React.createElement(AccessSummary, { url: URL_, access: { state: "configured", repo: REPO }, labels, onChanged: () => {} })),
    wrap(React.createElement(AccessSummary, { url: URL_, access: { state: "reenter", repo: REPO }, labels, onChanged: () => {} })),
    render("en", { url: URL_, needsCode: true }),
    render("en", { url: URL_, access: { state: "configured", repo: REPO } }),
  ];
  let forms = 0;
  for (const html of pages) for (const m of html.matchAll(/<form\b[^>]*>/g)) { forms++; assert.match(m[0], /method="post"/i, m[0]); }
  assert.ok(forms >= 4);
  // And the code field itself is never in a form that GETs, nor has an `action` with a code in it.
  for (const html of pages) assert.ok(!/<form\b[^>]*method="get"/i.test(html));
  const sources = ["src/components/admin/PrivateAccess.tsx", "src/app/admin/(panel)/appearance/PersonalRepo.tsx"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  assert.ok((sources.match(/<form\b/g) ?? []).length === (sources.match(/<form\b[^>]*method="post"/g) ?? []).length, "every <form> of these files says method=post");
});

test("no code in the markup, rendered WITH a saved code: neither the code, nor its encoded form, nor the sealed value reaches any screen", async () => {
  assert.equal(await G.storeAccess(URL_, CODE), true);
  const row = await db.prisma.setting.findUnique({ where: { key_locale: { key: G.ACCESS_SETTING, locale: "" } } });
  const sealed = JSON.parse(row.value).entries[0].sealed;
  const b64 = Buffer.from(`x-access-token:${CODE}`).toString("base64");
  const view = await G.accessState(URL_);
  assert.equal(view.state, "configured");
  assert.deepEqual(Object.keys(view).sort(), ["repo", "savedAt", "state"], "the view carries no secret field");
  for (const locale of ["fr", "en"]) {
    const t = makeTranslator(locale);
    const labels = Object.fromEntries(ACCESS_LABEL_KEYS.map((k) => [k, t(k)]));
    const pages = [
      render(locale, { url: URL_, access: view }),
      render(locale, { url: URL_, access: view, needsCode: true }),
      renderToStaticMarkup(React.createElement(HelpTipProvider, { label: "?" }, React.createElement(PrivateRepoGate, { url: URL_, access: view, labels, error: t("modules.error.access") }))),
    ];
    for (const html of pages) for (const secret of [CODE, b64, sealed, "x-access-token"]) assert.ok(!html.includes(secret), `${locale}: ${secret.slice(0, 12)}…`);
    for (const html of pages) assert.ok(!/<input[^>]*type="password"[^>]*value="[^"]+"/.test(html), "a password field is never pre-filled");
  }
  const r = await G.accessState("https://github.com/someone-else/other-repo");
  assert.equal(r.state, "none");
});
