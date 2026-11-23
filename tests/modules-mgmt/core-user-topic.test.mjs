// Topic `core.user` end to end (database): who may read it, what comes out, what never does. Needs the test database: it runs in CI.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Topics = await import("@/core/services/topics");
const { createInstance } = await import("@/core/instanceService");
const { buildContext } = await import("@/core/modules/context");
const { syncSystemAssignments } = await import("@/core/auth/roles");
const { ACCOUNT_SCHEMA } = await import("@/core/auth/accountTopic");
const { setSetting } = await import("@/core/settings");

beforeEach(() => db.reset());
after(() => db.close());

const base = (over) => ({ apiVersion: 2, version: "1.0.0", main: "index.mjs", ...over });
const CONSUMES = [{ topic: "core.user", label: "Accounts" }];
const mkModule = (id, { code, ...manifest } = {}) => makeRepo({ "module.json": base({ id, name: id, ...manifest }), "index.mjs": code ?? "export default {};" }).url;
const KINDS = {
  reader: { consumes: CONSUMES, permissions: ["topics"] },   // declares the topic and the permission
  nopermission: { consumes: CONSUMES },                     // declares the topic only
  silent: { permissions: ["topics"] },                      // declares the permission only
};

async function instanceOf(id) {
  await installModule(mkModule(id, KINDS[id]), { firstInstance: false });
  const mod = await R.getModule(id);
  const inst = await createInstance(db.prisma, { manifest: mod.manifest, names: { en: id } });
  return (await R.getActiveInstances()).find((a) => a.instance.key === inst.key);
}

async function people() {
  const owner = await db.prisma.user.create({ data: { email: "owner@example.org", name: "Etoile Nord", role: "owner", passwordHash: "$2a$12$HASH-MUST-NOT-LEAK", totpSecret: "TOTP-MUST-NOT-LEAK", sessionVersion: 4, locale: "fr", createdAt: new Date("2026-01-01T00:00:00Z") } });
  const helper = await db.prisma.user.create({ data: { email: "lune@example.org", name: "Lune Douce", role: "editor", passwordHash: "x", createdAt: new Date("2026-02-01T00:00:00Z") } });
  await db.prisma.recoveryCode.create({ data: { userId: owner.id, codeHash: "RECOVERY-MUST-NOT-LEAK" } });

  await db.prisma.trustedIp.create({ data: { userId: owner.id, hash: "TRUSTED-HASH-MUST-NOT-LEAK", lastSeen: new Date() } });
  await syncSystemAssignments();
  const custom = await db.prisma.role.create({ data: { key: "r-moderation", name: "Moderation", rights: "[]" } });
  await db.prisma.userRole.create({ data: { userId: helper.id, roleId: custom.id } });
  return { owner, helper };
}

test("core.user: a module that declares it and the topics permission gets the accounts, with exactly the fields of the schema", async () => {
  const reader = await instanceOf("reader");
  const { owner, helper } = await people();
  const items = await Topics.collect(reader, "core.user", { locale: "en" });
  assert.deepEqual(items.map((i) => i.email), ["owner@example.org", "lune@example.org"], "oldest first");
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), [...ACCOUNT_SCHEMA.map((f) => f.key), "source"].sort());
  assert.equal(items[0].id, owner.id);
  assert.equal(items[0].level, "owner");
  assert.deepEqual(items[0].roles, ["Owner"]);
  assert.equal(items[1].id, helper.id);
  assert.equal(items[1].level, "editor");
  assert.deepEqual(items[1].roles, ["Editorial", "Moderation"]);
  assert.deepEqual(items[0].source, { instance: "core", module: "core", name: "core" });
});

test("core.user: nothing secret comes out, whatever the account holds", async () => {
  const reader = await instanceOf("reader");
  await people();
  const text = JSON.stringify(await Topics.collect(reader, "core.user", { locale: "en" }));
  for (const leak of ["HASH-MUST-NOT-LEAK", "TOTP-MUST-NOT-LEAK", "RECOVERY-MUST-NOT-LEAK", "TRUSTED-HASH-MUST-NOT-LEAK", "passwordHash", "sessionVersion", "totp", "passkey", "personalAi"]) assert.ok(!text.includes(leak), `leaked: ${leak}`);
});

test("core.user: the role names are in the main language of the site, whoever asks", async () => {
  const reader = await instanceOf("reader");
  await people();
  assert.deepEqual((await Topics.collect(reader, "core.user", { locale: "fr" }))[0].roles, ["Owner"]);
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr", "en"]);
  assert.deepEqual((await Topics.collect(reader, "core.user", { locale: "en" }))[0].roles, ["Propriétaire"], "the language of the call does not change the answer");
  assert.deepEqual((await Topics.collect(reader, "core.user", { locale: "fr" }))[0].roles, ["Propriétaire"]);
});

test("core.user: the module reads it through ctx.api.topics.collect like any topic, and `limit` bounds the list", async () => {
  const reader = await instanceOf("reader");
  await people();
  const ctx = await buildContext(reader.mod, reader.instance, "en");
  assert.equal((await ctx.api.topics.collect("core.user")).length, 2);
  assert.equal((await ctx.api.topics.collect("core.user", { limit: 1 })).length, 1);
  assert.deepEqual((await ctx.api.topics.collectPage("core.user", {})).next, null);
});

test("core.user: no account, no item (an empty site answers an empty list)", async () => {
  const reader = await instanceOf("reader");
  assert.deepEqual(await Topics.collect(reader, "core.user", { locale: "en" }), []);
});

test("core.user: a module that does not declare consuming it, or does not declare the topics permission, is refused", async () => {
  const silent = await instanceOf("silent");
  const nopermission = await instanceOf("nopermission");
  await people();
  await assert.rejects(() => Topics.collect(silent, "core.user", { locale: "en" }), /does not declare consuming/);
  await assert.rejects(() => Topics.collect(nopermission, "core.user", { locale: "en" }), /topics/);
});

test("core.user: no module can provide it, and it has no sources to choose", async () => {
  await installModule(mkModule("liar", { provides: [{ topic: "core.user" }], code: `export default { exports: { "core.user": () => [{ id: "evil", name: "Evil", email: "evil@example.org" }] } };` }), { firstInstance: false });
  const mod = await R.getModule("liar");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { en: "liar" } });
  const reader = await instanceOf("reader");
  await people();
  assert.deepEqual(await Topics.providersOf("core.user"), []);
  assert.ok(Topics.isOwnTopic("core.user"));
  assert.ok(!Topics.isOwnTopic("core.entry"));
  assert.ok(!(await Topics.collect(reader, "core.user", { locale: "en" })).some((i) => i.id === "evil"));
  assert.deepEqual(await Topics.collectForCore("core.user", ACCOUNT_SCHEMA, { locale: "en" }), [], "the core itself never collects it from modules");
});
