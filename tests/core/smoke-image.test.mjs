// scripts/smoke-image.mjs against a stub `docker`: the checks it makes, and that it fails on the problems it exists to catch.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { smokeImage } from "../../scripts/smoke-image.mjs";

const hash = (v) => crypto.createHash("sha256").update(`curiosa:${v}`).digest("hex").slice(0, 16);

/** A fake Docker that behaves like the real image (`opts` makes it misbehave). Records every call. */
function fakeDocker(opts = {}) {
  const calls = []; const volumes = {}; const containers = {};
  const dockerFn = async (args) => {
    calls.push(args.join(" "));
    const [cmd] = args;
    const vol = (a) => /-v ([^:]+):/.exec(a.join(" "))?.[1];
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (cmd === "volume") { if (args[1] === "create") volumes[args[2]] = {}; else delete volumes[args[3]]; return ok(); }
    if (cmd === "run" && args.includes("-d")) {
      const name = args[args.indexOf("--name") + 1]; const v = vol(args); const image = args[args.length - 1];
      const env = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "-e" ? [a.split("=")] : [])));
      const prior = volumes[v].data;
      containers[name] = { v, image, uid: Number(env.PUID ?? 1000), gid: Number(env.PGID ?? 1000), running: true, version: image.includes("old") ? "0.6.13" : "0.7.0", healthy: !opts.neverHealthy };
      volumes[v].data = true; volumes[v].marker = containers[name].version; volumes[v].owner = `${containers[name].uid}:${containers[name].gid}`;
      if (prior && !image.includes("old")) volumes[v].backups = ["pre-update-v0.7.0-1.db"];
      return ok(name);
    }
    if (cmd === "run" && args.includes("--entrypoint")) {
      const v = vol(args); const script = args[args.length - 1];
      const m = /echo (\S+) >/.exec(script); if (m) volumes[v].marker = m[1];
      if (/^ls /.test(script)) return ok([volumes[v].data ? "curiosa.db" : "", volumes[v].backups ? "backups" : ""].join("\n"));
      return ok();
    }
    if (cmd === "run") { // refusal run, in the foreground
      const v = vol(args); const m = volumes[v].marker;
      if (opts.neverRefuse) { volumes[v].data = true; return ok(); }
      if (m === "99.0.0") return { code: 1, stdout: "", stderr: "[curiosa] This data was last used by Curiosa 99.0.0, a newer version than this one (0.7.0)." };
      return { code: 1, stdout: "", stderr: "[curiosa] Version 0.7.0 can only update data from 0.6.10 or newer." };
    }
    if (cmd === "port") return ok("127.0.0.1:49153\n");
    if (cmd === "inspect") { const c = containers[args[args.length - 1]]; return ok(c?.running ? `running ${c.healthy ? "healthy" : "starting"}` : "exited "); }
    if (cmd === "exec") {
      const c = containers[args[1]]; const rest = args.slice(2).join(" ");
      if (rest === "id -u") return ok(String(opts.root ? 0 : c.uid)); if (rest === "id -g") return ok(String(c.gid));
      if (rest.startsWith("stat")) return ok(opts.wrongOwner ? "0:0" : volumes[c.v].owner);
      if (rest.startsWith("cat")) return ok(opts.noMarker ? "" : volumes[c.v].marker);
      if (rest.includes("wc -l")) return ok(String((volumes[c.v].backups ?? []).length));
      if (rest.startsWith("sh -c ls /app/data/backups")) return ok((volumes[c.v].backups ?? []).join("\n"));
      return ok();
    }
    if (cmd === "stop") { containers[args[args.length - 1]].running = false; return ok(); }
    if (cmd === "rm") { delete containers[args[args.length - 1]]; return ok(); }
    if (cmd === "logs") return ok("log line");
    return ok();
  };
  return { dockerFn, calls, volumes, containers };
}
const http = (version, status = 200) => async () => ({ status, headers: { "x-curiosa-version": hash(version) } });
const run = (fd, o = {}) => smokeImage({ image: "curiosa-smoke:x64", version: "0.7.0", docker: fd.dockerFn, http: http("0.7.0"), sleep: async () => {}, healthSeconds: 6, log: () => {}, id: "t", ...o });

test("a good image passes every check: empty volume, non-root, PUID/PGID, both refusals untouched", async () => {
  const fd = fakeDocker();
  const r = await run(fd);
  assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => !x.ok)));
  assert.ok(r.results.length >= 12);
  assert.ok(r.results.some((x) => /runs as 1026:100/.test(x.what)));
  assert.deepEqual(Object.keys(fd.volumes), [], "every volume is removed");
  assert.deepEqual(Object.keys(fd.containers), [], "every container is removed");
});

test("with a previous image: its data is started by the new image, a pre-update copy exists", async () => {
  const fd = fakeDocker();
  const r = await run(fd, { previous: "ghcr.io/o/curiosa:0.6.13-old" });
  assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => !x.ok)));
  assert.ok(r.results.some((x) => /pre-update copy/.test(x.what)));
  assert.ok(fd.calls.some((c) => c.includes("ghcr.io/o/curiosa:0.6.13-old")));
});

test("it catches the problems it exists for: running as root, wrong owner, wrong version, never healthy, a refusal that does not refuse", async () => {
  assert.equal((await run(fakeDocker({ root: true }))).results.find((x) => /does not run as root/.test(x.what)).ok, false);
  assert.equal((await run(fakeDocker({ wrongOwner: true }))).results.find((x) => /belongs to the default user/.test(x.what)).ok, false);
  assert.equal((await run(fakeDocker({ noMarker: true }))).ok, false);
  const wrongVersion = await run(fakeDocker(), { http: http("0.6.0") });
  assert.equal(wrongVersion.ok, false);
  const stuck = await run(fakeDocker({ neverHealthy: true }), { http: async () => { throw new Error("refused"); } });
  assert.equal(stuck.ok, false);
  assert.ok(stuck.results.some((x) => /does not answer/.test(x.what)));
  const lax = await run(fakeDocker({ neverRefuse: true }));
  assert.equal(lax.ok, false);
  assert.ok(lax.results.some((x) => !x.ok && /refuses to start/.test(x.what)));
});

test("the smoke test cleans up even when a check fails", async () => {
  const fd = fakeDocker({ root: true });
  await run(fd);
  assert.deepEqual([Object.keys(fd.volumes).length, Object.keys(fd.containers).length], [0, 0]);
});
