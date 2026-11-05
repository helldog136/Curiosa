// The Docker image and the release workflow: the image is the release archive unpacked (never a second build), and the workflow that pushes it
// cannot hurt the release, uses minimal permissions and never puts untrusted text in a shell.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeTempDir } from "../helpers/tmp.mjs";
import { IMAGE_NAME, imageTagsFor, imageTagsForExisting } from "../../scripts/install-kind.mjs";

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
  assert.deepEqual(Object.keys(J), ["plan", "build", "build-arm", "publish", "publish-required", "publish-arm", "image-arch", "image"]);
  for (const [name, text] of Object.entries(J)) {
    const pkgs = /packages: write/.test(text), cw = /contents: write/.test(text);
    assert.equal(pkgs, name === "image-arch" || name === "image", `${name}: packages: write`);
    assert.equal(cw, ["publish", "publish-required", "publish-arm"].includes(name), `${name}: contents: write`);
  }
});

test("workflow: the GitHub release never depends on the image — image jobs come after `publish`, are continue-on-error, and nothing needs them", () => {
  assert.ok(!/needs:[^\n]*image/.test(J.publish) && !/needs:[^\n]*image/.test(J.build) && !/needs:[^\n]*image/.test(J.plan));
  assert.match(J["image-arch"], /needs: \[plan, build, build-arm, publish, publish-required\]/);
  assert.match(J["image-arch"], /continue-on-error: true/); assert.match(J.image, /continue-on-error: true/);
  assert.match(J["image-arch"], /needs\.publish\.result == 'success' \|\| needs\.publish-required\.result == 'success' \|\| needs\.plan\.outputs\.dry_run == 'true'/, "after a successful release, or in a dry run (no release)");
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
  assert.match(wf, /docker_arch: arm64/);
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

test("workflow: the x64 archive is packed and smoke-tested (smoke-release.mjs) in `build`, and `publish` needs `build` — nothing is released from an untested archive", () => {
  const b = J.build;
  assert.ok(!/matrix|continue-on-error/.test(b), "x64 is a plain, strict job");
  assert.match(b, /runs-on: ubuntu-latest/);
  for (const step of ["npm run audit", "npx tsc --noEmit", "node scripts/migrations-sunset.mjs --check", "npm test", "npm run build"]) assert.ok(b.includes(step), `the full CI still runs on x64: ${step}`);
  assert.match(b, /node scripts\/release-pack\.mjs "\$VERSION" dist/);
  assert.match(b, /node scripts\/smoke-release\.mjs dist\/\*\.tar\.gz/);
  assert.ok(b.indexOf("release-pack.mjs") < b.indexOf("smoke-release.mjs") && b.indexOf("smoke-release.mjs") < b.indexOf("upload-artifact"), "pack, then smoke, then the artifact is kept");
  assert.match(J.publish, /needs: \[plan, build\]\n/, "publish waits for the x64 build only");
  assert.match(J.publish, /vars\.CURIOSA_ARM_REQUIRED != 'true'/);
  assert.ok(!/build-arm/.test(J.publish), "publish never waits for (or reads) the arm64 build");
  // What the 0.6.8 packaging bug needed: the archive must contain next.config.mjs, checked by smoke-release on the real archive.
  assert.match(read("scripts/smoke-release.mjs"), /next\.config\.mjs.*!fs\.existsSync\(path\.join\(app, "next\.config\.ts"\)\)/);
});

test("workflow: arm64 is NON-BLOCKING for the release while unproven (and blocking with CURIOSA_ARM_REQUIRED=true)", () => {
  const a = J["build-arm"];
  assert.match(a, /continue-on-error: \$\{\{ vars\.CURIOSA_ARM_REQUIRED != 'true' \}\}/);
  assert.match(a, /runs-on: \$\{\{ vars\.CURIOSA_ARM_RUNNER \|\| 'ubuntu-24\.04-arm' \}\}/);
  assert.ok(a.indexOf("release-pack.mjs") < a.indexOf("smoke-release.mjs") && a.indexOf("smoke-release.mjs") < a.indexOf("upload-artifact") && a.indexOf("upload-artifact") < a.indexOf("id: done"), "ok is set only after pack, smoke and upload all passed");
  assert.match(a, /ok: \$\{\{ steps\.done\.outputs\.ok \}\}/);
  // The release itself: x64 only, created by `publish`; the arm64 archive is ADDED later, only if it passed, never replacing or deleting anything.
  const add = J["publish-arm"];
  assert.match(add, /needs: \[plan, build-arm, publish\]/);
  assert.match(add, /needs\.publish\.result == 'success' && needs\.build-arm\.outputs\.ok == 'true'/);
  assert.match(add, /continue-on-error: true/);
  assert.match(add, /gh release view "\$TAG" --repo "\$REPO" --json assets/, "idempotent: the release's assets are listed first");
  assert.match(add, /gh release upload "\$TAG" "\$\{missing\[@\]\}"/, "only the missing files are uploaded");
  assert.match(add, /déjà présent/, "already published by `publish` (arm64 finished first): nothing to do, no failure");
  assert.ok(!/--clobber|gh release (delete|edit|create)/.test(add), "adds files, never replaces, edits or deletes");
  // Required mode: the same release job, but it waits for the arm64 build.
  assert.match(J["publish-required"], /needs: \[plan, build, build-arm\]/);
  assert.match(J["publish-required"], /vars\.CURIOSA_ARM_REQUIRED == 'true'/);
  assert.match(J["publish-required"], /gh release create "\$TAG" dist\/\* /);
  // The multi-arch manifest lists arm64 only if its image was pushed; otherwise amd64 only, said in the summary.
  assert.match(J.image, /name: digests-arm64\n\s+path: digests\/arm64/);
  assert.match(J.image, /continue-on-error: true\n\s+with:\n\s+name: digests-arm64/, "the arm64 digest is optional");
  assert.match(J.image, /name: digests-x64/, "the amd64 digest is mandatory");
  assert.match(J.image, /manifeste amd64 seul/);
  const legs = J["image-arch"].split("    steps:\n")[1].split(/\n(?=      - )/);
  const gated = (st) => st.includes("matrix.arch == 'x64' || needs.build-arm.outputs.ok == 'true' || needs.plan.outputs.retag == 'true'") || st.includes("needs.plan.outputs.retag != 'true' && (matrix.arch == 'x64' || needs.build-arm.outputs.ok == 'true')") || st.includes("if: ${{ needs.plan.outputs.retag == 'true' }}");
  assert.ok(legs.every(gated), "every step of the arm64 leg is skipped when no valid arm64 archive exists (unless images are rebuilt from a release)");
});

test("Dockerfile: the Prisma CLI is pointed at the engines of the archive (it ran as non-root and tried to write/download them: the first real image smoke failed there)", () => {
  // One stage per architecture sets the engine name; the CLI then never looks for (or downloads) anything.
  assert.match(lines, /FROM node:22-bookworm-slim AS target-amd64\s+ENV PRISMA_ENGINE_TARGET=debian-openssl-3\.0\.x/);
  assert.match(lines, /FROM node:22-bookworm-slim AS target-arm64\s+ENV PRISMA_ENGINE_TARGET=linux-arm64-openssl-3\.0\.x/);
  assert.match(lines, /FROM target-\$\{TARGETARCH\}/);
  assert.match(lines, /ENV PRISMA_SCHEMA_ENGINE_BINARY=\/app\/node_modules\/@prisma\/engines\/schema-engine-\$\{PRISMA_ENGINE_TARGET\}/);
  assert.match(lines, /ENV PRISMA_QUERY_ENGINE_LIBRARY=\/app\/node_modules\/\.prisma\/client\/libquery_engine-\$\{PRISMA_ENGINE_TARGET\}\.so\.node/);
  // The names match what the archive carries: the client engine per release-pack, the schema engine per the installed Prisma.
  const pack = read("scripts/release-pack.mjs");
  assert.ok(pack.includes('"debian-openssl-3.0.x"') && pack.includes('"linux-arm64-openssl-3.0.x"'));
  if (process.arch === "x64") assert.ok(fs.existsSync("node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x"), "the schema engine file name the Dockerfile expects");
});

test("workflow: images can be rebuilt for an EXISTING release from its published archives (also the way to retry a failed push), tags never move backwards", () => {
  assert.match(wf, /release_tag:[\s\S]*type: string/);
  assert.match(J.plan, /RELEASE_TAG: \$\{\{ inputs\.release_tag \}\}/, "through env, never interpolated in the shell");
  assert.match(J.plan, /\[\[ "\$RELEASE_TAG" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-rc\\\.\[0-9\]\+\)\?\$ \]\]/, "the tag is validated");
  assert.match(J.plan, /gh release view "\$RELEASE_TAG"/, "the release must exist");
  assert.match(J.plan, /imageTagsForExisting/);
  assert.match(J.plan, /echo "publish=false"[\s\S]*echo "pack=false"[\s\S]*echo "retag=true"/, "no release, no packaging");
  assert.match(J.build, /if: needs\.plan\.outputs\.retag != 'true'/, "no CI rebuild");
  assert.match(J["image-arch"], /gh release download "\$TAG" --repo "\$GITHUB_REPOSITORY" --pattern "curiosa-\*-linux-\$\{ARCH\}\.tar\.gz" --pattern "curiosa-\*-linux-\$\{ARCH\}\.tar\.gz\.sha256"/);
  assert.match(J["image-arch"], /sha256sum -c/, "the downloaded archive is verified against its published checksum");
  assert.match(J["image-arch"], /needs\.plan\.outputs\.retag == 'true'/);
  assert.match(J["image-arch"], /REVISION=\$\{\{ needs\.plan\.outputs\.revision \}\}/, "the revision label is the release's commit, not the workflow's");
  assert.match(J.plan, /repos\/\$GITHUB_REPOSITORY\/commits\/\$RELEASE_TAG/);
  assert.ok(!/gh release (create|upload|delete|edit)/.test(J["image-arch"] + J.image), "the image jobs never touch the release");
  assert.deepEqual(imageTagsForExisting("0.6.14", ["v0.6.14", "v0.6.13"]), ["0.6.14", "0.6", "latest"], "the highest release: the usual tags");
  assert.deepEqual(imageTagsForExisting("0.6.13", ["v0.6.14", "v0.6.13", "v0.5.0"]), ["0.6.13"], "an older patch moves neither 0.6 nor latest");
  assert.deepEqual(imageTagsForExisting("0.6.14", ["0.6.14", "0.7.0"]), ["0.6.14", "0.6"], "newest of its series, not of everything");
  assert.deepEqual(imageTagsForExisting("0.8.0-rc.1", ["0.7.0"]), ["0.8.0-rc.1"]);
});
