// Docker installs: same check, notes and steps as bare metal, but nothing is ever installed from the site — the page shows the command to run.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const db = await useTestDb();
const S = await import("@/core/updates/service");
const ENV = ["CURIOSA_INSTALL", "CURIOSA_UPDATE_REPO", "CURIOSA_RESTART_COMMAND", "CURIOSA_SUPERVISED"];
beforeEach(async () => { await db.reset(); for (const k of ENV) delete process.env[k]; process.env.CURIOSA_INSTALL = "docker"; });
after(async () => { for (const k of ENV) delete process.env[k]; await db.close(); });

const ASSET = (tag) => `curiosa-${tag}-${process.platform}-${process.arch}.tar.gz`;
function app({ version = "1.0.0", release = true } = {}) {
  const dir = makeTempDir("curiosa-dkr-");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "curiosa", version }));
  if (release) fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify({ version, repo: "owner/curiosa" }));
  return dir;
}
const api = (tags) => async () => tags.map((t) => ({ tag_name: t, draft: false, prerelease: false, body: `Notes of ${t}`, assets: [{ name: ASSET(t) }] }));
const published = (files) => async (url) => { const m = /\/download\/(v[^/]+)\/upgrade\.json$/.exec(url); if (files[m?.[1]] === "panne") throw new Error("réseau"); return files[m?.[1]] === undefined ? null : JSON.stringify(files[m[1]]); };

test("the in-place update is impossible in Docker, even when release.json and a repository are present, and nothing is spawned", async () => {
  process.env.CURIOSA_UPDATE_REPO = "owner/curiosa";
  const started = [];
  const o = { appDir: app({ version: "1.0.0" }), spawner: (t) => started.push(t), dataDir: makeTempDir("d-") };
  const info = S.getInstallInfo(o.appDir);
  assert.deepEqual([info.kind, info.canApplyInPlace, info.canUpdate, info.canCheck, info.mode], ["docker", false, false, true, "docker"]);
  assert.deepEqual(await S.startUpdate("v1.2.0", "owner@example.org", o), { ok: false, error: "unsupported" });
  assert.deepEqual(started, []);
  assert.equal(await db.prisma.auditLog.count({ where: { action: "update.start" } }), 0);
});

test("the periodic check still tells a Docker site that a version exists (notes included) and never starts anything, even with automatic updates on", async () => {
  await S.setAutoUpdate(true);
  const started = [];
  const dir = app({ version: "1.0.0" });
  assert.equal(await S.runScheduledCheck({ appDir: dir, fetchJson: api(["v1.0.0", "v1.1.0"]), spawner: (t) => started.push(t), dataDir: makeTempDir("d-") }), "available");
  assert.deepEqual(started, []);
  const check = await S.getUpdateCheck(dir);
  assert.deepEqual([check.available, check.latest, check.notes], [true, "v1.1.0", "Notes of v1.1.0"]);
  assert.deepEqual(await S.findLatestStable({ appDir: dir, fetchJson: api(["v1.0.0", "v1.1.0"]) }), { tag: "v1.1.0", notes: "Notes of v1.1.0" });
});

test("a Docker site whose release source is unknown checks nothing", async () => {
  const dir = app({ release: false });
  assert.equal(S.getInstallInfo(dir).canCheck, false);
  assert.equal(await S.findLatestStable({ appDir: dir, fetchJson: api(["v9.0.0"]) }), null);
});

test("update plan for the page: one command above the floor, the ordered tags below it, a single step when the files cannot be read", async () => {
  const plan = (version, files) => S.dockerUpdatePlan("v1.3.0", { appDir: app({ version }), fetchText: published(files) });
  const files = { "v1.3.0": { minFrom: "1.2.0" }, "v1.2.0": { minFrom: "1.1.0" } };
  assert.deepEqual(await plan("1.2.0", files), { tags: ["1.3.0"], commands: ["docker compose pull && docker compose up -d"], planned: true });
  const old = await plan("1.0.0", files);
  assert.deepEqual([old.tags, old.planned, old.commands.length], [["1.1.0", "1.2.0", "1.3.0"], true, 3]);
  assert.match(old.commands[0], /^CURIOSA_VERSION=1\.1\.0 docker compose up -d$/);
  const down = await plan("1.0.0", { "v1.3.0": "panne" });
  assert.deepEqual([down.tags, down.planned, down.commands], [["1.3.0"], false, ["docker compose pull && docker compose up -d"]]);
});

test("last start result and data-version marker: written for the page, read back", () => {
  const dir = makeTempDir("d-");
  assert.equal(S.readStartupState(dir), null);
  fs.mkdirSync(path.join(dir, "update"));
  fs.writeFileSync(path.join(dir, "update", "startup.json"), JSON.stringify({ status: "refused", error: "below-floor", message: "m" }));
  assert.deepEqual([S.readStartupState(dir)?.status, S.readStartupState(dir)?.error], ["refused", "below-floor"]);
  fs.writeFileSync(path.join(dir, "update", "startup.json"), "{ pas du json");
  assert.equal(S.readStartupState(dir), null);
  assert.equal(S.recordStartedVersion(dir, "0.6.14"), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".curiosa-data-version"), "utf8")).version, "0.6.14");
});

test("the Updates page: Docker shows the command (copyable) instead of the Install button; texts exist in EN and FR", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/updates/page.tsx", "utf8");
  assert.ok(page.includes('data-testid="update-docker"') && page.includes("dockerUpdatePlan(check.latest)"), "the Docker block uses the shared plan");
  assert.ok(/\{check\.available && !docker && \(\s*<div[^>]*>\s*<h2[^>]*>\{t\("updates\.whatHappens"\)\}/.test(page), "the Install block is hidden in Docker");
  assert.ok(page.includes("{info.canUpdate && (\n        <Panel title={t(\"updates.autoTitle\")}"), "automatic updates stay out of Docker");
  for (const lang of ["en", "fr"]) {
    const t = JSON.parse(fs.readFileSync(`src/locales/${lang}.json`, "utf8"));
    for (const k of ["title", "one", "many", "step", "wait", "unplanned", "backup", "lastOk", "lastRefused", "refused.below-floor", "refused.newer-than-image", "refused.backup-failed", "refused.migrate-failed"]) assert.ok(t[`updates.docker.${k}`], `${lang}: updates.docker.${k}`);
    assert.ok(!/rebuild|reconstruire/.test(t["updates.mode.docker"]), "no 'rebuild' advice any more");
  }
});

test("the server records its version in the data folder once the module conversions are done (and only then)", () => {
  const src = fs.readFileSync("src/instrumentation.ts", "utf8");
  assert.ok(/converted = \(await runLegacySweep\(\{ startup: true \}\)\)\?\.done === true/.test(src) && /if \(converted\)[\s\S]{0,200}recordStartedVersion\(\)/.test(src));
});
