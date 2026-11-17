import test, { beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { png, padPng } from "../helpers/images.mjs";

// Upload limits of the AI assistants (core 0.28.0): the owner starts the daily count over, or lifts the limits for 10, 30 or 60 minutes.
// The real MCP server, the real tools, the real database (the test database) and, for media_import, a real local http server: nothing is mocked but the clock.
// Boundaries: the end time itself (limits apply again exactly at it), a reset keeps every journal line, and what is never lifted stays enforced while lifted.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools } = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const SL = await import("@/core/maintenance/slots");
const L = await import("@/core/services/mcp/uploadLift");
const MM = await import("@/core/mediaMcp");
const F = await import("@/core/trustedImageFetch");
const S = await import("@/core/trustedImageSources");
const { UPLOADS_DIR } = await import("@/core/config");

const WRITE = ["media_upload", "media_set_alt", "media_list", "media_import", "maintenance_my_access", "maintenance_request_status"];
const MB = 1024 * 1024;

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  L.resetLiftDeps();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
});
afterEach(() => L.resetLiftDeps());
after(() => db.close());

const send = (token, body) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: typeof body === "string" ? body : JSON.stringify(body) }), listMcpTools);
async function call(token, name, args = {}) {
  const res = await send(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const body = await res.json();
  if (body.error) return { error: body.error.message, status: res.status };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function access(name = "Camille") {
  const token = await T.createToken(name, "write", "owner@example.org", { grants: Object.fromEntries(WRITE.map((g) => [g, true])) });
  return { token, id: await T.findTokenId(token) };
}
const b64 = (buf) => buf.toString("base64");
const upload = (token, buf = png(8, 8)) => call(token, "media_upload", { dataBase64: b64(buf), alt: "Blue logo of Etoile Nord" });
const files = () => (fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : []);
/** The site quota used up by earlier uploads of another access (journal lines, as the real tool writes them). */
const fillQuota = (at = new Date(Date.now() - 3_600_000), n = MM.DAILY_FILES) =>
  db.prisma.auditLog.createMany({ data: Array.from({ length: n }, (_, i) => ({ actor: "mcp:lune_douce", actorKind: "assistant", action: "media.upload", target: `x${i}.png 1000 bytes`, createdAt: at })) });

// ── Start over from zero ──────────────────────────────────────────────────────────────────────

test("reset: the count starts over from now; every journal line stays; a line before the reset is ignored, a line after it counts", async () => {
  const { token } = await access();
  await fillQuota();
  assert.match((await upload(token)).error, /daily upload quota.*start the count over \("Start over from zero"\), or lift the upload limits for a few minutes \("Lift the limits"\), in Admin > AI assistants > Settings, card "Uploads by assistants"/);
  const before = await db.prisma.auditLog.count();
  await L.resetDailyQuota();
  assert.equal(await db.prisma.auditLog.count(), before, "nothing deleted or changed in the journal");
  assert.deepEqual(await MM.usedToday(), { files: 0, bytes: 0 });
  assert.ok((await upload(token)).value, "the upload passes after the reset");
  assert.equal((await MM.usedToday()).files, 1, "the line written after the reset counts");
  assert.equal(await db.prisma.auditLog.count({ where: { action: "media.upload" } }), MM.DAILY_FILES + 1);

  // With a fixed clock: a line one second before the reset is ignored, one second after counts.
  await db.prisma.auditLog.deleteMany({});
  const t0 = Date.now();
  L.liftDeps.now = () => t0;
  await L.resetDailyQuota();
  await db.prisma.auditLog.createMany({ data: [
    { actor: "mcp:x", actorKind: "assistant", action: "media.upload", target: "a.png 10 bytes", createdAt: new Date(t0 - 1000) },
    { actor: "mcp:x", actorKind: "assistant", action: "media.upload", target: "b.png 20 bytes", createdAt: new Date(t0 + 1000) },
  ] });
  assert.deepEqual(await MM.usedToday(), { files: 1, bytes: 20 });
  // 24 hours later the reset no longer matters: the rolling day is the window again.
  L.liftDeps.now = () => t0 + 86_400_000 + 500;
  assert.equal(await L.dailyWindowStart(), t0 + 500);
});

// ── Lift: the end time ────────────────────────────────────────────────────────────────────────

test("lift: 10, 30 or 60 minutes only; lifted until the end, NOT lifted exactly at the end; stop ends it at once; the end lives only in the database", async () => {
  for (const bad of [0, 5, 11, 61, 120, -10, Number.NaN]) await assert.rejects(() => L.liftLimits(bad), /not one of 10, 30, 60/, String(bad));
  assert.deepEqual([...L.LIFT_MINUTES], [10, 30, 60]);
  assert.equal(L.DEFAULT_LIFT_MINUTES, 10);
  const t0 = 1_800_000_000_000;
  L.liftDeps.now = () => t0;
  assert.equal(await L.liftedUntil(), null, "not lifted by default");
  const end = await L.liftLimits(10);
  assert.equal(end, t0 + 600_000);
  L.liftDeps.now = () => end - 1;
  assert.equal(await L.liftedUntil(), end, "one millisecond before the end: lifted");
  assert.equal((await L.mediaLimitsNow()).imageBytes, 10 * MB);
  L.liftDeps.now = () => end;
  assert.equal(await L.liftedUntil(), null, "exactly at the end: the limits apply again");
  assert.deepEqual(await L.mediaLimitsNow(), { until: null, imageBytes: 3 * MB, bodyBytes: 4_300_000, daily: true, contentCounter: true });

  // 60 minutes is the most; a stored end further away (a hand-edited database, a clock moved back) is not trusted.
  L.liftDeps.now = () => t0;
  await L.liftLimits(60);
  assert.equal(await L.liftedUntil(), t0 + 3_600_000);
  await db.prisma.setting.update({ where: { key_locale: { key: L.LIFT_KEY, locale: "" } }, data: { value: JSON.stringify(t0 + 3_600_001) } });
  assert.equal(await L.liftedUntil(), null);

  // A restart reads the same row (no timer, nothing in memory): the end does not move.
  await L.liftLimits(30);
  const row = await db.prisma.setting.findUnique({ where: { key_locale: { key: L.LIFT_KEY, locale: "" } } });
  assert.equal(JSON.parse(row.value), t0 + 1_800_000);
  L.liftDeps.now = () => t0 + 1_000;
  assert.equal(await L.liftedUntil(), t0 + 1_800_000);

  assert.equal(await L.stopLift(), true);
  assert.equal(await L.liftedUntil(), null, "stopped at once");
  assert.equal(await L.stopLift(), false, "nothing to stop");
});

// ── Lift: what it changes, and what it never changes ──────────────────────────────────────────

test("while lifted: no daily quota, a 5 MB and a 10 MB image pass (body above 4.3 MB), the content counter is not used by media_upload; after the end they are refused again", async () => {
  const { token, id } = await access();
  await fillQuota();
  const five = padPng(png(8, 8), 5 * MB);
  assert.match((await upload(token, padPng(png(8, 8), 3 * MB + 10))).error, /larger than 3 MB.*owner can lift the upload limits/);
  const big = await send(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "media_upload", arguments: { dataBase64: b64(padPng(png(8, 8), 4 * MB)), alt: "x" } } });
  assert.equal(big.status, 413);
  assert.match((await big.json()).error.message, /3 MB at most; the owner can lift this to 10 MB/);

  await L.liftLimits(10);
  await SL.setLimits(id, { content: 10 });
  for (let i = 0; i < 12; i++) assert.ok((await upload(token, png(8 + i, 8))).value, `small upload ${i} while lifted, quota full and content limit 10`);
  assert.equal((await SL.remainingSlots(id)).content.used, 0, "media_upload took no content slot");
  assert.ok((await upload(token, five)).value, "5 MB");
  assert.ok((await upload(token, padPng(png(8, 8), 10 * MB))).value, "exactly 10 MB");
  const over = await upload(token, padPng(png(8, 8), 10 * MB + 10));
  assert.match(over.error, /larger than 10 MB/);
  assert.doesNotMatch(over.error, /owner can lift/, "already lifted: no advice to lift");
  // media_set_alt is not an upload: its content counter still applies while lifted.
  const addr = (await upload(token)).value.address;
  for (let i = 0; i < 10; i++) assert.ok((await call(token, "media_set_alt", { address: addr, alt: `Text ${i}` })).value);
  assert.match((await call(token, "media_set_alt", { address: addr, alt: "Eleven" })).error, /Limit reached: 10 content actions per hour/);

  await L.stopLift();
  assert.match((await upload(token, five)).error, /3 MB at most; the owner can lift this/, "the body cap is back at once");
  SL.resetSlots(id);
  assert.match((await upload(token)).error, /daily upload quota/);
});

test("never lifted: type from the bytes, pixel limit, svg cleaning, the 14 MB body bound, the 1 MB cap of other calls, the risky counter, the rights", async () => {
  const { token, id } = await access();
  await L.liftLimits(60);
  const n = files().length;
  assert.match((await upload(token, Buffer.from("GIF89a but really a script <script>x()</script>".padEnd(5000, " ")))).error, /not a png, jpeg, webp or gif|cannot be read/);
  assert.match((await upload(token, Buffer.from("%PDF-1.7 a document announced as an image".padEnd(5 * MB, " ")))).error, /not a png, jpeg, webp or gif/, "5 MB of something else: the lifted size does not skip the type check");
  const bomb = png(8, 8); bomb.writeUInt32BE(30000, 16); bomb.writeUInt32BE(30000, 20);
  assert.match((await upload(token, bomb)).error, /too many pixels/);
  const evil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
  assert.match((await upload(token, Buffer.from(evil))).error, /svg was refused/);
  assert.equal(files().length, n, "nothing stored");
  // Bodies: above 14 MB refused even while lifted; above 1 MB refused for any other tool, and in a batch.
  assert.equal((await send(token, "x".repeat(14_000_001))).status, 413);
  const media = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "media_upload", arguments: { dataBase64: b64(padPng(png(8, 8), 5 * MB)), alt: "Big" } } };
  assert.equal((await send(token, [media])).status, 413, "not in a batch");
  assert.equal((await send(token, { ...media, params: { name: "media_set_alt", arguments: { alt: "x".repeat(2 * MB), address: "x" } } })).status, 413);
  // The risky counter (installs, updates) is never lifted.
  for (let i = 0; i < SL.DEFAULT_LIMITS.risky; i++) await SL.takeSlot(id, "risky");
  await assert.rejects(() => SL.takeSlot(id, "risky"), /Limit reached: 12 risky actions per hour/);
  // Rights per tool: an access without media_upload still cannot call it.
  const other = await T.createToken("etoile_nord", "write", "owner@example.org", { grants: { media_list: true } });
  assert.match((await upload(other)).error, /Unknown tool/);
});

// ── media_import from a trusted source ────────────────────────────────────────────────────────

test("media_import while lifted: a 5 MB image from a trusted source and the daily quota pass; the trusted list, the content counter and the checks stay", async () => {
  process.env.CURIOSA_TEST_IMPORT_LOCAL = "1";
  process.env.NODE_ENV = "test";
  let body = padPng(png(16, 12), 5 * MB);
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "image/png" }); res.end(body); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  F.importDeps.resolve = async (host) => (host === "allowed.example" || host === "other.example" ? { ok: true, addresses: ["127.0.0.1"] } : { ok: false, reason: "notfound" });
  try {
    const p = S.parseSource(`allowed.example:${port}/screens/`); assert.ok(p.ok); assert.ok((await S.addTrustedSource(p.source)).ok);
    const { token, id } = await access();
    const imp = (host = "allowed.example") => call(token, "media_import", { url: `http://${host}:${port}/screens/home.png`, alt: "Home screen of the Etoile Nord module" });
    assert.match((await imp()).error, /larger than 3 MB.*owner can lift the upload limits/);
    await L.liftLimits(10);
    assert.ok((await imp()).value, "5 MB while lifted");
    await fillQuota();
    assert.ok((await imp()).value, "no daily quota while lifted");
    assert.match((await imp("other.example")).error, /not on the trusted|trusted image source/i, "the trusted list still applies");
    assert.equal((await SL.remainingSlots(id)).content.used, 3, "media_import still takes a content slot (the refused 5 MB one, then two imports; the address outside the list took none)");
    body = Buffer.from("%PDF-1.7 not an image".padEnd(2000, " "));
    assert.match((await imp()).error, /not a png, jpeg, webp or gif/);
    await L.stopLift();
    body = png(16, 12);
    assert.match((await imp()).error, /daily image quota.*start the count over \("Start over from zero"\)/);
  } finally {
    F.resetImportDeps(); delete process.env.CURIOSA_TEST_IMPORT_LOCAL; delete process.env.NODE_ENV;
    server.closeAllConnections(); await new Promise((r) => server.close(r));
  }
});

// ── my_access, owner only, journal, texts ─────────────────────────────────────────────────────

test("my_access says whether the limits are lifted and until when (read only)", async () => {
  const { token } = await access();
  let v = (await call(token, "maintenance_my_access")).value.imageUploads;
  assert.deepEqual([v.liftedUntil, v.maxImageMB, v.dailyQuotaApplies], [null, 3, true]);
  const end = await L.liftLimits(30);
  v = (await call(token, "maintenance_my_access")).value.imageUploads;
  assert.deepEqual([v.liftedUntil, v.maxImageMB, v.dailyQuotaApplies], [new Date(end).toISOString(), 10, false]);
});

test("owner only, journalled with the owner as actor; no MCP tool and no other file writes the two settings", async () => {
  const names = (await listMcpTools()).map((t) => t.name);
  assert.ok(!names.some((n) => /lift|quota|limit/i.test(n)), names.filter((n) => /lift|quota|limit/i.test(n)).join());
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const offenders = [];
  for (const f of walk("src").filter((x) => /\.(ts|tsx)$/.test(x))) {
    if (/services\/mcp\/uploadLift\.ts$/.test(f) || /app\/admin\/\(panel\)\/assistants\/uploadLimitsActions\.ts$/.test(f)) continue;
    if (/\b(liftLimits|stopLift|resetDailyQuota|LIFT_KEY|QUOTA_FROM_KEY)\b|mcp\.media\.(liftedUntil|quotaFrom)/.test(fs.readFileSync(f, "utf8"))) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
  const actions = fs.readFileSync("src/app/admin/(panel)/assistants/uploadLimitsActions.ts", "utf8");
  const body = (fn) => actions.slice(actions.indexOf(`function ${fn}`)).split("\nexport ")[0];
  for (const [fn, action] of [["liftUploadLimitsAction", "mcp.limits.lift"], ["stopUploadLiftAction", "mcp.limits.lift.stop"], ["resetDailyQuotaAction", "mcp.media.quota.reset"]]) {
    assert.match(body(fn), /adminCtx\("owner"\)/, `${fn}: owner only`);
    assert.match(body(fn), new RegExp(`audit\\(user\\.email, "${action.replace(/\./g, "\\.")}"`), `${fn}: journalled as the owner`);
  }
  const tab = fs.readFileSync("src/app/admin/(panel)/assistants/AccessTab.tsx", "utf8");
  assert.match(tab, /\{owner && <UploadLiftBanner/);
  assert.match(tab, /\{owner && <UploadLimits/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/assistants/page.tsx", "utf8"), /owner=\{isOwner\(user\)\}/);
});

test("texts: EN and FR in exact parity (keys and variables); the journal lines have a label", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => /^(uploadLimits\.|aim\.my\.(uploads|files)\.|audit\.action\.mcp\.(limits\.lift|media\.quota))/.test(k));
  assert.equal(keys.length, 24);
  for (const k of keys) {
    assert.ok(k in fr, `${k} missing in fr`);
    assert.deepEqual([...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${k} variables`);
  }
  for (const a of ["mcp.limits.lift", "mcp.limits.lift.stop", "mcp.media.quota.reset"]) assert.ok(en[`audit.action.${a}`] && fr[`audit.action.${a}`], a);
  const card = fs.readFileSync("src/app/admin/(panel)/assistants/UploadLimits.tsx", "utf8");
  for (const m of card.matchAll(/\bt\(\s*"([\w.]+)"/g)) assert.ok(m[1] in en && m[1] in fr, m[1]);
});
