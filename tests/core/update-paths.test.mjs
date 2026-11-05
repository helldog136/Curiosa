// The same update scenario run through BOTH ways a new version reaches a site: the in-place update of a bare-metal install and the start of a
// container on the same data. The oldest supported version goes through every bridge, one table of expected steps serves both.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";
import { setup, opts } from "../helpers/update-harness.mjs";
import { planUpdate, readState, runUpdateChain } from "../../scripts/update-lib.mjs";
import { checkDataVersion, readDataVersion, readFloor, runStartup, writeDataVersion } from "../../scripts/shared-lib.mjs";
import { dockerCommands, imageTag } from "../../scripts/install-kind.mjs";

// What the releases publish (upgrade.json per tag): 1.3.0 needs 1.2.0, which needs 1.1.0, which needs nothing. The oldest supported site is on 1.0.0.
const FLOORS = { "v1.3.0": { minFrom: "1.2.0" }, "v1.2.0": { minFrom: "1.1.0" } };
const fetchText = async (url) => { const m = /\/download\/(v[^/]+)\/upgrade\.json$/.exec(url); return m && FLOORS[m[1]] ? JSON.stringify(FLOORS[m[1]]) : null; };
// One table for both kinds: (from, target) -> the versions to pass through, in order.
const TABLE = [
  { from: "1.0.0", target: "v1.3.0", steps: ["v1.1.0", "v1.2.0", "v1.3.0"] },
  { from: "1.1.0", target: "v1.3.0", steps: ["v1.2.0", "v1.3.0"] },
  { from: "1.2.0", target: "v1.3.0", steps: ["v1.3.0"] },
  { from: "1.0.0", target: "v1.1.0", steps: ["v1.1.0"] },
];

test("one plan for both kinds: the bare-metal steps are the Docker image tags, the commands follow the same list", async () => {
  for (const c of TABLE) {
    const steps = await planUpdate({ current: c.from, target: c.target, repo: "owner/curiosa", fetchText });
    assert.deepEqual(steps, c.steps, `${c.from} -> ${c.target}`);
    const tags = steps.map(imageTag);
    assert.equal(dockerCommands(tags).length, steps.length > 1 ? steps.length : 1);
  }
});

test("bare metal: the oldest supported site reaches the target through every bridge, a database copy before each step", async () => {
  const s = setup(); try {
    s.build("1.1.0"); s.build("1.2.0"); s.build("1.3.0");
    const visited = [];
    const exec = async (cmd, args, o) => { if (cmd === "sh") { visited.push(s.buildId().replace("build-", "")); return { stdout: "" }; } return s.make()(cmd, args, o); };
    const r = await runUpdateChain({ ...opts(s), tag: "v1.3.0", exec, restartCommand: "restart", fetchText, waitForSite: async () => true });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(visited, ["1.1.0", "1.2.0", "1.3.0"], "each bridge was installed and restarted before the next");
    assert.equal(fs.readdirSync(path.join(s.dataDir, "backups")).length, 3);
    assert.deepEqual([readState(s.dataDir).status, readState(s.dataDir).chain?.total], ["success", 3]);
  } finally { s.cleanup(); }
});

/** A container volume: a data folder, plus one "image" (app folder with its upgrade.json floor) per version. */
function dockerSite(version) {
  const root = makeTempDir("curiosa-vol-");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  const dbFile = path.join(dataDir, "curiosa.db");
  fs.writeFileSync(dbFile, `DB-of-${version}`);
  writeDataVersion(dataDir, version);
  const image = (v) => {
    const appDir = path.join(root, `image-${v}`);
    fs.mkdirSync(appDir, { recursive: true });
    const floor = FLOORS[`v${v}`]?.minFrom;
    if (floor) fs.writeFileSync(path.join(appDir, "upgrade.json"), JSON.stringify({ minFrom: floor }));
    return appDir;
  };
  /** Start the image of `v` on the volume: the entrypoint (runStartup) then, if it went well, the server's first start writes the marker. */
  const start = async (v) => {
    const migrated = [];
    const r = await runStartup({ appDir: image(v), dataDir, version: v, databaseUrl: `file:${dbFile}`, now: () => Date.now(), exec: async () => { fs.writeFileSync(dbFile, `DB-of-${v}`); migrated.push(v); return { stdout: "ok" }; } });
    if (r.ok) writeDataVersion(dataDir, v);
    return { r, migrated };
  };
  return { root, dataDir, dbFile, start, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("Docker: the same chain, one container start per tag of the plan — each start copies the database, migrates and moves the marker", async () => {
  const d = dockerSite("1.0.0"); try {
    const steps = await planUpdate({ current: "1.0.0", target: "v1.3.0", repo: "owner/curiosa", fetchText });
    for (const tag of steps.map(imageTag)) assert.equal((await d.start(tag)).r.ok, true, tag);
    assert.equal(readDataVersion(d.dataDir), "1.3.0");
    assert.equal(fs.readFileSync(d.dbFile, "utf8"), "DB-of-1.3.0");
    assert.equal(fs.readdirSync(path.join(d.dataDir, "backups")).length, 3, "a copy at each of the three starts");
    assert.equal(JSON.parse(fs.readFileSync(path.join(d.dataDir, "update", "startup.json"), "utf8")).status, "ok");
  } finally { d.cleanup(); }
});

test("Docker: jumping over the bridges is refused with the data untouched; going back to an older image is refused too", async () => {
  const d = dockerSite("1.0.0"); try {
    const jump = await d.start("1.3.0");
    assert.deepEqual([jump.r.ok, jump.r.error, jump.migrated], [false, "below-floor", []]);
    assert.equal(fs.readFileSync(d.dbFile, "utf8"), "DB-of-1.0.0", "database untouched");
    assert.equal(readDataVersion(d.dataDir), "1.0.0");
    assert.equal(fs.existsSync(path.join(d.dataDir, "backups")), false, "not even a copy: nothing was done");
    assert.equal((await d.start("1.1.0")).r.ok, true);
    assert.equal((await d.start("1.2.0")).r.ok, true);
    const back = await d.start("1.1.0");
    assert.deepEqual([back.r.ok, back.r.error], [false, "newer-than-image"]);
    assert.equal(readDataVersion(d.dataDir), "1.2.0");
    assert.equal(checkDataVersion({ dataDir: d.dataDir, version: "1.3.0", floor: readFloor(path.join(d.root, "image-1.3.0")) }).ok, true);
  } finally { d.cleanup(); }
});
