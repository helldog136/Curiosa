import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { migrateBuiltinModules } = await import("@/core/migrations/builtinToBundled");
const R = await import("@/core/modules/registry");
const { MODULES_DIR } = await import("@/core/config");

beforeEach(() => db.reset());
after(() => db.close());

const legacy = (id) => db.prisma.module.create({ data: { id, source: "builtin", version: "0.9.0", enabled: true } });

test("migration : un module « intégré » (0.1.2) devient un module ordinaire copié depuis l'instantané, instances et données intactes", async () => {
  await legacy("blog");
  const instance = await db.prisma.moduleInstance.create({ data: { moduleId: "blog", key: "actus", basePath: "actus" } });
  await migrateBuiltinModules();
  const row = await db.prisma.module.findUnique({ where: { id: "blog" } });
  assert.deepEqual([row.source, row.enabled], ["bundled", true], "toujours activé");
  assert.notEqual(row.version, "0.9.0", "version de l'instantané");
  assert.ok(fs.existsSync(path.join(MODULES_DIR, "blog", "module.json")));
  assert.ok(await db.prisma.moduleInstance.findUnique({ where: { id: instance.id } }), "l'instance est conservée");
  assert.equal((await R.getModule("blog")).manifest.id, "blog", "le module se charge comme tout module installé");
});

test("migration : idempotente, et un module absent de l'instantané est converti quand même (données gardées, module à réinstaller)", async () => {
  await legacy("blog"); await legacy("absent-de-l-instantane");
  await migrateBuiltinModules(); await migrateBuiltinModules();
  assert.deepEqual((await db.prisma.module.findMany({ orderBy: { id: "asc" } })).map((r) => [r.id, r.source]), [["absent-de-l-instantane", "bundled"], ["blog", "bundled"]]);
  assert.equal(fs.existsSync(path.join(MODULES_DIR, "absent-de-l-instantane")), false);
  const log = console.error; console.error = () => {};
  try { assert.equal(await R.getModule("absent-de-l-instantane"), null, "ignoré sans casser le site"); } finally { console.error = log; }
});

test("migration : lancée d'elle-même au premier passage du registre, une seule fois", async () => {
  await legacy("blog");
  await R.listModuleRows();
  assert.equal((await db.prisma.module.findUnique({ where: { id: "blog" } })).source, "bundled");
});

test("le cœur ne livre aucun module : sans instantané, l'assistant de première installation n'en propose aucun et rien ne casse", async () => {
  const keep = process.env.CURIOSA_EXTRAS_DIR;
  process.env.CURIOSA_EXTRAS_DIR = path.join(db.dir, "pas-d-extras");
  try {
    const { setupModules } = await import("@/core/modules/starter");
    assert.deepEqual(setupModules(), []);
    assert.deepEqual(await R.listModuleRows(), []);
  } finally { process.env.CURIOSA_EXTRAS_DIR = keep; }
});

test("instantané : récupéré par un script sans propriétaire écrit en dur, embarqué dans l'archive, jamais versionné", () => {
  const fetch = fs.readFileSync("scripts/fetch-extras.mjs", "utf8");
  assert.match(fetch, /GITHUB_REPOSITORY/, "propriétaire pris du dépôt qui publie");
  assert.ok(!new RegExp(["hell", "dog"].join(""), "i").test(fetch), "aucun propriétaire en dur");
  assert.match(fs.readFileSync("scripts/release-pack.mjs", "utf8"), /"extras"/);
  const wf = fs.readFileSync(".github/workflows/release.yml", "utf8");
  assert.ok(wf.indexOf("fetch-extras.mjs") > 0 && wf.indexOf("fetch-extras.mjs") < wf.indexOf("release-pack.mjs"), "l'instantané est pris avant l'empaquetage");
  assert.match(fs.readFileSync(".gitignore", "utf8"), /^\/extras\/$/m);
  assert.match(fs.readFileSync("package.json", "utf8"), /"extras:fetch"/);
  assert.ok(wf.indexOf("smoke-release.mjs") > wf.indexOf("release-pack.mjs") && wf.indexOf("smoke-release.mjs") < wf.indexOf("gh release create"), "l'archive est démarrée (installation neuve et mise à jour) avant d'être publiée");
});
