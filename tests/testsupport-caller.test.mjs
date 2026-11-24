// Caller identity of a service (core 0.48.0) in the module test kit: `fakeCtx({ caller })`, the fake services' second argument, and the `compat.minCore` requirement.
import test from "node:test";
import assert from "node:assert/strict";
import { REQUIREMENTS, fakeCtx } from "../testsupport/index.mjs";

const minCore = REQUIREMENTS.find((r) => r.id === "compat.minCore");
const mod = (code, definition, minCoreValue) => ({ manifest: { id: "x", minCore: minCoreValue, permissions: [] }, definition, code });

test("fakeCtx: ctx.caller is absent by default and, when given, frozen and without a prototype like the real one", () => {
  assert.equal("caller" in fakeCtx(), false);
  const c = fakeCtx({ caller: { kind: "module", id: "other", instance: "x", instanceId: "id-x" } }).caller;
  assert.deepEqual({ ...c }, { kind: "module", id: "other", instance: "x", instanceId: "id-x" });
  assert.equal(Object.getPrototypeOf(c), null);
  assert.equal(Object.isFrozen(c), true);
});

test("fakeCtx: the fake services receive the calling module as their second argument", async () => {
  const seen = [];
  const ctx = fakeCtx({ moduleId: "cons", key: "form", services: { "demo.who": { echo: (args, caller) => { seen.push(caller); return args; } } } });
  assert.deepEqual((await ctx.api.services.call("demo.who", "echo", { a: 1 })).value, { a: 1 });
  assert.deepEqual({ ...seen[0] }, { kind: "module", id: "cons", instance: "form", instanceId: "id-form" });
});

test("compat.minCore: a service method with a third parameter, or ctx.caller, needs minCore 0.48.0", async () => {
  const withThird = { services: { "demo.who": { edit: async (ctx, args, caller) => caller } } };
  const without = { services: { "demo.who": { edit: async (ctx, args) => args } } };
  assert.match((await minCore.run(mod("export default {}", withThird, "0.47.0"))).join("\n"), /0\.48\.0/);
  assert.match((await minCore.run(mod("export default {}", withThird, undefined))).join("\n"), /0\.48\.0/);
  assert.deepEqual(await minCore.run(mod("export default {}", withThird, "0.48.0")), []);
  assert.match((await minCore.run(mod("export default { services: { a: { b: async (ctx) => ctx.caller.id } } }", without, "0.47.0"))).join("\n"), /0\.48\.0/);
  // Nothing recent is used: nothing to ask for.
  assert.ok(!Array.isArray(await minCore.run(mod("export default {}", without, undefined))) || (await minCore.run(mod("export default {}", without, undefined))).length === 0);
});
