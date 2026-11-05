// The Docker image and the release workflow: the image is the release archive unpacked (never a second build), and the workflow that pushes it
// cannot hurt the release, uses minimal permissions and never puts untrusted text in a shell.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeTempDir } from "../helpers/tmp.mjs";
import { IMAGE_NAME, imageTagsFor } from "../../scripts/install-kind.mjs";

const read = (f) => fs.readFileSync(f, "utf8");
const docker = read("Dockerfile");
const wf = read(".github/workflows/release.yml");
const lines = docker.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n").replace(/\\\n/g, " ");

test("Dockerfile: the only way code enters the image is the release archive (no npm ci, no next build, no COPY of the source tree)", () => {
  for (const banned of [/npm\s+ci\b/, /npm\s+(run\s+)?build\b/, /npm\s+install\b/, /next\s+build/, /COPY\s+(--\S+\s+)*\.\s+\S/, /COPY\s+\.\s*$/m, /ADD\s+\.\s/, /COPY\s+--from/, /\bgit\s+clone\b/]) assert.ok(!banned.test(lines), `Dockerfile must not contain ${banned}`);
  assert.match(lines, /ADD archive-\$\{TARGETARCH\}\.tar\.gz \/app\//, "ADD of the archive of the architecture being built");
  assert.ok(!/^FROM .* AS build/m.test(lines), "single stage: nothing is built here");
});

test("Dockerfile: health check on /api/health, labels, shared start-up entrypoint, Docker install kind, no hard-coded root user", () => {
  assert.match(lines, /HEALTHCHECK [^C]*CMD \["node", "-e", "fetch\('http:\/\/127\.0\.0\.1:'\+\(process\.env\.PORT\|\|3000\)\+'\/api\/health'\)/);
  for (const l of ["org.opencontainers.image.source", "org.opencontainers.image.version", "org.opencontainers.image.revision"]) assert.ok(lines.includes(l), l);
  assert.match(lines, /ARG VERSION/); assert.match(lines, /ARG REVISION/);
  assert.match(lines, /ENTRYPOINT \["node", "\/app\/scripts\/docker-entrypoint\.mjs"\]/);
  assert.match(lines, /CURIOSA_INSTALL=docker/);
  assert.match(lines, /DATA_DIR=\/app\/data/); assert.match(lines, /VOLUME \/app\/data/);
  assert.ok(!/^USER\s+root/m.test(lines), "the entrypoint drops privileges itself; no USER root");
  assert.ok(!/CMD \["sh", "-c", "npx prisma/.test(lines), "no migrations in CMD: the shared start-up executor does them");
});

test("the source-built Dockerfile is a separate, clearly development-only file; compose keeps it as `build:`", () => {
  assert.match(read("Dockerfile.source"), /^# DEVELOPMENT alternative/);
  assert.match(read("docker-compose.yml"), /build:\s*\n\s*context: \.\s*\n\s*dockerfile: Dockerfile\.source/);
});

test("entrypoint: calls the shared start-up executor and nothing of the in-place updater", () => {
  const e = read("scripts/docker-entrypoint.mjs");
  assert.match(e, /import \{ runStartup \} from "\.\/shared-lib\.mjs"/);
  assert.ok(!/update-proc|update-lib/.test(e));
  assert.match(e, /node_modules\/prisma\/build\/index\.js/, "Prisma is called directly, not through npx");
});

/** The text of every `run:` step (single line or block). */
function runBlocks(text) {
  const out = []; const ls = text.split("\n");
  for (let i = 0; i < ls.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(ls[i]);
    if (!m) continue;
    if (/^[|>]-?$/.test(m[2])) { const ind = m[1].length; const body = []; for (i++; i < ls.length && (ls[i].trim() === "" || ls[i].search(/\S/) > ind + 1); i++) body.push(ls[i]); i--; out.push(body.join("\n")); }
    else out.push(m[2]);
  }
  return out;
}
/** The top-level jobs and their text. */
function jobs(text) {
  const start = text.indexOf("\njobs:\n"); const body = text.slice(start + 7); const map = {};
  let name = null;
  for (const l of body.split("\n")) { const m = /^  ([a-z][a-z-]*):\s*$/.exec(l); if (m) { name = m[1]; map[name] = ""; } else if (name) map[name] += l + "\n"; }
  return map;
}
const J = jobs(wf);

test("workflow safety: no expression is interpolated in a shell (everything goes through env), nothing untrusted", () => {
  for (const b of runBlocks(wf)) assert.ok(!b.includes("${{"), `a run step interpolates an expression: ${b.slice(0, 80)}`);
  assert.ok(!/github\.event\.(pull_request|head_commit|issue|comment)|github\.head_ref/.test(wf), "no attacker-controlled context");
  assert.ok(!/pull_request_target|workflow_run/.test(wf));
});

test("workflow permissions: read-only by default, packages: write only on the two image jobs, contents: write only on publish, no id-token", () => {
  assert.match(wf, /^permissions:\n  contents: read\n/m);
  assert.ok(!/id-token/.test(wf), "no OIDC token: provenance is attached by buildx, nothing signs with the job identity");
  assert.deepEqual(Object.keys(J), ["plan", "build", "publish", "image-arch", "image"]);
  for (const [name, text] of Object.entries(J)) {
    const pkgs = /packages: write/.test(text), cw = /contents: write/.test(text);
    assert.equal(pkgs, name === "image-arch" || name === "image", `${name}: packages: write`);
    assert.equal(cw, name === "publish", `${name}: contents: write`);
  }
});

test("workflow: the GitHub release never depends on the image — image jobs come after `publish`, are continue-on-error, and nothing needs them", () => {
  assert.ok(!/needs:[^\n]*image/.test(J.publish) && !/needs:[^\n]*image/.test(J.build) && !/needs:[^\n]*image/.test(J.plan));
  assert.match(J["image-arch"], /needs: \[plan, build, publish\]/);
  assert.match(J["image-arch"], /continue-on-error: true/); assert.match(J.image, /continue-on-error: true/);
  assert.match(J["image-arch"], /needs\.publish\.result == 'success' \|\| needs\.plan\.outputs\.dry_run == 'true'/, "after a successful release, or in a dry run (no release)");
  assert.ok(!/gh release (delete|edit)|--cleanup-tag|git push --delete/.test(wf), "no step can delete or alter a release");
  assert.match(J.publish, /gh release create "\$TAG" dist\/\* /);
  assert.ok(/image-arch:[\s\S]*Test de fumée de l'image[\s\S]*Envoi de l'image par empreinte/.test(wf), "the image is smoke-tested BEFORE it is pushed");
});

test("workflow: third-party actions are pinned by full commit SHA; official actions/* keep the repository convention (major tag)", () => {
  for (const m of wf.matchAll(/uses:\s*(\S+)/g)) {
    const ref = m[1];
    if (ref.startsWith("actions/")) assert.match(ref, /^actions\/[a-z-]+@v\d+$/, ref);
    else assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `third-party action not pinned by SHA: ${ref}`);
  }
  assert.ok(/docker\/build-push-action@[0-9a-f]{40} # v\d/.test(wf), "a version comment next to each SHA");
});

test("workflow: both architectures, arm64 on a native runner, provenance and SBOM, one multi-arch manifest", () => {
  assert.match(wf, /ubuntu-24\.04-arm/);
  assert.match(wf, /docker_arch\\":\\"arm64|docker_arch: arm64/);
  assert.match(wf, /provenance: mode=max/); assert.match(wf, /sbom: true/);
  assert.match(wf, /push-by-digest=true/);
  assert.match(wf, /docker buildx imagetools create/);
  assert.ok(!/setup-qemu|qemu/i.test(wf), "no emulation: each image is built on its own architecture");
});

test("workflow: image names and tags follow the shared policy; the dry run pushes only a throwaway tag, never latest", () => {
  assert.equal("helldog136/Curiosa".toLowerCase(), IMAGE_NAME.replace("ghcr.io/", ""), "the lower-cased repository is the image name of the constants");
  assert.match(wf, /image_name=ghcr\.io\/\$\{GITHUB_REPOSITORY,,\}/);
  assert.match(wf, /imageTagsFor\(process\.argv\[1\]\)/);
  assert.match(wf, /tags="dry-run-\$\{GITHUB_SHA::7\}"/, "dry-run tag");
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.ok(!/tags="dry-run-[^"]*latest/.test(code) && !/DRY_RUN[^\n]*latest/.test(code));
  assert.deepEqual(imageTagsFor("0.7.0"), ["0.7.0", "0.7", "latest"]);
  assert.deepEqual(imageTagsFor("0.7.0-rc.1"), ["0.7.0-rc.1"], "latest never moves for a pre-release");
  // Snapshots (dev-…) never get an image: only vX.Y.Z or vX.Y.Z-rc.N.
  assert.match(wf, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-rc\\\.\[0-9\]\+\)\?\$/);
  assert.match(wf, /workflow_dispatch:[\s\S]*image_dry_run:[\s\S]*type: boolean[\s\S]*default: true/);
});

test("release-pack: the archive of this architecture carries upgrade.json and its own database engines, not the other architecture's", () => {
  const root = makeTempDir("curiosa-pack-");
  try {
    const arch = process.arch;
    if (!["x64", "arm64"].includes(arch)) return;
    const own = arch === "arm64" ? ["linux-arm64-openssl-3.0.x"] : ["debian-openssl-1.1.x", "debian-openssl-3.0.x"];
    const other = arch === "arm64" ? ["debian-openssl-3.0.x"] : ["linux-arm64-openssl-3.0.x"];
    const w = (f, c = "x") => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); };
    w("package.json", JSON.stringify({ name: "curiosa", version: "1.2.3" })); w(".next/BUILD_ID"); w("upgrade.json", JSON.stringify({ minFrom: "1.0.0" }));
    w("prisma/schema.prisma"); w("prisma/migrations/001/migration.sql"); w("scripts/install.sh"); w("scripts/docker-entrypoint.mjs"); w("node_modules/x/index.js");
    for (const e of [...own, ...other]) w(`node_modules/.prisma/client/libquery_engine-${e}.so.node`);
    execFileSync(process.execPath, [path.resolve("scripts/release-pack.mjs"), "1.2.3", "out"], { cwd: root, env: { ...process.env, GITHUB_REPOSITORY: "owner/curiosa" }, stdio: "pipe" });
    const archive = fs.readdirSync(path.join(root, "out")).find((f) => f.endsWith(".tar.gz"));
    assert.match(archive, new RegExp(`^curiosa-v1\\.2\\.3-linux-${arch}\\.tar\\.gz$`));
    const listing = execFileSync("tar", ["-tzf", path.join(root, "out", archive)], { encoding: "utf8" }).split("\n");
    assert.ok(listing.includes("upgrade.json"), "the floor travels with the code");
    assert.ok(listing.includes("scripts/docker-entrypoint.mjs"));
    for (const e of own) assert.ok(listing.includes(`node_modules/.prisma/client/libquery_engine-${e}.so.node`), e);
    for (const e of other) assert.ok(!listing.includes(`node_modules/.prisma/client/libquery_engine-${e}.so.node`), `${e} is the other architecture's`);
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8")).paths.includes("upgrade.json"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("workflow: every archive is packed and smoke-tested (smoke-release.mjs) in `build`, and `publish` needs ALL build legs — nothing is released from an untested archive", () => {
  const b = J.build;
  assert.match(b, /node scripts\/release-pack\.mjs "\$VERSION" dist/);
  assert.match(b, /node scripts\/smoke-release\.mjs dist\/\*\.tar\.gz/);
  assert.ok(b.indexOf("release-pack.mjs") < b.indexOf("smoke-release.mjs") && b.indexOf("smoke-release.mjs") < b.indexOf("upload-artifact"), "pack, then smoke, then the artifact is kept");
  assert.ok(!/smoke-release[\s\S]{0,200}continue-on-error/.test(b) && !/continue-on-error/.test(b), "no step of `build` may fail without failing the job");
  assert.match(J.publish, /needs: \[plan, build\]/, "publish waits for every matrix leg (x64 and arm64)");
  assert.match(b, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.ok(!/fail-fast: false/.test(b), "one failing leg stops the others");
  // The matrix always has the x64 leg with the full CI (audit, tsc, tests, build) as before.
  assert.match(J.plan, /"arch\\":\\"x64\\",\\"docker_arch\\":\\"amd64\\",\\"runner\\":\\"ubuntu-latest\\",\\"full\\":true/);
  // What the 0.6.8 packaging bug needed: the archive must contain next.config.mjs, checked by smoke-release on the real archive.
  assert.match(read("scripts/smoke-release.mjs"), /next\.config\.mjs.*!fs\.existsSync\(path\.join\(app, "next\.config\.ts"\)\)/);
});
