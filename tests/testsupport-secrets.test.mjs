// Sealed secrets (core 0.48.0) in the module test kit: `fakeCtx` answers like the core, and the requirements ask for the permission and for minCore.
import test from "node:test";
import assert from "node:assert/strict";
import { checkModule, fakeCtx } from "../testsupport/index.mjs";
import { makeModule, dispose, editManifest } from "./fixtures/testsupport/fullModule.mjs";
import { after } from "node:test";
import { SECRET_NAME_RE, SECRET_MAX_CHARS, SECRET_MAX_NAMES } from "../src/core/services/secrets.ts";

const made = [];
after(() => { for (const d of made) dispose(d); });

test("fakeCtx.api.secrets: same names, bounds and answers as the core; unreadable names; no value in calls", async () => {
  const ctx = fakeCtx({ permissions: ["secrets"], secrets: { old: "v" }, secretsUnreadable: ["moved"] });
  assert.deepEqual(await ctx.api.secrets.set("botToken", "etoile-nord"), { ok: true });
  assert.deepEqual([await ctx.api.secrets.get("botToken"), await ctx.api.secrets.has("botToken"), await ctx.api.secrets.state("botToken")], ["etoile-nord", true, "set"]);
  assert.deepEqual([await ctx.api.secrets.get("moved"), await ctx.api.secrets.has("moved"), await ctx.api.secrets.state("moved")], [null, false, "unreadable"]);
  assert.deepEqual(await ctx.api.secrets.names(), ["botToken", "moved", "old"]);
  for (const bad of ["", "1a", "a.b", "x".repeat(49), null]) assert.deepEqual(await ctx.api.secrets.set(bad, "v"), { ok: false, reason: "invalid-name" });
  for (const bad of ["", null, 5, "x".repeat(4097)]) assert.deepEqual(await ctx.api.secrets.set("t", bad), { ok: false, reason: "invalid-value" });
  assert.deepEqual(await ctx.api.secrets.set("moved", "again"), { ok: true });
  assert.equal(await ctx.api.secrets.state("moved"), "set", "asking again fixes an unreadable name");
  assert.equal(await ctx.api.secrets.remove("old"), true);
  assert.ok(!JSON.stringify(ctx.calls.secrets).includes("etoile-nord"), "calls never keep a value");
  for (let i = 0; i < 40; i++) await ctx.api.secrets.set(`n${i}`, "v");
  assert.equal((await ctx.api.secrets.names()).length, 20);
  // The kit and the core agree on the bounds.
  assert.deepEqual([SECRET_NAME_RE.source, SECRET_MAX_CHARS, SECRET_MAX_NAMES], ["^[A-Za-z][A-Za-z0-9_-]{0,47}$", 4096, 20]);
});

test("fakeCtx.api.secrets without the permission: refusals, and the denial is noted", async () => {
  const ctx = fakeCtx({ permissions: ["storage"], secrets: { a: "v" } });
  assert.deepEqual(await ctx.api.secrets.set("botToken", "v"), { ok: false, reason: "no-permission" });
  assert.deepEqual([await ctx.api.secrets.get("a"), await ctx.api.secrets.has("a"), await ctx.api.secrets.state("a"), await ctx.api.secrets.remove("a"), await ctx.api.secrets.names()], [null, false, "absent", false, []]);
  assert.ok(ctx.calls.denied.includes("secrets"));
});

test("requirements: using ctx.api.secrets without the permission is reported; the permission needs minCore 0.48.0; declared but unused is advice", async () => {
  const mk = (permissions, minCore, withCode = true) => {
    const f = makeModule((files) => {
      if (withCode) files["index.mjs"] += "\nexport const readToken = (ctx) => ctx.api.secrets.get('botToken');";
      editManifest(files, (m) => { m.permissions = [...new Set([...m.permissions.filter((p) => p !== "secrets"), ...permissions])]; m.minCore = minCore; });
    });
    made.push(f); return f;
  };
  const problems = (rep, id) => (rep.results.find((r) => r.id === id).problems ?? []).join("\n");
  const without = await checkModule(mk([], "0.47.0"), { siblings: [] });
  assert.match(problems(without, "perm.declared"), /secrets/);
  const declared = await checkModule(mk(["secrets"], "0.47.0"), { siblings: [] });
  assert.equal(declared.results.find((r) => r.id === "perm.declared").status, "pass", problems(declared, "perm.declared"));
  assert.equal(declared.results.find((r) => r.id === "manifest.valid").status, "pass");
  assert.match(problems(declared, "compat.minCore"), /0\.48\.0/);
  const current = await checkModule(mk(["secrets"], "0.48.0"), { siblings: [] });
  assert.equal(current.results.find((r) => r.id === "compat.minCore").status, "pass", problems(current, "compat.minCore"));
  const unused = await checkModule(mk(["secrets"], "0.48.0", false), { siblings: [] });
  assert.match(JSON.stringify(unused.results.find((r) => r.id === "perm.minimal")), /secrets/);
});
