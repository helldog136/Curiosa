// Topic `core.user`: the closed list of fields. Pure tests (no database): the whitelist, the guard that fails when a column is added to the account table,
// and the shape of the items. The end-to-end reading (database, permission, no provider) is tests/modules-mgmt/core-user-topic.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { ACCOUNT_SCHEMA, ACCOUNT_SELECT, accountItem, CORE_USER } = await import("@/core/auth/accountTopic");

/** The columns of the account table that the topic reads (the keys of `ACCOUNT_SELECT`, minus the role join). */
const EXPOSED_COLUMNS = ["id", "name", "email", "role", "coordinator", "createdAt", "updatedAt"];
/**
 * EVERY other column of the account table, with the reason it stays hidden. A new column makes the test below fail until someone decides: add it here
 * (hidden) or to `ACCOUNT_SELECT` and `ACCOUNT_SCHEMA` (exposed, which needs a review of what it holds).
 */
const HIDDEN_COLUMNS = {
  passwordHash: "secret",
  locale: "interface preference",
  advanced: "interface preference",
  sessionVersion: "session counter",
  mustChangePassword: "sign-in state",
  totpSecret: "secret",
  totpPending: "secret",
  totpEnabledAt: "sign-in state",
  totpLastStep: "secret",
  personalAi: "assistant access",
};
/** The relations of the account table. Only `roles` is read, through the restricted select of `ACCOUNT_SELECT.roles`. */
const RELATIONS = { entries: "content", trustedIps: "network addresses", recoveryCodes: "secret", passkeys: "secret", roles: "read with a restricted select" };

function userModel() {
  const schema = fs.readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const body = /^model User \{([\s\S]*?)^\}/m.exec(schema)?.[1];
  assert.ok(body, "model User not found in prisma/schema.prisma");
  const fields = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const m = /^([A-Za-z]\w*)\s+([A-Za-z]\w*)(\[\])?(\?)?/.exec(line);
    if (m && !line.startsWith("@@")) fields.push({ name: m[1], type: m[2], list: !!m[3] });
  }
  return fields;
}

test("core.user: every column of the account table is either read here or explicitly hidden (a new column fails this test until it is decided)", () => {
  const SCALARS = new Set(["String", "Boolean", "Int", "DateTime", "Float", "BigInt", "Json", "Bytes", "Decimal"]);
  const columns = userModel().filter((f) => SCALARS.has(f.type) && !f.list).map((f) => f.name);
  const relations = userModel().filter((f) => !SCALARS.has(f.type) || f.list).map((f) => f.name);
  const unknown = columns.filter((c) => !EXPOSED_COLUMNS.includes(c) && !(c in HIDDEN_COLUMNS));
  assert.deepEqual(unknown, [], `new column(s) of User not classified for the core.user topic: ${unknown.join(", ")}. Hide it (HIDDEN_COLUMNS) or expose it on purpose (ACCOUNT_SELECT + ACCOUNT_SCHEMA + docs/MODULES.md).`);
  const unknownRelations = relations.filter((r) => !(r in RELATIONS));
  assert.deepEqual(unknownRelations, [], `new relation(s) of User not classified: ${unknownRelations.join(", ")}`);
  for (const c of [...EXPOSED_COLUMNS, ...Object.keys(HIDDEN_COLUMNS)]) assert.ok(columns.includes(c), `${c} is listed here but no longer exists in User: update the lists`);
});

test("core.user: the database is asked for the exposed columns only, and the role join for key, name and system flag only", () => {
  const { roles, ...scalars } = ACCOUNT_SELECT;
  assert.deepEqual(Object.keys(scalars).sort(), [...EXPOSED_COLUMNS].sort());
  assert.ok(Object.values(scalars).every((v) => v === true));
  assert.deepEqual(roles, { select: { role: { select: { key: true, name: true, system: true } } } }, "the join reads no role right, no description, no user");
  for (const secret of Object.keys(HIDDEN_COLUMNS)) assert.ok(!(secret in ACCOUNT_SELECT), `${secret} must never be selected`);
});

test("core.user: the schema is the exact list of fields, in a fixed order, with only plain types", () => {
  assert.equal(CORE_USER, "core.user");
  assert.deepEqual(ACCOUNT_SCHEMA.map((f) => f.key), ["id", "name", "email", "level", "roles", "createdAt", "updatedAt"]);
  assert.deepEqual(ACCOUNT_SCHEMA.filter((f) => f.required).map((f) => f.key), ["id", "name", "email"]);
  assert.ok(ACCOUNT_SCHEMA.every((f) => ["string", "string[]", "datetime"].includes(f.type)));
});

const SECRETS = {
  passwordHash: "$2a$12$SECRET-HASH-MUST-NOT-LEAK", totpSecret: "TOTP-SECRET-MUST-NOT-LEAK", totpPending: "PENDING-MUST-NOT-LEAK", totpLastStep: 123456,
  recoveryCodes: [{ codeHash: "RECOVERY-MUST-NOT-LEAK" }], passkeys: [{ credentialId: "PASSKEY-MUST-NOT-LEAK" }], trustedIps: [{ ip: "203.0.113.9" }],
  sessionVersion: 7, locale: "fr", advanced: true, mustChangePassword: true, personalAi: "allow",
};
const row = (over = {}) => ({
  id: "cuid_account_1", name: "Camille", email: "camille@example.org", role: "admin", coordinator: false,
  createdAt: new Date("2026-01-02T03:04:05.000Z"), updatedAt: new Date("2026-02-03T04:05:06.000Z"),
  roles: [{ role: { key: "admin", name: "Administration", system: true } }], ...SECRETS, ...over,
});
const label = (key) => ({ owner: "Owner", coordinator: "Technical coordination", admin: "Administration", editor: "Editorial" })[key] ?? key;

test("core.user: an item has exactly the schema keys, even when the row carries every secret column (nothing is spread)", () => {
  const item = accountItem(row(), label);
  assert.deepEqual(Object.keys(item), ACCOUNT_SCHEMA.map((f) => f.key));
  assert.deepEqual(item, { id: "cuid_account_1", name: "Camille", email: "camille@example.org", level: "admin", roles: ["Administration"], createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-02-03T04:05:06.000Z" });
  const text = JSON.stringify(item);
  for (const leak of ["SECRET-HASH", "TOTP-SECRET", "PENDING", "RECOVERY", "PASSKEY", "203.0.113.9", "passwordHash", "totp", "sessionVersion", "personalAi"]) assert.ok(!text.includes(leak), `leaked: ${leak}`);
});

test("core.user: the level comes from the account (coordinator = admin + flag), roles are listed predefined first, custom roles by name", () => {
  assert.equal(accountItem(row({ role: "owner" }), label).level, "owner");
  assert.equal(accountItem(row({ role: "admin", coordinator: true }), label).level, "coordinator");
  assert.equal(accountItem(row({ role: "editor" }), label).level, "editor");
  assert.equal(accountItem(row({ role: "none", roles: [] }), label).level, "none");
  assert.equal(accountItem(row({ role: "banana" }), label).level, "none", "an unknown level is « none », never passed through");
  const mixed = accountItem(row({ role: "editor", roles: [
    { role: { key: "r-zeta", name: "Zeta team", system: false } },
    { role: { key: "editor", name: "Editorial", system: true } },
    { role: { key: "r-alpha", name: "Alpha team", system: false } },
    { role: { key: "owner", name: "Owner", system: true } },
  ] }), label);
  assert.deepEqual(mixed.roles, ["Owner", "Editorial", "Alpha team", "Zeta team"]);
  assert.deepEqual(accountItem(row({ roles: [{ role: { key: "r-x", name: "admin", system: false } }] }), label).roles, ["admin"], "a custom role named like a predefined one stays custom");
});

test("core.user: the source scan — the topic file never names a secret column", () => {
  const source = fs.readFileSync(new URL("../../src/core/auth/accountTopic.ts", import.meta.url), "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  for (const word of Object.keys(HIDDEN_COLUMNS).filter((k) => !["locale", "advanced"].includes(k)).concat(["recoveryCode", "passkey", "trustedIp", "authLock"])) assert.ok(!new RegExp(word, "i").test(source), `accountTopic.ts mentions « ${word} »`);
});
