// Admin redesign C5m: AI assistants pages use the shared bricks; the security surface (gates, actions, audit) is unchanged. Source-level checks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");
const A = "src/app/admin/(panel)/assistants";
const page = read(`${A}/page.tsx`), access = read(`${A}/AccessTab.tsx`), requests = read(`${A}/RequestsTab.tsx`), history = read(`${A}/HistoryTab.tsx`), sheet = read(`${A}/[id]/page.tsx`), owners = read(`${A}/OwnersTab.tsx`);
const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));

test("gates unchanged: both pages still need core:mcp.tokens, no bug-report link on the page (the sidebar block keeps the only one)", () => {
  assert.match(page, /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/);
  assert.match(sheet, /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/);
  assert.doesNotMatch(page, /BugReportLink/);
  for (const f of [requests, history, owners]) assert.doesNotMatch(f, /BugReportLink/);
});

test("tabs and banners use the shared bricks; a banner always carries its action", () => {
  assert.match(read(`${A}/AssistantTabs.tsx`), /<LinkTabs/);
  assert.match(page, /<AttentionCard tone="danger" alert/);
  assert.match(page, /<AttentionCard tone="warn" title=\{t\("owners\.pending"/);
  assert.doesNotMatch(page, /<Callout/);
  assert.match(access, /<AttentionCard tone="warn" title=\{t\("assistants\.off\.title"\)/);
  assert.match(access, /ConfirmButton message=\{t\("assistants\.master\.confirm"\)\}/, "pausing everything still asks first");
});

test("approvals: one main action per request, the same server actions, live search on every list", () => {
  assert.match(requests, /<ConfirmButton danger=\{false\} primary message=\{t\("aim\.approveConfirm"/);
  assert.match(requests, /approveRequestAction\.bind\(null, r\.id\)/);
  assert.match(requests, /denyRequestAction\.bind\(null, r\.id\)/);
  assert.match(requests, /<ApprovalChoice current=\{mode\} onChange=\{setApprovalAction\.bind\(null, k\.row\.id\)\}/);
  assert.match(requests, /scope="requests"/);
  assert.match(requests, /scope="approval"/);
  assert.match(history, /scope="ai-history"/);
  assert.match(requests, /<Segmented[^>]*name="notify"/);
});

test("one assistant: states are pills, the destructive action stays alone in the danger zone", () => {
  assert.match(sheet, /<StatusPill tone=\{urlOn \? "warn" : "neutral"\}/);
  assert.match(sheet, /<DangerZone title=\{t\("assistants\.revoke"\)\}[^>]*>\s*<form action=\{revokeTokenAction\.bind\(null, id\)\}><ConfirmButton message=\{t\("assistants\.revokeConfirm"/);
  assert.doesNotMatch(sheet, /<p className="text-sm leading-6 text-muted">\{t\("aim\.limits\.help"\)\}/, "R32: the precision is in the tooltip");
});

test("new texts exist in both languages and sit before the colour group", () => {
  for (const k of ["aim.notify.where", "assistants.approval.search", "assistants.requests.search", "assistants.history.search", "assistants.approval.noRiskPill"]) assert.ok(en[k] && fr[k], k);
  const keys = Object.keys(en);
  assert.ok(keys.indexOf("assistants.history.search") < keys.indexOf("theme.ember"));
  assert.equal(keys.at(-1), "settings.contrast.accent2");
});
