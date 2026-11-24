import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// The checks every candidate version goes through (installer.ts: validateCandidate) and the answer of a failed flow (toInstallResult): which refusal is said when
// several apply, and that the plain refusals are not logged as failures. The refusals themselves are covered by manifest-installer, reinstall, module-updates and subdir-modules.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
beforeEach(() => db.reset());
after(() => db.close());

const manifest = (over = {}) => ({ apiVersion: 2, id: "cand", name: "Cand", version: "1.0.0", ...over });
const GOOD = "export default { sections: { hello: () => [{ type: 'text', text: 'hi' }] } };\n";
async function quiet(run) {
  const seen = [];
  const log = console.error; console.error = (...a) => seen.push(a);
  try { return { result: await run(), logged: seen }; } finally { console.error = log; }
}

test("installation: the id check comes first, then the main file", async () => {
  const repo = makeRepo({ "module.json": manifest({ main: "absent.mjs" }) });
  const { result, logged } = await quiet(() => installModule(repo.url, { expectId: "other", firstInstance: false }));
  assert.equal(result.error, "modules.error.idmismatch");
  assert.deepEqual(logged, [], "a plain refusal is not logged as a failure");
  const again = await quiet(() => installModule(repo.url, { expectId: "cand", firstInstance: false }));
  assert.equal(again.result.error, "modules.error.nomain");
});

test("installation: a module that already exists is said before its code is even tried", async () => {
  const good = makeRepo({ "module.json": manifest({ main: "index.mjs" }), "index.mjs": GOOD });
  assert.equal((await installModule(good.url, { firstInstance: false })).ok, true);
  const broken = makeRepo({ "module.json": manifest({ main: "index.mjs" }), "index.mjs": "export default {" });
  const { result } = await quiet(() => installModule(broken.url, { firstInstance: false }));
  assert.equal(result.error, "modules.error.exists");
});

test("installation: code that does not load is refused with the load check, nothing is left", async () => {
  const broken = makeRepo({ "module.json": manifest({ main: "index.mjs" }), "index.mjs": "export default {" });
  const { result } = await quiet(() => installModule(broken.url, { firstInstance: false }));
  assert.deepEqual([result.ok, result.error, result.rolledBack], [false, "modules.error.loadCheck", false]);
  assert.equal(await db.prisma.module.findUnique({ where: { id: "cand" } }), null);
});
