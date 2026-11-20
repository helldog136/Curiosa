import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

/**
 * FORMAL REVIEW, publication plans with a fingerprint (spec: docs/formal/approval-queue.md, invariant Q8).
 *
 *   Q8  what is published is exactly what the owner was shown when they approved: any change to the draft after the request, by anyone, by any field a visitor can see,
 *       makes the approval do nothing ("changed since the request, ask again").
 *
 * The fingerprint of a draft used to cover the texts (title, summary, body per language) and the page skin, but NOT the link (`url`), the `code`, the tags, the cover,
 * the icon or the custom fields. `<instance>__update_draft` lets the AI change `url`, `code` and `tags`, so an AI that had a publication request waiting could change
 * where the entry points after the request was made, and the owner's approval then published the changed entry (for a list of links, the link IS the content).
 * Files covered: src/core/maintenance/publish.ts (fingerprint, executeEntryPublish), src/core/content/mcp.ts (update_draft). Last synced with: core 0.46.1 branch.
 */
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools } = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const owner = { email: "owner@example.org", owner: true };
const blog = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
let news;

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  await setSetting("i18n.default", "en");
  await setSetting("i18n.enabled", ["en", "fr"]);
  await db.fixture("blog");
  news = await createInstance(db.prisma, { manifest: blog, nickname: "News", names: { en: "News" } });
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), listMcpTools);
async function call(token, name, args = {}) {
  const body = await (await rpc(token, "tools/call", { name, arguments: args })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}

/** Asks to publish a draft, lets `change` edit it while the request waits, then the owner approves. Returns what the entry looks like afterwards. */
async function publishAfter(change) {
  const token = await T.createToken("Camille", "write", "owner@example.org", { grants: { news__publish: true, news__update_draft: true, maintenance_request_status: true } });
  const e = await createEntry(db.prisma, { instanceId: news.id, locale: "en", title: "Hello", summary: "Short", body: "Text of the page", url: "https://example.org/a", code: "A1", tags: ["one"], status: "draft" });
  const asked = await call(token, "news__publish", { id: e.id });
  assert.equal(asked.value.status, "pending_approval", JSON.stringify(asked));
  await change(token, e.id);
  const decided = await M.approveRequest(asked.value.requestId, owner);
  const row = await db.prisma.entry.findUnique({ where: { id: e.id } });
  return { decided, row };
}

test("control: a change of the title after the request is not published (this already worked)", async () => {
  const { decided, row } = await publishAfter(async (token, id) => { assert.ok((await call(token, "news__update_draft", { id, title: "Another title" })).value); });
  assert.equal(row.status, "draft");
  assert.equal(decided.ok, false);
});

for (const [label, args] of [["the link (url)", { url: "https://example.org/elsewhere" }], ["the code", { code: "ZZ9" }], ["the tags", { tags: ["two"] }]]) {
  test(`${label} changed by the AI after the request: the approval does not publish the changed entry`, async () => {
    const { decided, row } = await publishAfter(async (token, id) => { assert.ok((await call(token, "news__update_draft", { id, ...args })).value); });
    assert.equal(row.status, "draft", "the owner approved a different entry: nothing is published");
    assert.equal(decided.ok, false);
    assert.match(decided.message, /changed since the request/);
  });
}

test("fields a person edits in the admin count too: cover, icon and custom fields", async () => {
  for (const data of [{ cover: "/uploads/other.png" }, { icon: "star" }, { fields: JSON.stringify({ rating: 5 }) }]) {
    await db.reset(); await db.fixture("blog");
    news = await createInstance(db.prisma, { manifest: blog, nickname: "News", names: { en: "News" } });
    const { decided, row } = await publishAfter(async (_token, id) => { await db.prisma.entry.update({ where: { id }, data }); });
    assert.equal(row.status, "draft", JSON.stringify(data));
    assert.equal(decided.ok, false);
  }
});

test("anti-vacuity: with no change after the request the same flow DOES publish, so the tests above can only fail by a real refusal", async () => {
  const { decided, row } = await publishAfter(async () => {});
  assert.equal(decided.ok, true, decided.message);
  assert.equal(row.status, "published");
  assert.equal(row.url, "https://example.org/a");
});
