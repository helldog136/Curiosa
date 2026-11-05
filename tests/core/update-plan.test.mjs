// scripts/update-plan.mjs: the ordered tag list from planUpdate, for the host-side script and the Updates page.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildPlan, latestStableTag, main } from "../../scripts/update-plan.mjs";

const files = { "v0.7.0": { minFrom: "0.6.10" }, "v0.6.10": { minFrom: "0.2.0" }, "v0.2.0": { minFrom: "0.1.4" } };
const fetchText = async (url) => { const m = /\/download\/(v[^/]+)\/upgrade\.json$/.exec(url); if (!m) throw new Error(`unexpected url ${url}`); return files[m[1]] ? JSON.stringify(files[m[1]]) : null; };
const fetchJson = async (url) => { assert.match(url, /\/repos\/owner\/curiosa\/releases\/latest$/); return { tag_name: "v0.7.0", draft: false, prerelease: false }; };

test("plan: a site above the floor goes straight to the target; an older one is carried through every bridge, in order, as image tags", async () => {
  const plan = (from, to = "v0.7.0") => buildPlan({ from, to, repo: "owner/curiosa", fetchText });
  const direct = await plan("0.6.10");
  assert.deepEqual([direct.ok, direct.steps, direct.tags, direct.commands], [true, ["v0.7.0"], ["0.7.0"], ["docker compose pull && docker compose up -d"]]);
  const old = await plan("0.1.1");
  assert.deepEqual(old.steps, ["v0.1.4", "v0.2.0", "v0.6.10", "v0.7.0"]);
  assert.deepEqual(old.tags, ["0.1.4", "0.2.0", "0.6.10", "0.7.0"]);
  assert.equal(old.commands.length, 4);
  assert.match(old.commands[0], /^CURIOSA_VERSION=0\.1\.4 docker compose up -d$/);
  assert.equal((await plan("0.7.0")).upToDate, true);
  assert.deepEqual((await plan("0.8.0")).steps, [], "a newer site has nothing to do");
  assert.equal((await plan("v0.6.10", "0.7.0")).to, "0.7.0", "v prefix optional on both sides");
});

test("plan: latest is the highest STABLE release (the repository's latest release); a network failure is an error, never 'no step'", async () => {
  assert.equal(await latestStableTag("owner/curiosa", fetchJson), "v0.7.0");
  await assert.rejects(latestStableTag("owner/curiosa", async () => ({ tag_name: "v0.8.0-rc.1" })), /no stable/);
  await assert.rejects(latestStableTag("owner/curiosa", async () => ({ tag_name: "v0.8.0", prerelease: true })), /no stable/);
  const viaLatest = await buildPlan({ from: "0.6.10", repo: "owner/curiosa", fetchText, fetchJson });
  assert.deepEqual(viaLatest.tags, ["0.7.0"]);
  const down = await buildPlan({ from: "0.1.1", to: "v0.7.0", repo: "owner/curiosa", fetchText: async () => { throw new Error("reseau"); } });
  assert.deepEqual([down.ok, down.error], [false, "plan-failed"]);
  assert.equal((await buildPlan({ from: "x", repo: "owner/curiosa", fetchText })).error, "invalid-from");
  assert.equal((await buildPlan({ from: "0.1.1", repo: "pas un depot", fetchText })).error, "invalid-repo");
  assert.equal((await buildPlan({ from: "0.1.1", to: "main", repo: "owner/curiosa", fetchText })).error, "invalid-target");
});

test("command line: --json prints one JSON document and exits 0; a failure prints { ok:false } and exits 1", async () => {
  let out = "";
  const code = await main(["--json", "--from", "0.1.1", "--to", "v0.7.0", "--repo", "owner/curiosa"], { appDir: "/nonexistent", out: (s) => { out += s; }, fetchText, fetchJson });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out).tags, ["0.1.4", "0.2.0", "0.6.10", "0.7.0"]);
  out = "";
  assert.equal(await main(["--json", "--from", "nope"], { appDir: "/nonexistent", out: (s) => { out += s; }, fetchText, fetchJson }), 1);
  assert.deepEqual(JSON.parse(out), { ok: false, error: "invalid-from" });
  out = "";
  await main(["--from", "0.1.1", "--to", "v0.7.0", "--repo", "owner/curiosa"], { appDir: "/nonexistent", out: (s) => { out += s; }, fetchText, fetchJson });
  assert.match(out, /^1\. CURIOSA_VERSION=0\.1\.4/m, "plain output: numbered commands");
});

test("the script runs as a program (real node process; an invalid argument needs no network)", () => {
  const r = spawnSync(process.execPath, ["scripts/update-plan.mjs", "--json", "--from", "nope"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { ok: false, error: "invalid-from" });
});
