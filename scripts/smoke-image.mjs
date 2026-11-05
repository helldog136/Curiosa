// Smoke test of the built Docker image, run by .github/workflows/release.yml BEFORE anything is pushed to the registry.
//   node scripts/smoke-image.mjs <image> --version X.Y.Z [--previous <image>] [--docker docker]
// 1. an empty volume: the site becomes healthy, answers /api/health with this version, runs as a non-root user, the data folder belongs to that user;
// 2. PUID/PGID: the site runs as the requested ids and the data folder follows;
// 3. data from a NEWER version, and data below the support floor: the container refuses to start with a plain explanation and touches nothing;
// 4. (with --previous) the data of the previous release image: the new image starts on it, makes a pre-update copy and records its version.
// Everything Docker is done through `docker(args)` and the network through `http(url)`: tests/core/smoke-image.test.mjs runs this logic against stubs.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { DATA_VERSION_FILE, HEALTH_PATH, VERSION_HEADER } from "./install-kind.mjs";

const hashVersion = (version) => crypto.createHash("sha256").update(`curiosa:${String(version).replace(/^v/, "")}`).digest("hex").slice(0, 16);

export const defaultDocker = (bin = "docker") => (args) => new Promise((resolve) => {
  execFile(bin, args, { maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60_000 }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
});
export const defaultHttp = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); return { status: r.status, headers: Object.fromEntries(r.headers) }; };

/** @returns {Promise<{ ok: boolean, results: { ok: boolean, what: string }[] }>} */
export async function smokeImage({ image, version, previous, docker = defaultDocker(), http = defaultHttp, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), healthSeconds = 240, log = console.log, id = crypto.randomBytes(3).toString("hex") }) {
  const results = [];
  const check = (ok, what) => { results.push({ ok: !!ok, what }); log(`${ok ? "✓" : "✗"} ${what}`); return !!ok; };
  const make = (p) => `curiosa-smoke-${id}-${p}`;
  const created = { volumes: new Set(), containers: new Set() };
  const dk = async (args) => docker(args);
  const volume = async (name) => { await dk(["volume", "create", name]); created.volumes.add(name); return name; };
  const baseEnv = ["-e", "SITE_URL=http://localhost", "-e", "AUTH_SECRET=smoke-test-only", "-e", "SETUP_TOKEN=smoke-test-only"];

  async function start(name, vol, img, extraEnv = []) {
    created.containers.add(name);
    const r = await dk(["run", "-d", "--name", name, "-v", `${vol}:/app/data`, "-p", "127.0.0.1::3000", ...baseEnv, ...extraEnv, img]);
    return r.code === 0;
  }
  async function hostPort(name) {
    const r = await dk(["port", name, "3000/tcp"]);
    return /:(\d+)\s*$/m.exec(r.stdout)?.[1] ?? null;
  }
  async function waitHealthy(name) {
    const port = await hostPort(name);
    for (let i = 0; i < healthSeconds / 2; i++) {
      const state = (await dk(["inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", name])).stdout.trim();
      if (/^(exited|dead)/.test(state)) return { ok: false, why: `container stopped (${state})` };
      if (port) {
        try {
          const r = await http(`http://127.0.0.1:${port}${HEALTH_PATH}`);
          if (r.status === 200) return { ok: true, port, version: r.headers[VERSION_HEADER], state };
        } catch { /* not up yet */ }
      }
      await sleep(2000);
    }
    return { ok: false, why: "no healthy answer in time" };
  }
  const exec = (name, args) => dk(["exec", name, ...args]);
  async function stop(name) { await dk(["stop", "-t", "30", name]); }
  const logsOf = async (name) => { const r = await dk(["logs", "--tail", "40", name]); return `${r.stdout}\n${r.stderr}`; };

  try {
    // 1. empty volume
    {
      const vol = await volume(make("fresh")), name = make("fresh-c");
      check(await start(name, vol, image), "empty volume: the container starts");
      const h = await waitHealthy(name);
      check(h.ok, `empty volume: ${h.ok ? "the site answers /api/health" : `the site does not answer (${h.why})`}`);
      if (!h.ok) log((await logsOf(name)).trim());
      else {
        check(h.version === hashVersion(version), `empty volume: the site reports version ${version}`);
        check(Number((await exec(name, ["id", "-u"])).stdout.trim()) !== 0, "empty volume: the site does not run as root");
        const owner = (await exec(name, ["stat", "-c", "%u:%g", "/app/data"])).stdout.trim();
        check(owner === "1000:1000", `empty volume: the data folder belongs to the default user 1000:1000 (${owner})`);
        let marker = "";
        for (let i = 0; i < 30 && !marker; i++) { marker = (await exec(name, ["cat", `/app/data/${DATA_VERSION_FILE}`])).stdout; if (!marker) await sleep(1000); }
        check(marker.includes(version), "empty volume: the data version is recorded after the start");
        check(Number((await exec(name, ["sh", "-c", "ls /app/data/backups 2>/dev/null | wc -l"])).stdout.trim() || 0) === 0, "empty volume: nothing to copy yet (no database before the first start)");
      }
      await stop(name);
    }
    // 2. PUID / PGID
    {
      const vol = await volume(make("ids")), name = make("ids-c");
      await start(name, vol, image, ["-e", "PUID=1026", "-e", "PGID=100"]);
      const h = await waitHealthy(name);
      check(h.ok, "PUID/PGID: the site starts");
      if (h.ok) {
        check((await exec(name, ["id", "-u"])).stdout.trim() === "1026" && (await exec(name, ["id", "-g"])).stdout.trim() === "100", "PUID/PGID: the site runs as 1026:100");
        check((await exec(name, ["stat", "-c", "%u:%g", "/app/data"])).stdout.trim() === "1026:100", "PUID/PGID: the data folder follows");
      }
      await stop(name);
    }
    // 3. refusals: the data is never touched
    for (const [marker, expect, what] of [["99.0.0", /newer/i, "data from a newer version"], ["0.0.1", /can only update data from/i, "data below the support floor"]]) {
      const vol = await volume(make(`refuse-${marker.split(".")[0]}`));
      await dk(["run", "--rm", "--entrypoint", "sh", "-v", `${vol}:/data`, image, "-c", `echo ${marker} > /data/${DATA_VERSION_FILE}`]);
      const r = await dk(["run", "--rm", "-v", `${vol}:/app/data`, "-e", "CURIOSA_REFUSE_DELAY_SECONDS=0", ...baseEnv, image]);
      check(r.code !== 0 && expect.test(r.stderr + r.stdout), `${what}: the container refuses to start and says why`);
      const left = await dk(["run", "--rm", "--entrypoint", "sh", "-v", `${vol}:/data`, image, "-c", "ls /data"]);
      check(!/curiosa\.db|backups/.test(left.stdout), `${what}: no database, no copy: nothing was touched`);
    }
    // 4. the previous release's data
    if (previous) {
      const vol = await volume(make("upgrade")), old = make("old-c"), next = make("new-c");
      await start(old, vol, previous);
      const ho = await waitHealthy(old);
      check(ho.ok, "previous image: starts and creates its data");
      await stop(old);
      await dk(["rm", old]); created.containers.delete(old);
      await start(next, vol, image);
      const hn = await waitHealthy(next);
      check(hn.ok && hn.version === hashVersion(version), `previous data: the new image starts on it and reports ${version}`);
      if (hn.ok) {
        const copies = (await exec(next, ["sh", "-c", "ls /app/data/backups"])).stdout;
        check(/^pre-update-/m.test(copies), "previous data: a pre-update copy of the database was made");
      } else log((await logsOf(next)).trim());
      await stop(next);
    } else log("(no previous image given: the upgrade scenario was skipped)");
  } finally {
    for (const c of created.containers) await dk(["rm", "-f", c]);
    for (const v of created.volumes) await dk(["volume", "rm", "-f", v]);
  }
  return { ok: results.every((r) => r.ok), results };
}

async function cli(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const image = argv[0], version = arg("--version");
  if (!image || image.startsWith("--") || !/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(version ?? "")) { console.error("Usage: node scripts/smoke-image.mjs <image> --version X.Y.Z [--previous <image>] [--docker docker]"); return 2; }
  const r = await smokeImage({ image, version, previous: arg("--previous"), docker: defaultDocker(arg("--docker") ?? "docker") });
  console.log(r.ok ? "\nImage validated." : "\nThe image is not publishable.");
  return r.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await cli(process.argv.slice(2)));
