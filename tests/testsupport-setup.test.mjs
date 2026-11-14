import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "../testsupport/fakeCtx.mjs";

// The fake `ctx.api.instances.pending/setUp` follows the rules of the core (src/core/modules/setUp.ts): it never says yes to what the core refuses.
const installedModules = () => ({ screen: { name: "Screen", offers: [{ service: "demo.screen", version: 1 }], instances: 0 } });
const base = { permissions: ["instances.setup"], requires: [{ service: "demo.screen", optional: true }] };

test("fake setUp: created once, then present; pending empties", async () => {
  const ctx = fakeCtx({ ...base, installedModules: installedModules() });
  assert.deepEqual(await ctx.api.instances.pending(), [{ module: "screen", name: "Screen", services: ["demo.screen"] }]);
  assert.deepEqual(await ctx.api.instances.setUp("screen"), { ok: true, state: "created" });
  assert.deepEqual(await ctx.api.instances.setUp("screen"), { ok: true, state: "present" });
  assert.deepEqual(await ctx.api.instances.pending(), []);
  assert.deepEqual(ctx.calls.setUps, ["screen", "screen"]);
});

test("fake setUp refuses what the core refuses", async () => {
  const mk = (o) => fakeCtx({ ...base, installedModules: installedModules(), ...o });
  assert.deepEqual(await mk({ permissions: [] }).api.instances.setUp("screen"), { ok: false, reason: "no-permission" });
  assert.deepEqual(await mk({ permissions: [] }).api.instances.pending(), []);
  assert.deepEqual(await mk({ person: null }).api.instances.setUp("screen"), { ok: false, reason: "no-person" });
  assert.deepEqual(await mk({ person: { id: "u2", email: "e@example.test", role: "editor" } }).api.instances.setUp("screen"), { ok: false, reason: "denied" });
  assert.deepEqual(await mk({ requires: [] }).api.instances.setUp("screen"), { ok: false, reason: "undeclared" });
  assert.deepEqual(await mk({ installedModules: {} }).api.instances.setUp("screen"), { ok: false, reason: "not-installed" });
  assert.deepEqual(await fakeCtx({ ...base }).api.instances.pending(), [], "nothing installed by default");
});
