// Core 0.14.0, three additive keys for admin panels: `refreshWhile` (soft self-refresh with a limit), `adminForm.submitStyle: "secondary"`, single-line status pills.
// The behaviour in a real browser (refresh without reload, stop after the limit, pill at 390 px) is checked with Playwright (screenshots listed in the pull request).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (f) => fs.readFileSync(f, "utf8");
const R = await import("@/core/adminkit/refresh");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { AdminTable } = await import("@/components/admin/AdminTable");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { Badge } = await import("@/components/admin/Badge");
const { KNOWN_BLOCKS } = await import("../../testsupport/requirements/runtime.mjs");

/* ───────────── refreshWhile ───────────── */

test("refresh schedule: 3 s for 30 s, then 10 s up to 3 minutes, then it stops (never loops forever)", () => {
  assert.equal(R.nextRefreshDelay(0), 3000);
  assert.equal(R.nextRefreshDelay(29_999), 3000);
  assert.equal(R.nextRefreshDelay(30_000), 10_000);
  assert.equal(R.nextRefreshDelay(179_999), 10_000);
  assert.equal(R.nextRefreshDelay(180_000), null);
  assert.equal(R.nextRefreshDelay(10 * 60_000), null);
  assert.equal(R.nextRefreshDelay(0, 5), 5000);
  assert.equal(R.nextRefreshDelay(60_000, 20), 20_000, "never faster than asked");
  assert.equal(R.nextRefreshDelay(0, 0), 2000, "bounds: 2 to 30 seconds");
  assert.equal(R.nextRefreshDelay(0, 999), 30_000);
  assert.equal(R.nextRefreshDelay(0, NaN), 3000);
  // The total number of refreshes is bounded.
  let t = 0, n = 0;
  for (let d = R.nextRefreshDelay(t); d !== null && n < 1000; d = R.nextRefreshDelay(t)) { t += d; n++; }
  assert.ok(n <= 10 + 15 + 1, `at most ~26 refreshes, got ${n}`);
});

test("refreshWhile block: admin panel only, only while pending, soft refresh, polite status, 44 px retry, motion-safe dot", () => {
  const blocks = read("src/components/site/Blocks.tsx");
  assert.match(blocks, /case "refreshWhile":[\s\S]{0,300}RefreshWhile && panelInstanceId && !entryScope && block\.pending === true/);
  assert.match(read("src/components/site/adminKit.ts"), /RefreshWhile/, "reaches Blocks through the admin kit only (public pages ship none of it)");
  const c = read("src/components/admin/RefreshWhile.tsx");
  assert.match(c, /router\.refresh\(\)/);
  assert.doesNotMatch(c, /location\.reload|location\.href\s*=/, "never a full reload");
  assert.match(c, /role="status" aria-live="polite"/);
  assert.match(c, /motion-safe:animate-pulse/);
  assert.match(c, /min-h-11/);
  assert.match(c, /document\.hidden/, "paused in a hidden tab");
  assert.match(c, /nextRefreshDelay\(/);
  assert.match(c, /setStopped\(true\)/);
  assert.ok(KNOWN_BLOCKS.includes("refreshWhile"), "blocks.valid knows the block");
  assert.match(read("testsupport/requirements/runtime.mjs"), /refreshWhile needs pending/);
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  for (const k of ["refresh.waiting", "refresh.stopped", "refresh.again"]) { assert.ok(en[k] && fr[k], k); assert.ok(!/!/.test(en[k] + fr[k])); }
});

/* ───────────── submitStyle ───────────── */

const form = (extra = {}) => ({ type: "adminForm", action: "check", title: "Check", submitLabel: "Check now", fields: [{ name: "x", label: "X", example: "a" }], ...extra });
const render = (b) => renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(makeTranslator("en"), "en", b) }));
const submitButton = (html) => /<button[^>]*>[\s\S]*?Check now/.exec(html)[0];

test("submitStyle: secondary is outlined, absent is the usual filled button (page and dialog)", () => {
  assert.match(submitButton(render(form())), /bg-accent/);
  assert.doesNotMatch(submitButton(render(form({ submitStyle: "secondary" }))), /bg-accent/);
  assert.match(submitButton(render(form({ submitStyle: "secondary" }))), /border-line bg-surface/);
  const dlg = (extra) => render(form({ presentation: "dialog", cancelHref: "?", ...extra }));
  assert.match(/<button[^>]*data-testid="edit-dialog-submit"[^>]*>|<button[^>]*form="[^"]*"[^>]*>/.exec(dlg({}))[0], /bg-accent/);
  const sec = dlg({ submitStyle: "secondary" });
  assert.doesNotMatch(/<button[^>]*data-testid="edit-dialog-submit"[^>]*>/.exec(sec)[0], /bg-accent/);
  assert.match(read("testsupport/requirements/runtime.mjs"), /adminForm\.submitStyle must be "secondary"/);
});

/* ───────────── status pill ───────────── */

test("status pill: one line, at least 24 px, even padding, cut with an ellipsis and a tooltip, in the table and in the shared Badge", () => {
  const labels = tableLabels(makeTranslator("en"));
  const html = renderToStaticMarkup(h(AdminTable, { instanceId: "i1", labels, block: { type: "table", columns: ["Name", "State"], rowIds: ["a"], rows: [["Alert", { text: "Waiting for the next check to finish", badge: "warn" }]] } }));
  const pill = /<span data-badge=""[^>]*>[\s\S]*?<\/span><\/span>/.exec(html)[0];
  for (const re of [/whitespace-nowrap/, /min-h-6/, /max-w-full/, /px-2\.5 py-0\.5/, /leading-5/, /rounded-full/, /title="Waiting for the next check to finish"/, /<span class="min-w-0 truncate">Waiting for the next check to finish<\/span>/]) assert.match(pill, re);
  const titled = renderToStaticMarkup(h(AdminTable, { instanceId: "i1", labels, block: { type: "table", columns: ["A"], rows: [[{ text: "Ok", badge: "ok", title: "Everything answers" }]] } }));
  assert.match(titled, /data-badge=""[^>]*title="Everything answers"|title="Everything answers"[^>]*data-badge=""/);
  const shared = renderToStaticMarkup(h(Badge, { tone: "ok" }, "Official"));
  assert.match(shared, /whitespace-nowrap/); assert.match(shared, /min-h-6/);
});
