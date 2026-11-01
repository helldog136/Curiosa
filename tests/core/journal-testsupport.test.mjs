// Le double de test du journal central (testsupport/fakeCtx.mjs) applique les mêmes règles que le cœur.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "../../testsupport/index.mjs";

const logEvents = JSON.parse(fs.readFileSync("tests/fixtures/extras/modules/demo-journal/module.json", "utf8")).logEvents;

test("fakeCtx : ctx.api.log écrit les champs déclarés seulement, sans acteur fourni par le module", async () => {
  const ctx = fakeCtx({ logEvents });
  assert.equal(await ctx.api.log.write({ action: "thing.done", target: "t", data: { name: "A", count: "2", token: "x", extra: 1 }, actor: "intrus" }), true);
  assert.deepEqual(ctx.dumpLog(), [{ action: "thing.done", target: "t", level: "info", data: { name: "A", count: 2 }, actor: "module" }]);
  assert.equal(await ctx.api.log.write({ action: "Bad Key" }), false);
  assert.equal(await ctx.api.log.write({ action: "mcp.x" }), false);
  assert.equal(await ctx.api.log.write({ action: "thing.failed", data: { name: "Bearer abcdefghijkl" } }), true);
  assert.deepEqual(ctx.calls.log.at(-1), { action: "thing.failed", target: "", level: "error", data: {}, actor: "module" });
});

test("fakeCtx : sans déclaration, ligne générique sans données ; acteur réglable", async () => {
  const ctx = fakeCtx({ actor: "assistant" });
  await ctx.api.log.write({ action: "anything", data: { a: 1 }, level: "warn" });
  assert.deepEqual(ctx.dumpLog(), [{ action: "anything", target: "", level: "warn", data: {}, actor: "assistant" }]);
});
