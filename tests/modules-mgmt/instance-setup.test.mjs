import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Setting up an installed module from another module (core 0.15.0): `ctx.api.instances.pending` / `setUp`, permission "instances.setup". Declared, limited to an installed module that
// offers a service the caller requires and has no instance, only from an admin action clicked by an administrator, logged, never installs code.
const db = await useTestDb();
const { prisma } = db;
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { getInstanceById } = await import("@/core/instances");
const { buildContext, forViewer } = await import("@/core/modules/context");

after(() => db.close());

const SVC = "demo.screen";
const person = (id = "u1", level = "admin") => ({ id, email: `${id}@example.org`, name: id, level, roles: [level], rights: new Set(), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false });
const install = async (files) => assert.equal((await installModule(makeRepo(files).url, { dependencies: false })).ok, true);
const provider = (extra = {}) => install({ "module.json": { apiVersion: 2, id: "screen", name: { en: "Screen", fr: "Écran" }, version: "1.0.0", main: "index.mjs", offers: [{ service: SVC }], ...extra }, "index.mjs": "export default {};" });
const consumerModule = (over = {}) => install({ "module.json": { apiVersion: 2, id: "cons", name: "Cons", version: "1.0.0", main: "index.mjs", permissions: ["instances.setup"], requires: [{ service: SVC, optional: true }], ...over }, "index.mjs": "export default {};" });
let consumer;
async function setup({ consumerOver, providerExtra, withInstance = false, noProvider = false } = {}) {
  if (!noProvider) await provider(providerExtra);
  await consumerModule(consumerOver);
  await prisma.moduleInstance.deleteMany({});
  await createInstance(prisma, { manifest: (await R.getModule("cons")).manifest, nickname: "Consumer", names: { fr: "Consumer" } });
  if (withInstance) await createInstance(prisma, { manifest: (await R.getModule("screen")).manifest, nickname: "Screen", names: { fr: "Écran" } });
  const inst = await prisma.moduleInstance.findFirst({ where: { moduleId: "cons" } });
  consumer = { mod: await R.getModule("cons"), instance: await getInstanceById(inst.id) };
}
const ctxFor = async () => buildContext(consumer.mod, consumer.instance, "fr");
const adminCtx = async (p = person()) => forViewer(await ctxFor(), p, { carryRights: true });
const count = () => prisma.moduleInstance.count({ where: { moduleId: "screen" } });

beforeEach(() => db.reset());

test("pending lists an installed module without instance that offers a required service, in the person's language; setUp creates the default instance and logs it", async () => {
  await setup();
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), [{ module: "screen", name: "Écran", services: [SVC] }]);
  const res = await (await adminCtx()).api.instances.setUp("screen");
  assert.deepEqual(res, { ok: true, state: "created" });
  assert.equal(await count(), 1);
  const line = await prisma.auditLog.findFirst({ where: { action: "instance.setup" } });
  assert.equal(line.actor, "u1@example.org"); assert.equal(line.target, "screen created"); assert.equal(line.module, "cons"); assert.equal(line.instance, consumer.instance.key);
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), [], "nothing left to set up");
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("screen"), { ok: true, state: "present" }, "a second click creates nothing");
  assert.equal(await count(), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "instance.setup" } }), 2);
});

test("refused without the permission: pending is empty, setUp does nothing", async () => {
  await setup({ consumerOver: { permissions: [] } });
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), []);
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("screen"), { ok: false, reason: "no-permission" });
  assert.equal(await count(), 0);
});

test("refused outside an admin action (panel, route, task, MCP), and for a person who is not an administrator", async () => {
  await setup();
  assert.deepEqual(await (await ctxFor()).api.instances.setUp("screen"), { ok: false, reason: "no-person" });
  assert.deepEqual(await forViewer(await ctxFor(), person()).api.instances.setUp("screen"), { ok: false, reason: "no-person" }, "a panel carries nothing");
  for (const level of ["editor", "member"]) assert.deepEqual(await (await adminCtx(person("u2", level))).api.instances.setUp("screen"), { ok: false, reason: "denied" }, level);
  assert.equal(await count(), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: "instance.setup" } }), 0);
});

test("refused for a module that offers no service the caller declares, for itself, for an unknown module and for a malformed id", async () => {
  await setup({ consumerOver: { requires: [{ service: "other.thing", optional: true }] } });
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), []);
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("screen"), { ok: false, reason: "undeclared" });
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("cons"), { ok: false, reason: "undeclared" });
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("missing"), { ok: false, reason: "not-installed" });
  for (const bad of ["../x", "", 5, null, { a: 1 }]) assert.deepEqual(await (await adminCtx()).api.instances.setUp(bad), { ok: false, reason: "undeclared" });
  assert.equal(await count(), 0);
});

test("the version asked is honoured: an offer older than `min` is not set up", async () => {
  await setup({ consumerOver: { requires: [{ service: SVC, min: 2, optional: true }] } });
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), []);
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("screen"), { ok: false, reason: "undeclared" });
});

test("a module that is not installed is never installed by this path", async () => {
  await setup({ noProvider: true });
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), []);
  assert.deepEqual(await (await adminCtx()).api.instances.setUp("screen"), { ok: false, reason: "not-installed" });
  assert.equal(await prisma.module.count({ where: { id: "screen" } }), 0);
});

test("a module that already has an instance is not listed and gets no second one", async () => {
  await setup({ withInstance: true });
  assert.deepEqual(await (await ctxFor()).api.instances.pending(), []);
  assert.equal((await (await adminCtx()).api.instances.setUp("screen")).state, "present");
  assert.equal(await count(), 1);
});

test("code guard: only api.ts reaches setUp.ts, and the module never installs", () => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /modules\/setUp"|from "\.\/setUp"/.test(fs.readFileSync(p, "utf8"))) hits.push(p); } };
  walk("src");
  assert.deepEqual(hits, ["src/core/modules/api.ts"]);
  assert.ok(!/installer|installFromCatalogue|updateModule/.test(fs.readFileSync("src/core/modules/setUp.ts", "utf8").replace(/\/\*[\s\S]*?\*\//, "")));
});
