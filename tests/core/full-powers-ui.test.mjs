import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Full powers of an AI access (core 0.35.0), the screens: the window, the chip on the row, the banner, the access page, and every text (EN + FR).
// The window itself is driven in a real browser for the screenshots of the pull request; here: what the server renders, the gesture rule and the wiring.
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (f) => fs.readFileSync(f, "utf8");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const { FullPowersWindow } = await import("@/components/admin/FullPowersWindow");
const { removalConfirmed } = await import("@/components/admin/removalConfirm");
const { fullPowersLabels } = await import("../../src/app/admin/(panel)/assistants/fullPowersLabels.ts");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { AUDIT_ACTIONS, auditLabelKey } = await import("@/core/auditLabels");
const { forbiddenWords, toneProblems, labelProblems, HELP_INLINE_MAX } = await import("../../testsupport/ergonomics.mjs");

const PANEL = "src/app/admin/(panel)";
const KEYS = Object.keys(en).filter((k) => k.startsWith("fullpowers.") || k.startsWith("aim.my.fullPowers") || k.startsWith("audit.action.mcp.fullpowers."));
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("the window: the page only holds the button (closed); the window is a modal without any form, so Enter cannot send it", () => {
  const labels = fullPowersLabels(makeTranslator("en"), "etoile_nord");
  const html = renderToStaticMarkup(h(FullPowersWindow, { labels, name: "etoile_nord", grant: async () => null }));
  assert.match(html, /data-testid="fullpowers-open"/);
  assert.match(html, />Give full powers</);
  assert.ok(!/fullpowers-confirm|fullpowers-window/.test(html), "nothing of the window until the button is pressed");
  const src = read("src/components/admin/FullPowersWindow.tsx");
  assert.ok(!/<form\b/.test(src), "no form element");
  assert.match(src, /disabled=\{!ok\}/, "the red button is disabled until the name is typed");
  assert.match(src, /if \(e\.key === "Enter"\) e\.preventDefault\(\)/);
  assert.match(src, /variant="dangerSolid"/);
  assert.match(src, /role="alert"[^>]*data-testid="fullpowers-warning"/, "the warning that prevents a loss is always visible in the window");
});

test("the gesture: only the exact name of the access (no case, no accents, no extra spaces) arms the button; nothing typed never does", () => {
  const name = "Étoile Nord";
  assert.equal(removalConfirmed("erase", { checked: true, typed: "", name }), false);
  assert.equal(removalConfirmed("erase", { checked: true, typed: "lune_douce", name }), false);
  assert.equal(removalConfirmed("erase", { checked: false, typed: "  etoile   nord ", name }), true);
});

test("the window lists what it allows and what it never allows, in the person's words, in both languages", () => {
  for (const lang of ["en", "fr"]) {
    const labels = fullPowersLabels(makeTranslator(lang), "etoile_nord");
    assert.equal(labels.allows.length, 4);
    assert.equal(labels.outside.length, 5);
    assert.ok(labels.title.includes("etoile_nord") && labels.example.includes("etoile_nord"));
    for (const text of [...labels.allows, ...labels.outside, labels.warning, labels.title, labels.submit, labels.open]) assert.ok(text && !/^fullpowers\./.test(text), `${lang}: a missing text`);
  }
  const outside = fullPowersLabels(makeTranslator("en"), "x").outside.join(" ");
  for (const word of ["accesses", "secrets", "approval", "limits", "test version"]) assert.match(outside, new RegExp(word));
});

test("texts: EN and FR in step (same keys, same {variables}), the French is not the English, and the rules of the admin hold (R9 words, R10 labels, R11 helps, R13 tone)", () => {
  assert.ok(KEYS.length >= 35);
  for (const k of KEYS) {
    assert.ok(typeof en[k] === "string" && en[k].length, `en misses ${k}`);
    assert.ok(typeof fr[k] === "string" && fr[k].length, `fr misses ${k}`);
    assert.equal(vars(fr[k]), vars(en[k]), k);
    if (en[k].length > 30) assert.notEqual(fr[k], en[k], `${k}: French text identical to the English one`);
  }
  // The AI-facing sentences (aim.my.*) are for assistants, in the site language: only the tone and the words are checked for everything else.
  const SHOWN = KEYS.filter((k) => k.startsWith("fullpowers."));
  for (const [lang, d] of [["en", en], ["fr", fr]]) {
    for (const k of SHOWN) {
      assert.deepEqual(forbiddenWords(d[k], "core"), [], `${lang} ${k}: forbidden word`);
      assert.deepEqual(toneProblems(d[k], lang), [], `${lang} ${k}: tone`);
    }
    for (const k of SHOWN.filter((k) => /\.(chip|title|open|turnOff|submit|cancel|close|typeName|allowsTitle|outsideTitle)$/.test(k))) assert.deepEqual(labelProblems(d[k]), [], `${lang} ${k}: label`);
    assert.ok(d["fullpowers.dialog.example"].length <= HELP_INLINE_MAX, "example under the field");
  }
  // The French wording the owner asked for.
  assert.equal(fr["fullpowers.chip"], "Tous les pouvoirs");
});

test("the journal knows the four lines (on, off, one per dangerous action, cleared by a restore) in both languages", () => {
  for (const a of ["mcp.fullpowers.on", "mcp.fullpowers.off", "mcp.fullpowers.action", "mcp.fullpowers.cleared"]) {
    assert.ok(AUDIT_ACTIONS.includes(a), a);
    assert.equal(auditLabelKey(a), `audit.action.${a}`);
    assert.ok(en[`audit.action.${a}`] && fr[`audit.action.${a}`], a);
  }
  assert.match(en["audit.action.mcp.fullpowers.action"], /under full powers/);
});

test("wiring: the chip is on the access row and the page header while any access holds it, with an off switch at the same place; only the owner sees the switches", () => {
  const row = read(`${PANEL}/users/assistantMembers.tsx`);
  assert.match(row, /data-testid="fullpowers-chip"/);
  assert.match(row, /ui\.chipDanger/);
  assert.match(row, /full && t\("fullpowers\.chip"\)/, "searchable");
  const page = read(`${PANEL}/assistants/page.tsx`);
  assert.match(page, /fullPowers\.length > 0/);
  assert.match(page, /data-testid="fullpowers-banner"/);
  assert.match(page, /\{owner && <form action=\{turnOffFullPowersAction/);
  const access = read(`${PANEL}/assistants/[id]/page.tsx`);
  assert.match(access, /\(fullPowers \|\| \(owner && row\.ownerId && row\.coarseCeiling\)\)/, "only the owner, and only for an access that predates the owners and now has one");
  assert.match(access, /owner && writes && \(fullPowers/);
  assert.match(access, /<FullPowersWindow/);
  assert.match(access, /data-testid="fullpowers-all"/, "the per-tool checkboxes give way to one read-only line, in the same card");
  assert.match(access, /\{!fullPowers && <GrantsEditor/);
  assert.match(access, /fullpowers\.help/, "the approval note is a tooltip");
  assert.match(access, /<HelpTip[^>]*always/);
});

test("the access page, the row and the requests tab compute rights WITH the switch (nothing is read from a stored list)", () => {
  for (const f of [`${PANEL}/assistants/[id]/page.tsx`, `${PANEL}/users/assistantMembers.tsx`, `${PANEL}/assistants/RequestsTab.tsx`]) assert.match(read(f), /fullPowers/, f);
  assert.ok(!/fullPowers[^;\n]*grants\[/.test(read("src/core/services/mcp/access.ts")), "the switch never writes into the grants");
  assert.match(read("src/core/services/mcp/server.ts"), /token\.fullPowers && dangerousUnderFullPowers\(tool\)/);
});
