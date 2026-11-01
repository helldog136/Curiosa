import test from "node:test";
import assert from "node:assert/strict";

const { withDeadline, TIMED_OUT } = await import("@/core/deadline");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("withDeadline : le résultat s'il arrive à temps, TIMED_OUT sinon, l'exception si elle arrive à temps", async () => {
  assert.equal(await withDeadline(async () => { await sleep(10); return 7; }, 200), 7);
  assert.equal(await withDeadline(() => new Promise(() => {}), 50), TIMED_OUT);
  assert.equal(await withDeadline(() => 3, 50), 3, "valeur directe");
  await assert.rejects(withDeadline(async () => { throw new Error("vraie erreur"); }, 200), /vraie erreur/);
  await assert.rejects(withDeadline(() => { throw new Error("levée tout de suite"); }, 200), /levée tout de suite/);
});

test("withDeadline : l'échec tardif d'un travail abandonné est absorbé (jamais d'erreur non gérée)", async () => {
  let unhandled = 0;
  const on = () => { unhandled++; };
  process.on("unhandledRejection", on);
  try {
    assert.equal(await withDeadline(async () => { await sleep(80); throw new Error("trop tard"); }, 20), TIMED_OUT);
    await sleep(150);
    assert.equal(unhandled, 0);
  } finally { process.off("unhandledRejection", on); }
});
