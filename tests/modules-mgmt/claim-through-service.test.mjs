import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Keeping an uploaded file through a SERVICE (core 0.14.0): `ctx.api.files.claim` of the provider's method gets the person who uploaded the file, but ONLY on the path that already
// carries the caller's rights: an admin action, `{ asCaller: true }`, the method listed in the provider's `callerRights`. Everything else answers `no-person`, as before.
const db = await useTestDb();
const { prisma } = db;
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { getInstanceById } = await import("@/core/instances");
const { buildContext, forViewer } = await import("@/core/modules/context");
const { recordUpload } = await import("@/core/services/files");
const { UPLOADS_DIR } = await import("@/core/config");

after(() => db.close());

const SVC = "demo.pictures";
const PROVIDER_CODE = `
const seen = () => (globalThis.__pics ??= []);
const claim = (name) => async (ctx, a) => { const r = await ctx.api.files.claim(a.url); seen().push({ name, r }); return r; };
export default { services: { "${SVC}": { keep: claim("keep"), peek: claim("peek") } } };`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const person = (id = "u1", level = "admin") => ({ id, email: `${id}@example.org`, name: id, level, roles: [level], rights: new Set(), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false });
const install = async (files) => assert.equal((await installModule(makeRepo(files).url, { dependencies: false })).ok, true);
const upload = async (by = "u1") => {
  const name = `${crypto.randomUUID()}.png`;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, name), PNG);
  await recordUpload(`/uploads/${name}`, by, PNG.length);
  return `/uploads/${name}`;
};

let consumer;
async function setup({ permissions = ["files"], callerRights = ["keep"], consumerRequires = true } = {}) {
  await install({ "module.json": { apiVersion: 2, id: "pics", name: "Pics", version: "1.0.0", main: "index.mjs", permissions, offers: [{ service: SVC, ...(callerRights ? { callerRights } : {}) }] }, "index.mjs": PROVIDER_CODE });
  await install({ "module.json": { apiVersion: 2, id: "cons", name: "Cons", version: "1.0.0", main: "index.mjs", ...(consumerRequires ? { requires: [{ service: SVC }] } : {}) }, "index.mjs": "export default {};" });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["pics", "cons"] } } });
  for (const [id, nick] of [["pics", "Pictures"], ["cons", "Consumer"]]) await createInstance(prisma, { manifest: (await R.getModule(id)).manifest, nickname: nick, names: { fr: nick } });
  const inst = await prisma.moduleInstance.findFirst({ where: { moduleId: "cons" } });
  consumer = { mod: await R.getModule("cons"), instance: await getInstanceById(inst.id) };
}
const ctxFor = async () => buildContext(consumer.mod, consumer.instance, "fr");
const adminCtx = async (p = person()) => forViewer(await ctxFor(), p, { carryRights: true });
const call = (ctx, url, opts, method = "keep") => ctx.api.services.call(SVC, method, { url }, opts);
const seen = () => globalThis.__pics.at(-1);

beforeEach(async () => { await db.reset(); globalThis.__pics = []; fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); });

test("an admin action that calls a listed method with asCaller: the provider keeps the file the same person just uploaded", async () => {
  await setup();
  const url = await upload("u1");
  const res = await call(await adminCtx(), url, { asCaller: true });
  assert.equal(res.ok, true);
  assert.equal(res.value.ok, true, JSON.stringify(res.value));
  assert.equal(res.value.already, false);
  const row = await prisma.uploadFile.findUnique({ where: { name: url.slice(9) } });
  assert.equal(row.ownerModule, "pics", "the file belongs to the PROVIDER's instance");
  assert.ok(row.ownerInstance);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "file.claim", actor: "u1@example.org" } }), "the claim is audited under the person");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: `module.${consumer.instance.key}.asCaller` } }), "so is the call that carried the person");
});

test("an undeclared method, no asCaller, a panel, a route or task context: still `no-person`", async () => {
  await setup();
  const url = await upload("u1");
  const admin = await adminCtx();
  assert.equal((await call(admin, url, { asCaller: true }, "peek")).value.reason, "no-person", "peek is not in callerRights");
  assert.equal((await call(admin, url, {})).value.reason, "no-person", "asCaller not asked");
  assert.equal((await call(admin, url)).value.reason, "no-person");
  assert.equal((await call(admin, url, { asCaller: false })).value.reason, "no-person");
  const panel = forViewer(await ctxFor(), person());   // a panel: ctx.can works there, but its service calls carry nothing
  assert.equal((await call(panel, url, { asCaller: true })).value.reason, "no-person");
  const anonymous = await ctxFor();                      // public route, task, MCP
  assert.equal((await call(anonymous, url, { asCaller: true })).value.reason, "no-person");
  assert.equal(await prisma.uploadFile.count({ where: { ownerInstance: { not: null } } }), 0, "nothing was kept");
  const after = await call(admin, url, { asCaller: true });
  assert.equal(after.value.ok, true, "and the file was still free to keep through the declared path");
});

test("a provider that lists nothing keeps nothing", async () => {
  await setup({ callerRights: null });
  assert.equal((await call(await adminCtx(), await upload("u1"), { asCaller: true })).value.reason, "no-person");
});

test("a provider without the `files` permission keeps nothing", async () => {
  await setup({ permissions: [] });
  assert.equal((await call(await adminCtx(), await upload("u1"), { asCaller: true })).value.reason, "no-permission");
});

test("the uploader is still checked: another person's upload, a file already owned, an outside address, an old upload", async () => {
  await setup();
  const admin = await adminCtx(person("u1"));
  assert.equal((await call(admin, await upload("u2"), { asCaller: true })).value.reason, "not-uploader", "someone else's upload");
  const mine = await upload("u1");
  assert.equal((await call(admin, mine, { asCaller: true })).value.ok, true);
  assert.equal((await call(await adminCtx(person("u1")), mine, { asCaller: true })).value.already, true, "asking again is harmless");
  const taken = await upload("u1");
  const other = (await prisma.moduleInstance.findFirst({ where: { moduleId: "cons" } })).id;
  await prisma.uploadFile.update({ where: { name: taken.slice(9) }, data: { ownerModule: "cons", ownerInstance: other } });
  assert.equal((await call(admin, taken, { asCaller: true })).value.reason, "taken", "a file owned by another module is not taken over");
  for (const url of ["https://evil.example/a.png", "/uploads/../x.png", "../../etc/passwd", "/uploads/not-a-real-name.png"]) assert.match(String((await call(admin, url, { asCaller: true })).value.reason), /^(invalid|unknown)$/, url);
});

test("cross-module spoofing: a module that does not declare the service cannot call it; the person is not carried to a second hop", async () => {
  await setup({ consumerRequires: false });
  const url = await upload("u1");
  const res = await call(await adminCtx(), url, { asCaller: true });
  assert.deepEqual(res, { ok: false, reason: "undeclared" });
  assert.equal(await prisma.uploadFile.count({ where: { ownerInstance: { not: null } } }), 0);
  assert.equal(globalThis.__pics.length, 0, "the provider never ran");
});

test("the person is not left on the contexts that follow, and the provider's context does not keep it", async () => {
  await setup();
  const url = await upload("u1");
  await call(await adminCtx(), url, { asCaller: true });
  const next = await upload("u1");
  assert.equal((await call(await ctxFor(), next, { asCaller: true })).value.reason, "no-person", "a fresh context of the same instance carries nothing");
  assert.equal((await call(await adminCtx(), next, { asCaller: true })).value.ok, true, "a fresh admin action does");
});

test("code guards: only dependencies.ts asks for carryUploads, only on the asCaller path; api.ts reads it only for files", () => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /carryUploads/.test(fs.readFileSync(p, "utf8"))) hits.push(p); } };
  walk("src");
  assert.deepEqual(hits.sort(), ["src/core/modules/context.ts", "src/core/modules/dependencies.ts"]);
  const dep = fs.readFileSync("src/core/modules/dependencies.ts", "utf8");
  assert.match(dep, /callerMethodsOf\(master, service\)\.includes\(method\)\) \{\n\s+viewer = caller;\n\s+carryUploads = true;/);
  assert.match(dep, /runOn\(master, service, method, args, locale, viewer, carryUploads\)/);
  assert.match(dep, /runOn\(r, service, method, args, locale, viewer\)/, "replicas get no uploader");
  const api = fs.readFileSync("src/core/modules/api.ts", "utf8");
  assert.equal((api.match(/caller\?\.uploader/g) ?? []).length, 2, "only claim and the actor of remove read it");
  assert.ok(!/viewer/.test(api));
});
