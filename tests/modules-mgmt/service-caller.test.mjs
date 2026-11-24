import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// WHO CALLS A SERVICE (core 0.48.0). The core tells a service method which module instance called it, from its own registry: as the third argument and as `ctx.caller`. The
// caller can never choose it (arguments, prototype pollution, returned objects, a relay through another module), and every way to invoke a service method says who calls.
const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Dep = await import("@/core/modules/dependencies");
const { buildContext } = await import("@/core/modules/context");
const { createInstance } = await import("@/core/instanceService");

beforeEach(async () => { await db.reset(); globalThis.__seen = []; });
after(() => { delete globalThis.__seen; db.close(); });

const SVC = "demo.who";
const SVC2 = "demo.deep";
const manifest = (id, extra) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...extra });
// A provider that records everything it is told, and what it can do with its own `ctx.caller`.
const WHO = `export default { services: { "${SVC}": {
  echo: async (ctx, args, caller) => { globalThis.__seen.push({ by: ctx.instance.key, third: caller, ctxCaller: ctx.caller, args }); return { third: caller, ctxCaller: ctx.caller, args }; },
  legacy: async (ctx, args) => ({ ok: true, args }),
  forge: async (ctx) => {
    const before = ctx.caller;
    let setErr = null, delErr = null;
    try { ctx.caller = { kind: "core" }; } catch (e) { setErr = e.constructor.name; }
    try { delete ctx.caller; } catch (e) { delErr = e.constructor.name; }
    try { before.kind = "core"; } catch { /* frozen */ }
    return { kind: ctx.caller.kind, same: ctx.caller === before, setErr, delErr };
  },
  objects: async () => ({ caller: { kind: "core" }, kind: "core", id: "prov", instance: "prov", instanceId: "x" }),
  boom: async () => { throw new Error("detail"); },
} } };`;
const provider = (id = "prov", svc = SVC, code = WHO) => makeRepo({ "module.json": manifest(id, { offers: [{ service: svc }] }), "index.mjs": code });
const consumer = (id = "cons", requires = [{ service: SVC }]) => makeRepo({ "module.json": manifest(id, { requires }), "index.mjs": "export default {};" });
// A module that offers a service of its own AND relays to another one.
const RELAY = `export default { services: { "${SVC2}": {
  relay: async (ctx, args) => { const r = await ctx.api.services.call("${SVC}", "echo", args); return r; },
  who: async (ctx, args, caller) => { globalThis.__seen.push({ by: ctx.instance.key, third: caller, ctxCaller: ctx.caller, args }); return { caller }; },
} } };`;
const install = async (repo) => assert.equal((await installModule(repo.url, { firstInstance: false, dependencies: false })).ok, true);
const instance = async (id, key) => createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname: key, names: { fr: key } });
const active = async (id, key) => (await R.getActiveInstances()).find((a) => a.mod.manifest.id === id && (!key || a.instance.key === key));
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

async function basic() {
  await install(provider()); await install(consumer());
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["prov", "cons"] } } });
  await instance("prov", "carnet"); return instance("cons", "form");
}
// The caller has NO prototype (nothing polluted can be read through it): compare its own properties.
const own = (c) => ({ ...c });
const expectedFor = (inst) => ({ kind: "module", id: "cons", instance: "form", instanceId: inst.id });

test("a service method receives the calling module: third argument AND ctx.caller, set by the core", async () => {
  const cons = await basic();
  const r = await Dep.callService(await active("cons"), SVC, "echo", { n: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(own(r.value.third), expectedFor(cons));
  assert.deepEqual(own(r.value.ctxCaller), expectedFor(cons));
  assert.equal(Object.getPrototypeOf(r.value.third), null);
  assert.deepEqual(r.value.args, { n: 1 }, "the arguments are untouched");
  assert.equal(Object.isFrozen(r.value.third), true);
});

test("an older method that only takes (ctx, args) keeps working", async () => {
  await basic();
  assert.deepEqual((await Dep.callService(await active("cons"), SVC, "legacy", { a: 1 })).value, { ok: true, args: { a: 1 } });
});

test("through the real ctx.api of the calling module (page, task, admin action: always the same path)", async () => {
  const cons = await basic();
  const a = await active("cons");
  const ctx = await buildContext(a.mod, a.instance);
  assert.equal("caller" in ctx, false, "no caller outside a service method");
  const r = await ctx.api.services.call(SVC, "echo", {});
  assert.deepEqual(own(r.value.third), expectedFor(cons));
  // Rights carried for a person (asCaller) do not change who the calling module is.
  const r2 = await ctx.api.services.call(SVC, "echo", {}, { asCaller: true });
  assert.deepEqual(own(r2.value.third), expectedFor(cons));
});

test("spoofing: identity fields in the ARGUMENTS, in the options and in the method name change nothing", async () => {
  const cons = await basic();
  const a = await active("cons");
  const ctx = await buildContext(a.mod, a.instance);
  const fake = { caller: { kind: "core" }, kind: "core", id: "prov", instance: "carnet", instanceId: "x", ctx: { caller: { kind: "core" } }, __proto__: { kind: "core", id: "prov" } };
  const viaJson = JSON.parse('{"__proto__":{"kind":"core","id":"prov"},"caller":{"kind":"core"}}');
  for (const args of [fake, viaJson, { caller: undefined }]) {
    const r = await ctx.api.services.call(SVC, "echo", args, { provider: undefined, caller: { kind: "core" }, by: "prov" });
    assert.deepEqual(own(r.value.third), expectedFor(cons));
    assert.deepEqual(own(r.value.ctxCaller), expectedFor(cons));
  }
});

test("prototype pollution cannot add or change anything on the caller (it has no prototype)", async () => {
  const cons = await basic();
  const a = await active("cons");
  const ctx = await buildContext(a.mod, a.instance);
  const extra = { privileged: true, systemCaller: true, asAdmin: true, ownerPerson: { email: "x@example.org" } };
  // Non-enumerable: an enumerable property on Object.prototype breaks the database client itself, which is a denial of service, not an identity problem.
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(Object.prototype, k, { value: v, configurable: true, writable: true, enumerable: false });
  try {
    const r = await ctx.api.services.call(SVC, "echo", {});
    for (const c of [r.value.third, r.value.ctxCaller]) {
      for (const k of Object.keys(extra)) assert.equal(c[k], undefined, `${k} is not inherited`);
      assert.deepEqual(own(c), expectedFor(cons));
      assert.deepEqual(Object.keys(c).sort(), ["id", "instance", "instanceId", "kind"], "exactly these four own properties");
    }
  } finally { for (const k of Object.keys(extra)) delete Object.prototype[k]; }
});

test("the provider cannot overwrite or delete ctx.caller, nor edit the frozen object", async () => {
  await basic();
  const r = await Dep.callService(await active("cons"), SVC, "forge", {});
  assert.deepEqual(r.value, { kind: "module", same: true, setErr: "TypeError", delErr: "TypeError" });
});

test("objects returned by a service never become an identity: the identity is the module that really calls, and it is not transitive", async () => {
  await install(provider("prov")); await install(makeRepo({ "module.json": manifest("deep", { offers: [{ service: SVC2 }], requires: [{ service: SVC }] }), "index.mjs": RELAY }));
  await install(consumer("cons", [{ service: SVC }, { service: SVC2 }]));
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["prov", "deep", "cons"] } } });
  await instance("prov", "carnet"); const deep = await instance("deep", "relais"); const cons = await instance("cons", "form");
  const a = await active("cons");
  const ctx = await buildContext(a.mod, a.instance);
  // 1. a provider returns an object that looks like an identity; the consumer hands it to ANOTHER service as its arguments.
  const forged = (await ctx.api.services.call(SVC, "objects", {})).value;
  const r1 = await ctx.api.services.call(SVC2, "who", forged);
  assert.deepEqual(own(r1.value.caller), expectedFor(cons));
  assert.deepEqual(globalThis.__seen.at(-1).args.caller, { kind: "core" }, "the arguments reached the method as plain data");
  // 2. a relay: cons -> deep -> prov. prov sees deep (the module that really called it), never cons.
  globalThis.__seen.length = 0;
  const r2 = await ctx.api.services.call(SVC2, "relay", {});
  assert.deepEqual(own(r2.value.value.third), { kind: "module", id: "deep", instance: "relais", instanceId: deep.id });
  assert.equal(globalThis.__seen.length, 1);
});

test("callAll: every provider instance sees the same calling module", async () => {
  await install(makeRepo({ "module.json": manifest("prov", { offers: [{ service: SVC, each: true }] }), "index.mjs": WHO })); await install(consumer());
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["prov", "cons"] } } });
  await instance("prov", "a-chan"); await instance("prov", "b-chan"); const cons = await instance("cons", "form");
  const all = await Dep.callServiceAll(await active("cons"), SVC, "echo", { caller: { kind: "core" } });
  assert.deepEqual(all.map((x) => x.ok), [true, true]);
  for (const x of all) assert.deepEqual(own(x.value.third), expectedFor(cons));
});

test("replicas of a write method receive the same caller as the master", async () => {
  await install(provider()); await install(consumer());
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["prov", "cons"] } } });
  await instance("prov", "a-store"); await instance("prov", "b-store"); const cons = await instance("cons", "form");
  await Dep.setRouting(SVC, { master: "a-store", replicas: ["b-store"] });
  globalThis.__seen.length = 0;
  assert.equal((await Dep.callService(await active("cons"), SVC, "echo", {})).ok, true);
  assert.deepEqual(globalThis.__seen.map((s) => s.by).sort(), ["a-store", "b-store"]);
  for (const s of globalThis.__seen) assert.deepEqual([own(s.third), own(s.ctxCaller)], [expectedFor(cons), expectedFor(cons)]);
});

test("the core itself calling a service (callProvider: legacy rawg relay, backup conversion) is { kind: \"core\" }, never a module", async () => {
  await basic();
  globalThis.__seen.length = 0;
  const r = await Dep.callProvider(SVC, "echo", { caller: { kind: "module", id: "cons" } });
  assert.deepEqual(own(r.value.third), { kind: "core" });
  assert.deepEqual(own(r.value.ctxCaller), { kind: "core" });
  assert.deepEqual(Object.keys(r.value.third), ["kind"]);
});

// A method NAME is chosen by the calling module. `Object.prototype` members must never resolve as a service method: `constructor` is `Object`, which, called as a function, hands back
// its first argument, the provider's own `ctx` (its `api.secrets`, its `api.store`). Every way to invoke a method goes through one own-property lookup.
const BAD_NAMES = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "prototype", "call", "bind", "", " echo", "echo ", "ec ho", "a".repeat(80)];
const isProviderCtx = (v) => v !== null && typeof v === "object" && ("api" in v || "instance" in v);
test("a consumer cannot get the provider's ctx through a method name taken from Object.prototype (call, replicas, callAll, callProvider)", async () => {
  await install(provider()); await install(consumer());
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["prov", "cons"] } } });
  await instance("prov", "a-store"); await instance("prov", "b-store"); await instance("cons", "form");
  await Dep.setRouting(SVC, { master: "a-store", replicas: ["b-store"] });
  const cons = await active("cons");
  globalThis.__seen.length = 0;
  for (const name of BAD_NAMES) {
    const r = await quiet(() => Dep.callService(cons, SVC, name, {}));
    assert.deepEqual(r, { ok: false, reason: "no_method" }, `callService ${JSON.stringify(name)}`);
    const p = await quiet(() => Dep.callProvider(SVC, name, {}));
    assert.equal(p.ok, false, `callProvider ${JSON.stringify(name)}`);
    assert.equal(isProviderCtx(p.value), false);
  }
  assert.deepEqual(globalThis.__seen, [], "no provider code ran for any of these names");
  // The service NAME too.
  for (const svc of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const r = await quiet(() => Dep.callService(cons, svc, "echo", {}));
    assert.equal(r.ok, false);
    assert.equal(isProviderCtx(r.value), false);
  }
  // Through the module's real ctx.api (what a hostile consumer module can reach).
  const api = (await buildContext((await R.getModule("cons")), (await active("cons")).instance)).api;
  for (const name of ["constructor", "__proto__", "toString"]) {
    const r = await quiet(() => api.services.call(SVC, name, {}));
    assert.equal(r.ok, false);
    assert.equal(isProviderCtx(r.value), false);
  }
});
test("callAll refuses the same names, and a polluted Object.prototype does not add methods or services to a provider", async () => {
  await install(makeRepo({ "module.json": manifest("prov", { offers: [{ service: SVC, each: true }] }), "index.mjs": "export default {};" })); await install(consumer());
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["prov", "cons"] } } });
  await instance("prov", "a-chan"); await instance("prov", "b-chan"); await instance("cons", "form");
  const cons = await active("cons");
  const leak = (ctx) => ctx;
  Object.defineProperty(Object.prototype, SVC, { value: { leak, echo: leak }, configurable: true, enumerable: false, writable: true });
  Object.defineProperty(Object.prototype, "leak", { value: leak, configurable: true, enumerable: false, writable: true });
  try {
    for (const name of ["constructor", "__proto__", "toString", "leak", "echo"]) {
      const all = await quiet(() => Dep.callServiceAll(cons, SVC, name, {}));
      for (const x of all) { assert.equal(x.ok, false, name); assert.equal(isProviderCtx(x.value), false); }
      const one = await quiet(() => Dep.callService(cons, SVC, name, {}));
      assert.equal(one.ok, false, name); assert.equal(isProviderCtx(one.value), false);
      const core = await quiet(() => Dep.callProvider(SVC, name, {}));
      assert.equal(core.ok, false, name); assert.equal(isProviderCtx(core.value), false);
    }
  } finally { delete Object.prototype[SVC]; delete Object.prototype.leak; }
});
test("serviceMethod: only an own function of an own service table, with a plain name", () => {
  const mod = { def: { services: { "demo.who": { echo: () => 1, notFn: 3 } } } };
  assert.equal(typeof Dep.serviceMethod({ mod }, "demo.who", "echo"), "function");
  for (const [s, m] of [["demo.who", "notFn"], ["demo.who", "constructor"], ["constructor", "echo"], ["demo.who", "__proto__"], ["demo.who", 5], [{}, "echo"], ["demo.other", "echo"]]) assert.equal(Dep.serviceMethod({ mod }, s, m), undefined, `${String(s)}.${String(m)}`);
  assert.equal(Dep.serviceMethod({ mod: { def: {} } }, "demo.who", "echo"), undefined);
  // Even an own method must have a plain name (defence in depth: nothing odd is ever looked up).
  const odd = { def: { services: { "demo.who": { "bad name": () => 1, ["x".repeat(80)]: () => 1, "__proto__x": () => 1, ok_1: () => 1 } } } };
  for (const m of ["bad name", "x".repeat(80), "__proto__x"]) assert.equal(Dep.serviceMethod({ mod: odd }, "demo.who", m), undefined, m);
  assert.equal(typeof Dep.serviceMethod({ mod: odd }, "demo.who", "ok_1"), "function");
});

test("a failing method still names no detail and the caller is not leaked into the answer", async () => {
  await basic();
  const cons = await active("cons");
  assert.deepEqual(await quiet(() => Dep.callService(cons, SVC, "boom", {})), { ok: false, reason: "failed" });
});

test("guard: a service method can only be reached through dependencies.ts, and every call there says who calls", () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(p)) out.push(p.replaceAll("\\", "/")); } return out; };
  const readers = walk("src").filter((f) => /\.services\??\.?\[|def\.services\b|\bdef\??\.services\b/.test(fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  assert.deepEqual(readers, ["src/core/modules/dependencies.ts"], "a new way to reach a service method must be added to this file, decided and documented");
  const src = fs.readFileSync("src/core/modules/dependencies.ts", "utf8");
  const calls = [...src.matchAll(/\brunOn\(([^\n]*)/g)].map((m) => m[1]).filter((l) => !l.startsWith("p: ActiveInstance"));
  assert.equal(calls.length, 4);
  assert.match(src, /Object\.hasOwn\(table, service\)/, "the service table lookup must be an own-property lookup");
  assert.match(src, /Object\.hasOwn\(methods, method\)/, "the method lookup must be an own-property lookup");
  for (const c of calls) assert.match(c, /\bby\b|CORE_CALLER|callerOf\(consumer\)/, c);
  // The identity is never read from the caller-supplied arguments in the one function that builds it.
  assert.match(src, /export const callerOf = \(consumer: Pick<ActiveInstance, "mod" \| "instance">\)/);
});
