import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { png, padPng } from "../helpers/images.mjs";

// Images and site settings for an AI: media_upload / media_list / media_set_alt and site_settings_get / site_settings_set.
// Rules under test: the type is read from the bytes, the stored name is random, svg is cleaned by the logo pipeline, size and pixel limits, no URL fetching,
// rights and ceiling, rate and daily limits, the journal never holds bytes, site_settings_set follows the approval setting and cannot touch forbidden fields.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools, listMcpToolCatalogue } = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const S = await import("@/core/maintenance/settings");
const SL = await import("@/core/maintenance/slots");
const P = await import("@/core/services/mcp/profiles");
const { setSetting, getSetting } = await import("@/core/settings");
const { UPLOADS_DIR } = await import("@/core/config");
const { describeRequest } = await import("../../src/app/admin/(panel)/assistants/requestsShared.ts");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { createInstance } = await import("@/core/instanceService");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const owner = { email: "owner@example.org", owner: true };
const WRITE = ["media_upload", "media_set_alt", "media_list", "site_settings_get", "site_settings_set", "maintenance_request_status"];

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  await setSetting("i18n.default", "en");
  await setSetting("i18n.enabled", ["en", "fr"]);
  await setSetting("site.name", "Etoile Nord", "en");
  await setSetting("site.name", "Etoile Nord", "fr");
});
after(() => db.close());

const send = (token, body) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: typeof body === "string" ? body : JSON.stringify(body) }), listMcpTools);
const rpc = (token, method, params = {}) => send(token, { jsonrpc: "2.0", id: 1, method, params });
const listed = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  const body = await res.json();
  if (body.error) return { error: body.error.message, status: res.status };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function access(grant = WRITE, scope = "write", name = "Camille") {
  const token = await T.createToken(name, scope, "owner@example.org", { grants: Object.fromEntries(grant.map((g) => [g, true])) });
  return { token, id: await T.findTokenId(token) };
}
const b64 = (buf) => buf.toString("base64");
const audits = (prefix) => db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } });
const files = () => (fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : []);
const upload = (token, buf = png(8, 8), over = {}) => call(token, "media_upload", { dataBase64: b64(buf), alt: "Blue logo of Etoile Nord", ...over });

// ── Catalogue, rights and profiles ────────────────────────────────────────────────────────────

test("tools: flags, rights and profiles (read: media_list, site_settings_get; assistant: the three writers); never granted by default", async () => {
  const tools = Object.fromEntries((await listMcpTools()).map((t) => [t.name, t]));
  for (const n of ["media_list", "site_settings_get"]) assert.deepEqual([tools[n].readOnly, tools[n].default, tools[n].destructive], [true, false, false], n);
  for (const n of ["media_upload", "media_set_alt", "site_settings_set"]) assert.deepEqual([tools[n].readOnly, tools[n].default, tools[n].destructive], [false, false, false], n);
  assert.equal(tools.site_settings_set.request, true, "a request that follows the approval setting");
  assert.ok(!Object.keys(tools).some((n) => /media_(delete|remove)/.test(n)), "no deletion tool");
  const placement = Object.fromEntries(Object.keys(tools).filter((n) => /^(media|site_settings)_/.test(n)).map((n) => [n, P.placementOf(tools[n])]));
  assert.deepEqual(placement, { media_list: "read", media_upload: "assistant", media_import: "assistant", media_set_alt: "assistant", site_settings_get: "read", site_settings_set: "assistant" });
  const plain = await T.createToken("Brouillons", "write", "o");
  assert.deepEqual((await listed(plain)).filter((n) => /^(media|site_settings)_/.test(n)), [], "nothing without the right");
  const cat = await listMcpToolCatalogue();
  assert.equal(cat.filter((t) => P.profileAllows("read", t) && /^(media_upload|site_settings_set)$/.test(t.name)).length, 0);
});

test("no right: refused as an unknown tool; a read-only access can never write, whatever is ticked", async () => {
  const none = await access(["media_list"]);
  assert.match((await upload(none.token)).error, /Unknown tool/);
  assert.match((await call(none.token, "site_settings_set", { name: { en: "X" } })).error, /Unknown tool/);
  const readOnly = await access(WRITE, "read");
  assert.deepEqual((await listed(readOnly.token)).filter((n) => /^(media|site_settings)_/.test(n)).sort(), ["media_list", "site_settings_get"]);
  assert.match((await upload(readOnly.token)).error, /Unknown tool/);
  assert.match((await call(readOnly.token, "media_set_alt", { address: "/uploads/x.png", alt: "x" })).error, /Unknown tool/);
  assert.equal(files().length, 0);
});

// ── media_upload ──────────────────────────────────────────────────────────────────────────────

test("upload: a png is stored under a random name in /uploads, listed with its text, size and date; the journal has the name and the size, never the bytes", async () => {
  const { token } = await access();
  const buf = png(40, 30);
  const { value } = await upload(token, buf, { name: "../../etc/Logo final.png" });
  assert.match(value.address, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  assert.deepEqual([value.type, value.bytes, value.width, value.height, value.alt], ["image/png", buf.length, 40, 30, "Blue logo of Etoile Nord"]);
  assert.deepEqual(files(), [value.address.replace("/uploads/", "")]);
  assert.ok(fs.readFileSync(path.join(UPLOADS_DIR, files()[0])).equals(buf));
  const rows = await audits("media.upload");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actorKind, "assistant");
  assert.ok(rows[0].target.includes(files()[0]) && rows[0].target.includes(`${buf.length} bytes`));
  assert.ok(!rows[0].target.includes(b64(buf).slice(0, 40)) && !rows[0].target.includes("/etc"), "no bytes, no path");
  assert.match(rows[0].target, /sent as "Logo final\.png"/);
  const list = (await call(token, "media_list")).value;
  assert.deepEqual([list.total, list.page, list.pages, list.perPage], [1, 1, 1, 50]);
  assert.deepEqual([list.items[0].address, list.items[0].alt, list.items[0].bytes], [value.address, "Blue logo of Etoile Nord", buf.length]);
  assert.ok(!Number.isNaN(Date.parse(list.items[0].uploadedAt)));
});

test("upload: the type is read from the bytes, never from the name or the declared type", async () => {
  const { token } = await access();
  const text = await upload(token, Buffer.from("hello, this is not an image at all"), { name: "photo.png" });
  assert.match(text.error, /not a png, jpeg, webp or gif/);
  const exe = await upload(token, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]), { name: "logo.jpg" });
  assert.match(exe.error, /not a png/);
  const mp4 = await upload(token, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(40)]), { name: "movie.png" });
  assert.match(mp4.error, /not a png/, "a video is refused here even though the admin accepts it");
  const html = await upload(token, Buffer.from("<html><script>alert(1)</script></html>"));
  assert.ok(html.error);
  assert.equal(files().length, 0, "nothing was written");
  assert.equal((await audits("media.upload")).length, 0);
});

test("upload: size (3 MB), base64, alternative text and pixel limits", async () => {
  const { token } = await access();
  const big = padPng(png(8, 8), 3 * 1024 * 1024 + 10);
  assert.match((await upload(token, big)).error, /larger than 3 MB.*Resize or compress/);
  const ok = padPng(png(8, 8), 3 * 1024 * 1024 - 100);
  const r = await upload(token, ok);
  assert.ok(r.value, "just under 3 MB passes the web server limit too (the body is about 4 MB)");
  assert.match((await call(token, "media_upload", { dataBase64: "data:image/png;base64," + b64(png(8, 8)), alt: "x" })).error, /without the "data:/);
  assert.match((await call(token, "media_upload", { dataBase64: "not base64 !!", alt: "x" })).error, /plain base64/);
  assert.match((await call(token, "media_upload", { dataBase64: b64(png(8, 8)) })).error, /alt/);
  assert.match((await upload(token, png(8, 8), { alt: "   " })).error, /alt/);
  assert.match((await upload(token, png(8, 8), { alt: "a".repeat(126) })).error, /shorten it to 125/);
  assert.match((await upload(token, png(8, 8), { alt: "line\u0000break" })).error, /control characters/);
  // A header that announces a huge picture (a decompression bomb) is refused without decoding it.
  const bomb = png(8, 8); bomb.writeUInt32BE(30000, 16); bomb.writeUInt32BE(30000, 20);
  assert.ok((await upload(token, bomb)).error, "too many pixels");
  assert.equal(files().length, 1);
});

test("upload: a svg with a script is refused; a clean svg is stored cleaned, never as received", async () => {
  const { token } = await access();
  const evil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
  assert.match((await upload(token, Buffer.from(evil))).error, /svg was refused/);
  assert.match((await upload(token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="x()"><rect width="10" height="10"/></svg>'))).error, /refused/);
  assert.equal(files().length, 0);
  const clean = '<?xml version="1.0"?><!-- drawn by hand --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#336699"/></svg>';
  const cleanRes = await upload(token, Buffer.from(clean));
  const { value } = cleanRes;
  assert.match(value.address, /\.svg$/);
  const stored = fs.readFileSync(path.join(UPLOADS_DIR, files()[0]), "utf8");
  assert.ok(!stored.includes("drawn by hand") && !stored.includes("<?xml") && stored.includes("rect"), "re-written from what is recognised");
});

test("upload: the server never fetches an address (a url is not an accepted argument)", async () => {
  const { token } = await access();
  assert.match((await call(token, "media_upload", { url: "https://example.org/a.png", alt: "x" })).error, /unexpected argument "url"/);
  assert.match((await call(token, "media_upload", { dataBase64: "https://example.org/a.png", alt: "x" })).error, /plain base64/);
});

test("upload: rate limit per access (the everyday counter), daily quota for the whole site", async () => {
  const a = await access(WRITE, "write", "A");
  await SL.setLimits(a.id, { content: 10 });
  for (let i = 0; i < 10; i++) assert.ok((await upload(a.token, png(8 + i, 8))).value, `upload ${i}`);
  assert.match((await upload(a.token)).error, /Limit reached: 10 content actions per hour for this access\. Next slot in \d+ min/);
  SL.resetSlots(a.id);
  assert.ok((await upload(a.token)).value, "after a reset");
  // The daily quota counts the journal of the last 24 hours, all accesses together.
  await db.prisma.auditLog.deleteMany({});
  await db.prisma.auditLog.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ actor: "mcp:B", actorKind: "assistant", action: "media.upload", target: `x${i}.png 1000 bytes` })) });
  const b = await access(WRITE, "write", "B2");
  assert.match((await upload(b.token)).error, /daily upload quota/);
});

test("body size: only a single media_upload call may exceed 1 MB; everything else stays refused", async () => {
  const { token } = await access();
  const big = b64(padPng(png(8, 8), 2 * 1024 * 1024));
  const call1 = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "media_upload", arguments: { dataBase64: big, alt: "Big" } } };
  assert.equal((await send(token, call1)).status, 200);
  assert.equal((await send(token, [call1])).status, 413, "not in a batch");
  assert.equal((await send(token, { ...call1, params: { name: "media_set_alt", arguments: { alt: big, address: "x" } } })).status, 413);
  assert.equal((await send(token, "x".repeat(4_400_000))).status, 413);
});

test("media_set_alt: changes the text of an existing upload; the old text is in the journal; unknown or tricky addresses are refused", async () => {
  const { token } = await access();
  const { value } = await upload(token);
  const r = await call(token, "media_set_alt", { address: value.address, alt: "New text" });
  assert.deepEqual([r.value.alt, r.value.previousAlt], ["New text", "Blue logo of Etoile Nord"]);
  assert.equal((await call(token, "media_list")).value.items[0].alt, "New text");
  assert.match((await audits("media.alt"))[0].target, /Blue logo of Etoile Nord.*→.*New text/);
  for (const bad of ["/uploads/../secret.png", "/uploads/00000000-0000-0000-0000-000000000000.png", "https://example.org/a.png", `${value.address}?c=1`, "../uploads/x.png", "/uploads/%2e%2e/a.png"]) {
    assert.ok((await call(token, "media_set_alt", { address: bad, alt: "x" })).error, bad);
  }
});

test("media_list: 50 per page, newest first; says where an image is used (logo, content)", async () => {
  const { token } = await access();
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (let i = 0; i < 53; i++) { const f = path.join(UPLOADS_DIR, `00000000-0000-0000-0000-${String(i).padStart(12, "0")}.png`); fs.writeFileSync(f, png(2, 2)); fs.utimesSync(f, new Date(2026, 0, 1, 0, i), new Date(2026, 0, 1, 0, i)); }
  const p1 = (await call(token, "media_list")).value;
  assert.deepEqual([p1.items.length, p1.total, p1.pages], [50, 53, 2]);
  assert.equal(p1.items[0].id, "00000000-0000-0000-0000-000000000052.png");
  assert.equal((await call(token, "media_list", { page: 2 })).value.items.length, 3);
  await setSetting("site.logoWide", "/uploads/00000000-0000-0000-0000-000000000052.png");
  const used = (await call(token, "media_list")).value.items[0];
  assert.deepEqual(used.usedBy, ["logo wide"]);
});

// ── Site settings ─────────────────────────────────────────────────────────────────────────────

test("site_settings_get: the identity of the site and the languages (read only), no secret", async () => {
  const { token } = await access();
  await setSetting("site.tagline", "Notes from the north", "en");
  await setSetting("site.contactEmail", "hello@example.org");
  const v = (await call(token, "site_settings_get")).value;
  assert.deepEqual([v.name.en, v.name.fr, v.tagline.en, v.contactEmail], ["Etoile Nord", "Etoile Nord", "Notes from the north", "hello@example.org"]);
  assert.deepEqual([v.languages.default, v.languages.enabled], ["en", ["en", "fr"]]);
  assert.deepEqual(Object.keys(v.logos).sort(), ["favicon", "share", "square", "squareDark", "wide", "wideDark"]);
  assert.ok(!/secret|password|token|smtp/i.test(JSON.stringify(v)));
});

const FORBIDDEN = { defaultLocale: "fr", locales: ["en"], enabledLocales: ["en"], timezone: "Europe/Paris", domain: "example.net", users: "x", roles: "x", password: "x", secret: "x", smtp: "x" };

test("site_settings_set cannot touch forbidden fields: languages, addresses, people, secrets, security", async () => {
  const { token } = await access();
  for (const [k, v] of Object.entries(FORBIDDEN)) {
    const r = await call(token, "site_settings_set", { [k]: v });
    assert.match(r.error, /cannot be changed through MCP.*Only the owner changes/, k);
  }
  assert.match((await call(token, "site_settings_set", { name: { en: "X" }, somethingElse: 1 })).error, /unexpected argument/);
  assert.equal((await Q.listRequests()).length, 0);
  assert.equal(await getSetting("i18n.default"), "en");
});

test("site_settings_set (ask first): a request with old -> new, nothing changes until the owner approves; applied once, journalled", async () => {
  const { token, id } = await access();
  const r = (await call(token, "site_settings_set", { name: { en: "Etoile du Nord" }, tagline: { en: "Notes", fr: "Notes du nord" }, contactEmail: "hello@example.org" })).value;
  assert.equal(r.status, "pending_approval");
  assert.match(r.plan.site.names, /name \(en\): "Etoile Nord" → "Etoile du Nord"/);
  assert.match(r.plan.site.names, /contact e-mail: \(empty\) → "hello@example\.org"/);
  assert.equal(await getSetting("site.name", "en"), "Etoile Nord", "nothing changed");
  // The owner reads it in plain words, in both languages.
  const req = await Q.getRequest(r.requestId);
  for (const l of ["en", "fr"]) assert.match(describeRequest(req, makeTranslator(l), (x) => x), /Etoile Nord.*Etoile du Nord/);
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, true, done.message);
  assert.equal(await getSetting("site.name", "en"), "Etoile du Nord");
  assert.equal(await getSetting("site.name", "fr"), "Etoile Nord", "only the language that was given");
  assert.equal(await getSetting("site.tagline", "fr"), "Notes du nord");
  assert.equal(await getSetting("site.contactEmail"), "hello@example.org");
  const j = (await audits("settings.update")).at(-1);
  assert.equal(j.actorKind, "assistant");
  assert.match(j.target, /name \(en\): was "Etoile Nord"/);
  assert.equal((await M.approveRequest(r.requestId, owner)).ok, false, "approved once only");
  assert.equal((await call(token, "maintenance_request_status", { requestId: r.requestId })).value.status, "done");
  void id;
});

test("site_settings_set (act without asking): applied at once, the old values are in the journal; a value changed by a person since the request is not overwritten", async () => {
  const { token, id } = await access();
  await S.setApprovalMode(id, "direct");
  const r = (await call(token, "site_settings_set", { name: { en: "Nouvelle Etoile" } })).value;
  assert.equal(r.status, "done");
  assert.equal(await getSetting("site.name", "en"), "Nouvelle Etoile");
  assert.match((await audits("settings.update")).at(-1).target, /name \(en\): was "Etoile Nord"/);
  // ask-first: somebody edits the name after the request
  await S.setApprovalMode(id, "human");
  const pending = (await call(token, "site_settings_set", { name: { en: "Etoile Polaire" } })).value;
  await setSetting("site.name", "Edited by hand", "en");
  const done = await M.approveRequest(pending.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /changed since the request/);
  assert.equal(await getSetting("site.name", "en"), "Edited by hand");
});

test("site_settings_set: same limits as the admin, every problem listed, nothing saved, plain words with an example", async () => {
  const { token } = await access();
  const r = await call(token, "site_settings_set", { name: { en: "", de: "Name" }, tagline: { en: "t".repeat(201) }, contactEmail: "not an address", presentation: { en: "p".repeat(20001) } });
  for (const part of [/name \(en\): cannot be empty, for example "Etoile Nord"/, /language "de" is not enabled.*enabled: en, fr/, /tagline \(en\): 201 characters, at most 200/, /contactEmail: write one address, for example "hello@example\.org"/, /presentation \(en\): 20001 characters, at most 20000/]) assert.match(r.error, part);
  assert.match(r.error, /^Nothing was saved/);
  assert.equal((await Q.listRequests()).length, 0);
  assert.match((await call(token, "site_settings_set", { name: { en: "Etoile Nord" } })).error, /Nothing to change/);
  assert.match((await call(token, "site_settings_set", { name: { en: "Line\nbreak" } })).error, /line breaks/);
  assert.match((await call(token, "site_settings_set", {})).error, /Give at least one of/);
});

test("site_settings_set: logos only from an image already on the site; outside addresses, tricks, missing files and a svg sharing image are refused", async () => {
  const { token, id } = await access();
  await S.setApprovalMode(id, "direct");
  const up = (await upload(token, png(20, 20))).value.address;
  for (const bad of ["https://example.org/logo.png", "http://x/a.png", "/uploads/../../etc/passwd", "/uploads/00000000-0000-0000-0000-000000000000.png", `${up}?c=1`, "javascript:alert(1)", "//evil.example/a.png", "/other/a.png"]) {
    const r = await call(token, "site_settings_set", { logos: { wide: bad } });
    assert.match(r.error, /logos\.wide:/, bad);
  }
  assert.match((await call(token, "site_settings_set", { logos: { huge: up } })).error, /unknown slot/);
  const svg = (await upload(token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'))).value.address;
  assert.match((await call(token, "site_settings_set", { logos: { share: svg } })).error, /do not show svg/);
  assert.equal((await call(token, "site_settings_set", { logos: { wide: up, square: svg, share: up } })).value.status, "done");
  const cfg = (await call(token, "site_settings_get")).value.logos;
  assert.deepEqual([cfg.wide, cfg.square, cfg.share, cfg.favicon], [up, svg, up, null]);
  assert.equal((await call(token, "site_settings_set", { logos: { wide: "" } })).value.status, "done");
  assert.equal((await call(token, "site_settings_get")).value.logos.wide, null, "an empty string removes it");
  assert.match((await audits("settings.update")).at(-1).target, new RegExp(`wide logo: was "${up.replace(/[/.]/g, "\\$&")}"`), "the old address stays readable in the journal");
});

// ── Press kit / module settings ───────────────────────────────────────────────────────────────

test("an upload from media_upload is accepted by an image setting of a module through maintenance_module_configure", async () => {
  await db.fixture("hero");
  const manifest = FIXTURE_MODULES.find((m) => m.manifest.id === "hero").manifest;
  const inst = await createInstance(db.prisma, { manifest, nickname: "Banner", names: { en: "Banner" } });
  const { token } = await access([...WRITE, "maintenance_module_configure", "maintenance_module_settings"]);
  const { address } = (await upload(token)).value;
  const r = await call(token, "maintenance_module_configure", { instance: inst.key, changes: { poster: address } });
  assert.ok(r.value, JSON.stringify(r));
  assert.deepEqual(r.value.rejected ?? [], []);
  assert.equal(await getSetting(`instance.${inst.id}.poster`), address);
  const bad = await call(token, "maintenance_module_configure", { instance: inst.key, changes: { poster: "/uploads/../x.png" } });
  void bad;
});

// ── my_access, instructions, parity ───────────────────────────────────────────────────────────

test("my_access reports the hourly limits per class (limit, remaining, next slot) and the new rights in plain words", async () => {
  const { token, id } = await access([...WRITE, "maintenance_my_access"]);
  await SL.setLimits(id, { content: 10 });
  for (let i = 0; i < 3; i++) await upload(token, png(8 + i, 8));
  const v = (await call(token, "maintenance_my_access")).value;
  assert.deepEqual([v.hourlyLimits.content.limit, v.hourlyLimits.content.used, v.hourlyLimits.content.remaining, v.hourlyLimits.content.nextSlotInMinutes], [10, 3, 7, null]);
  assert.deepEqual([v.hourlyLimits.risky.limit, v.hourlyLimits.risky.remaining], [12, 12]);
  const media = v.granted.find((g) => g.tool === "media_upload");
  assert.match(media.summary, /Send an image to your site/);
  assert.match(v.approvalSetting.meaning, /site settings/);
  const server = fs.readFileSync("src/core/services/mcp/server.ts", "utf8");
  assert.match(server, /media_upload.*site_settings_get and site_settings_set/);
});

test("limits: defaults, bounds, separate classes, reset; the setting is bounded", async () => {
  assert.deepEqual(SL.DEFAULT_LIMITS, { risky: 12, content: 120 });
  const a = await access(["maintenance_request_status"]);
  assert.deepEqual(await SL.getLimits(a.id), { risky: 12, content: 120 });
  assert.deepEqual(await SL.setLimits(a.id, { risky: 5000, content: 1 }), { risky: 60, content: 10 }, "bounded");
  assert.deepEqual(await SL.setLimits(a.id, { risky: 12, content: 120 }), { risky: 12, content: 120 }, "defaults are not stored");
  await SL.takeSlot(a.id, "risky"); await SL.takeSlot(a.id, "content");
  assert.deepEqual([(await SL.remainingSlots(a.id)).risky.used, (await SL.remainingSlots(a.id)).content.used], [1, 1]);
  SL.resetSlots(a.id);
  assert.deepEqual([(await SL.remainingSlots(a.id)).risky.used, (await SL.remainingSlots(a.id)).content.used], [0, 0]);
});

test("the owner's button: one server action, the right that manages the accesses, journalled; FR and EN texts in parity", () => {
  const src = fs.readFileSync("src/app/admin/(panel)/assistants/requestsActions.ts", "utf8");
  const reset = src.slice(src.indexOf("export async function resetLimitsAction"), src.indexOf("export async function saveLimitsAction"));
  assert.match(reset, /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/);
  assert.match(reset, /resetSlots\(row\.id\)/);
  assert.match(reset, /audit\(user\.email, "mcp\.limits\.reset"/);
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => /^(aim\.limits\.|aim\.setup\.|aim\.tool\.(media|site_settings)|aim\.(req|risk|action)\.site_settings_set|audit\.action\.(media|mcp\.limits))/.test(k));
  assert.ok(keys.length >= 25);
  for (const k of keys) {
    assert.ok(k in fr, `${k} missing in fr`);
    assert.deepEqual([...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${k} variables`);
  }
  const page = fs.readFileSync("src/app/admin/(panel)/assistants/[id]/page.tsx", "utf8");
  assert.match(page, /resetLimitsAction/);
});

test("upload: every brand svg of docs/brand (role, aria-label and title) goes through media_upload; hidden scripts in those features do not", async () => {
  const { token } = await access();
  const dir = path.join(process.cwd(), "docs", "brand");
  const brand = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));
  assert.ok(brand.length >= 5);
  for (const file of brand) {
    const res = await upload(token, fs.readFileSync(path.join(dir, file)));
    assert.ok(res.value, `${file}: ${res.error}`);
    assert.match(res.value.address, /\.svg$/);
    const stored = fs.readFileSync(path.join(UPLOADS_DIR, res.value.id), "utf8");
    assert.ok(stored.includes('role="img"') && stored.includes("<title>Curiosa</title>"), `${file}: accessibility features kept`);
  }
  const before = files().length;
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"';
  for (const evil of [`${head}><title><script>alert(1)</script></title><rect width="1" height="1"/></svg>`, `${head} role="button"><rect width="1" height="1"/></svg>`, `${head} aria-label="${"x".repeat(5000)}"><rect width="1" height="1"/></svg>`]) {
    assert.match((await upload(token, Buffer.from(evil))).error, /svg was refused/);
  }
  assert.equal(files().length, before, "nothing stored for the refused ones");
});
