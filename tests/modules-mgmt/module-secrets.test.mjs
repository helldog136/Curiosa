import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// SECRETS OF A MODULE (core 0.48.0): `ctx.api.secrets` seals a value with the site secret, per instance. Isolation, nothing readable in the database, the backup, the audit log or any
// output, a backup restored elsewhere asks again, removal wipes, bounds and rate limits.
const db = await useTestDb();
const { installModule, uninstallModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { buildContext } = await import("@/core/modules/context");
const { createInstance, deleteInstance } = await import("@/core/instanceService");
const S = await import("@/core/services/secrets");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { readTarGz } = await import("@/core/backup/tar");
const { eraseRetired } = await import("@/core/modules/retired");
const { legacyReport } = await import("@/core/modules/legacyReport");
const { readSettings } = await import("@/core/maintenance/moduleSettings");
const { setSetting } = await import("@/core/settings");

beforeEach(async () => { await db.reset(); S.resetSecretLimits(); S.secretClock.now = () => Date.now(); });
after(() => db.close());

const TOKEN = "etoile-nord-secret-9f3a7c1d2b4e6a8c";   // an invented value
const TOKEN2 = "lune-douce-secret-5d1e8b0a7c3f9264";
const manifest = (id, extra = {}) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", permissions: ["secrets"], ...extra });
const mod = (id = "bot", extra) => makeRepo({ "module.json": manifest(id, extra), "index.mjs": "export default {};" });
const install = async (repo) => assert.equal((await installModule(repo.url, { firstInstance: false, dependencies: false })).ok, true);
const instance = async (id, key) => createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: key, names: { fr: key } });
const ctxOf = async (id, key) => { const a = (await R.getActiveInstances()).find((x) => x.mod.manifest.id === id && x.instance.key === key); return buildContext(a.mod, a.instance); };
async function twoInstances(id = "bot") { await install(mod(id)); await db.prisma.moduleInstance.deleteMany({ where: { moduleId: id } }); const a = await instance(id, "a-bot"); const b = await instance(id, "b-bot"); return { a, b, ca: await ctxOf(id, "a-bot"), cb: await ctxOf(id, "b-bot") }; }
const allText = async () => JSON.stringify({
  settings: await db.prisma.setting.findMany(), audit: await db.prisma.auditLog.findMany(), records: await db.prisma.moduleRecord.findMany(),
  instances: await db.prisma.moduleInstance.findMany(), retired: await db.prisma.retiredInstance.findMany(), modules: await db.prisma.module.findMany(),
});

test("set, get, has, state, names, remove: the value comes back only to the instance, and the database holds sealed text", async () => {
  const { a, ca } = await twoInstances();
  assert.deepEqual(await ca.api.secrets.set("botToken", TOKEN), { ok: true });
  assert.equal(await ca.api.secrets.get("botToken"), TOKEN);
  assert.deepEqual([await ca.api.secrets.has("botToken"), await ca.api.secrets.state("botToken"), await ca.api.secrets.names()], [true, "set", ["botToken"]]);
  assert.deepEqual([await ca.api.secrets.get("nope"), await ca.api.secrets.has("nope"), await ca.api.secrets.state("nope")], [null, false, "absent"]);
  const row = await db.prisma.setting.findUnique({ where: { key_locale: { key: `instance.${a.id}.__secret.botToken`, locale: "" } } });
  assert.match(JSON.parse(row.value), /^[\w-]{16}\.[\w-]{22}\.[\w-]+$/, "iv.tag.body, base64url");
  assert.ok(!(await allText()).includes(TOKEN), "not in any table");
  assert.deepEqual(await ca.api.secrets.set("botToken", TOKEN2), { ok: true });
  assert.equal(await ca.api.secrets.get("botToken"), TOKEN2, "replaced");
  assert.equal(await ca.api.secrets.remove("botToken"), true);
  assert.equal(await ca.api.secrets.remove("botToken"), false);
  assert.deepEqual([await ca.api.secrets.get("botToken"), await ca.api.secrets.names()], [null, []]);
});

test("without the permission nothing is stored or read, and nothing throws", async () => {
  await install(makeRepo({ "module.json": manifest("plain", { permissions: [] }), "index.mjs": "export default {};" }));
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "plain" } }); const p = await instance("plain", "plain-x");
  const c = await ctxOf("plain", "plain-x");
  assert.deepEqual(await c.api.secrets.set("botToken", TOKEN), { ok: false, reason: "no-permission" });
  assert.deepEqual([await c.api.secrets.get("botToken"), await c.api.secrets.has("botToken"), await c.api.secrets.state("botToken"), await c.api.secrets.remove("botToken"), await c.api.secrets.names()], [null, false, "absent", false, []]);
  assert.equal(await db.prisma.setting.count({ where: { key: { startsWith: `instance.${p.id}.__secret.` } } }), 0);
  // A value planted by hand (another version of the module that had the permission) is not readable without it either.
  await db.prisma.setting.create({ data: { key: `instance.${p.id}.__secret.botToken`, locale: "", value: JSON.stringify("a.b.c") } });
  assert.deepEqual([await c.api.secrets.get("botToken"), await c.api.secrets.state("botToken")], [null, "absent"]);
});

test("isolation: two instances of a module, and two modules, never see each other's names or values", async () => {
  const { a, b, ca, cb } = await twoInstances();
  await install(mod("other")); await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "other" } }); await instance("other", "o-bot");
  const co = await ctxOf("other", "o-bot");
  await ca.api.secrets.set("botToken", TOKEN);
  for (const c of [cb, co]) assert.deepEqual([await c.api.secrets.get("botToken"), await c.api.secrets.state("botToken"), await c.api.secrets.names()], [null, "absent", []]);
  await cb.api.secrets.set("botToken", TOKEN2);
  assert.deepEqual([await ca.api.secrets.get("botToken"), await cb.api.secrets.get("botToken")], [TOKEN, TOKEN2], "same name, own value");
  // The instance never comes from the module: extra arguments are ignored, and a name that looks like a key of another instance is refused.
  assert.equal(await cb.api.secrets.get("botToken", { instance: a.id, instanceId: a.id, key: "a-bot" }), TOKEN2);
  for (const bad of [`..${a.id}`, `${a.id}.botToken`, "a.b", "../x", "__proto__", "", " ", "x".repeat(49), "1abc", "a b", null, undefined, 5, {}, ["botToken"], { toString: () => "botToken" }]) {
    assert.equal(await cb.api.secrets.get(bad), null, String(bad));
    assert.deepEqual(await cb.api.secrets.set(bad, "v"), { ok: false, reason: "invalid-name" }, String(bad));
  }
  // The ciphertext is bound to the instance and the name: a row copied under another instance or name does not open (it reads as "unreadable", never as a value).
  const rowA = await db.prisma.setting.findUnique({ where: { key_locale: { key: `instance.${a.id}.__secret.botToken`, locale: "" } } });
  await db.prisma.setting.create({ data: { key: `instance.${b.id}.__secret.copied`, locale: "", value: rowA.value } });
  await db.prisma.setting.create({ data: { key: `instance.${a.id}.__secret.renamed`, locale: "", value: rowA.value } });
  assert.deepEqual([await cb.api.secrets.get("copied"), await cb.api.secrets.state("copied"), await ca.api.secrets.get("renamed"), await ca.api.secrets.state("renamed")], [null, "unreadable", null, "unreadable"]);
});

test("bounds: bad values, 4096 characters, 20 names (replacing one is still allowed)", async () => {
  const { ca } = await twoInstances();
  let now = 5_000_000; S.secretClock.now = () => (now += 5_000);   // each call is 5 s later: the rate limit is not what this test is about
  assert.deepEqual(await ca.api.secrets.set("constructor", "v"), { ok: true }, "a name like an object property is only a name");
  assert.equal(await ca.api.secrets.get("constructor"), "v");
  assert.equal(Object.prototype.constructor, Object, "nothing leaked onto Object");
  await ca.api.secrets.remove("constructor");
  for (const bad of ["", null, undefined, 5, {}, ["x"], "x".repeat(S.SECRET_MAX_CHARS + 1)]) assert.deepEqual(await ca.api.secrets.set("t", bad), { ok: false, reason: "invalid-value" }, String(bad));
  assert.deepEqual(await ca.api.secrets.set("big", "é".repeat(S.SECRET_MAX_CHARS)), { ok: true });
  assert.equal((await ca.api.secrets.get("big")).length, S.SECRET_MAX_CHARS);
  await ca.api.secrets.remove("big");
  for (let i = 0; i < S.SECRET_MAX_NAMES; i++) assert.deepEqual(await ca.api.secrets.set(`n${i}`, "v"), { ok: true }, `n${i}`);
  assert.deepEqual(await ca.api.secrets.set("one-more", "v"), { ok: false, reason: "too-many" });
  assert.deepEqual(await ca.api.secrets.set("n3", "new"), { ok: true }, "replacing is not adding");
  assert.equal((await ca.api.secrets.names()).length, S.SECRET_MAX_NAMES);
});

test("rate limits per instance: 20 writes and 600 reads a minute, back after the minute, not shared between instances", async () => {
  const { ca, cb } = await twoInstances();
  let now = 1_000_000; S.secretClock.now = () => now;
  for (let i = 0; i < S.SECRET_WRITES_PER_MIN; i++) assert.deepEqual(await ca.api.secrets.set("t", `v${i}`), { ok: true });
  assert.deepEqual(await ca.api.secrets.set("t", "again"), { ok: false, reason: "rate-limited" });
  assert.equal(await ca.api.secrets.remove("t"), false, "removals count as writes");
  assert.deepEqual(await cb.api.secrets.set("t", "other instance"), { ok: true }, "per instance");
  now += 61_000;
  assert.deepEqual(await ca.api.secrets.set("t", "later"), { ok: true });
  for (let i = 0; i < S.SECRET_READS_PER_MIN; i++) await ca.api.secrets.get("t");
  assert.equal(await ca.api.secrets.get("t"), null, "the 601st read in the minute answers nothing");
  now += 61_000;
  assert.equal(await ca.api.secrets.get("t"), "later");
});

test("no output of the core shows it: audit (name only), journal, readable backup summary, module settings tool, legacy report, logs", async () => {
  const { a, ca } = await twoInstances();
  const logs = [];
  const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(real)) console[k] = (...args) => { logs.push(args.map(String).join(" ")); };
  try {
    await ca.api.secrets.set("botToken", TOKEN);
    await ca.api.secrets.get("botToken"); await ca.api.secrets.set("botToken", TOKEN2); await ca.api.secrets.remove("botToken"); await ca.api.secrets.set("botToken", TOKEN);
    await ca.api.log.write({ action: "x", data: { note: "plain" } });
    const settingsTool = await readSettings({ instance: "a-bot" });
    const report = await legacyReport();
    const audit = await db.prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    const mine = audit.filter((r) => r.action.startsWith("module.secret"));
    assert.deepEqual(mine.map((r) => [r.action, r.target, r.actorKind, r.module, r.instance]), [["module.secret.set", "a-bot: botToken", "module", "bot", "a-bot"], ["module.secret.set", "a-bot: botToken", "module", "bot", "a-bot"], ["module.secret.remove", "a-bot: botToken", "module", "bot", "a-bot"], ["module.secret.set", "a-bot: botToken", "module", "bot", "a-bot"]]);
    // A person's account must exist for a backup.
    await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash-du-proprietaire", locale: "fr", advanced: true } });
    await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
    const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
    const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
    const archive = Object.values(files).map((c) => Buffer.from(c).toString("latin1")).join("\n");
    for (const [name, text] of Object.entries({ database: await allText(), audit: JSON.stringify(audit), tool: JSON.stringify(settingsTool), report: JSON.stringify(report), archive, encrypted: b.buffer.toString("latin1"), logs: logs.join("\n") })) {
      assert.ok(!text.includes(TOKEN) && !text.includes(TOKEN2), `${name} must not hold the value`);
    }
    const settings = JSON.parse(Buffer.from(files[Object.keys(files).find((k) => /data\/settings\.json$/.test(k))]).toString());
    const row = settings.find((s) => s.key === `instance.${a.id}.__secret.botToken`);
    assert.ok(row && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(row.value), "the backup carries the sealed text");
    assert.ok(!Buffer.from(files["readable/site.txt"]).toString().includes("__secret"), "not in the readable summary");
  } finally { Object.assign(console, real); }
});

test("backup and restore: restored on the same server it opens; restored on another server (another site secret) it cannot, so the module asks again", async () => {
  const { a, ca } = await twoInstances();
  await ca.api.secrets.set("botToken", TOKEN);
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash-du-proprietaire", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
  const made = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  await db.prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${a.id}.__secret.` } } });   // the row is gone, as on a new server
  assert.equal(await ca.api.secrets.state("botToken"), "absent");
  const opened = Rs.openBackup(made.buffer, "un-mot-de-passe-solide", 1000);
  assert.equal(opened.ok, true);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org", installers: { fromCatalogue: async () => ({ ok: false }), fromRepo: async () => ({ ok: false }) } });
  assert.equal(report.ok, true, JSON.stringify(report).slice(0, 400));
  const after = await ctxOf("bot", "a-bot");
  assert.deepEqual([await after.api.secrets.state("botToken"), await after.api.secrets.get("botToken")], ["set", TOKEN], "same server: readable");
  const prev = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "another-server-secret-another-server-secret";
  try {
    S.resetSecretLimits();
    assert.deepEqual([await after.api.secrets.state("botToken"), await after.api.secrets.get("botToken"), await after.api.secrets.has("botToken")], ["unreadable", null, false]);
    assert.deepEqual(await after.api.secrets.names(), ["botToken"], "the name is still listed so the module can ask again");
    assert.deepEqual(await after.api.secrets.set("botToken", TOKEN2), { ok: true }, "asking again replaces it");
    assert.equal(await after.api.secrets.get("botToken"), TOKEN2);
  } finally { if (prev === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = prev; }
});

test("removal wipes: deleting the instance, uninstalling the module, and erasing kept data leave no sealed row", async () => {
  const { a, b, ca, cb } = await twoInstances();
  await ca.api.secrets.set("botToken", TOKEN); await cb.api.secrets.set("botToken", TOKEN2);
  const left = (id) => db.prisma.setting.count({ where: { key: { startsWith: `instance.${id}.__secret.` } } });
  assert.deepEqual([await left(a.id), await left(b.id)], [1, 1]);
  await deleteInstance(a.id);
  assert.deepEqual([await left(a.id), await left(b.id)], [0, 1], "only that instance");
  // Uninstalling and erasing the data too.
  assert.equal((await uninstallModule("bot", { keepData: false })).ok, true);
  assert.equal(await left(b.id), 0);
  // Kept data: the sealed values stay with the kept instance (like all its settings) until the owner erases it, which removes them.
  await install(mod("keeper")); await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "keeper" } }); const k = await instance("keeper", "k-bot");
  await (await ctxOf("keeper", "k-bot")).api.secrets.set("botToken", TOKEN);
  assert.equal((await uninstallModule("keeper", { keepData: true })).ok, true);
  assert.equal(await left(k.id), 0, "not in the live settings any more");
  assert.equal(await db.prisma.retiredInstance.count(), 1);
  assert.ok(!(await allText()).includes(TOKEN));
  await eraseRetired({ moduleId: "keeper" });
  assert.equal(await db.prisma.retiredInstance.count(), 0);
});

test("guard: only api.ts uses the secrets service, and nothing else in the core touches the sealed rows", () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(p)) out.push(p.replaceAll("\\", "/")); } return out; };
  const all = walk("src");
  assert.deepEqual(all.filter((f) => /services\/secrets"/.test(fs.readFileSync(f, "utf8"))).sort(), ["src/core/modules/api.ts"]);
  assert.deepEqual(all.filter((f) => fs.readFileSync(f, "utf8").includes("__secret")).sort(), ["src/core/services/secrets.ts"], "no reader or exporter of the sealed rows");
  // No assistant (MCP), maintenance or backup file reads module secrets through the API either.
  for (const f of all.filter((x) => /services\/mcp|core\/maintenance|core\/backup/.test(x))) assert.ok(!/api\.secrets|createSecrets/.test(fs.readFileSync(f, "utf8")), f);
  // The seal is the shared primitive with its own purpose: a value sealed for another purpose does not open as a module secret.
  const src = fs.readFileSync("src/core/services/secrets.ts", "utf8");
  assert.match(src, /const PURPOSE = "module-secret-seal"/);
});
