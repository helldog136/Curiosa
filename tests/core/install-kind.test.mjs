// One InstallKind function, one set of shared constants: the single place that reads CURIOSA_INSTALL, the image tag policy, the commands printed for Docker.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { DOCKER_UPDATE_COMMAND, IMAGE_NAME, KEEP_BACKUPS, VERSION_ENV, dockerCommands, imageTag, imageTagsFor, installKind } from "../../scripts/install-kind.mjs";

test("installKind: docker only when CURIOSA_INSTALL is exactly docker; anything else is bare metal", () => {
  assert.equal(installKind({ CURIOSA_INSTALL: "docker" }), "docker");
  for (const v of [undefined, "", "bare-metal", "Docker", "podman", " docker"]) assert.equal(installKind({ CURIOSA_INSTALL: v }), "bare-metal", String(v));
  assert.equal(installKind({}), "bare-metal");
});

test("CURIOSA_INSTALL is read in exactly one place (scripts/install-kind.mjs): everything else calls installKind()", () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts", "tests/helpers", "testsupport", ".github", "next.config.mjs"], { encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx|mjs|js|sh|yml)$/.test(f) && fs.existsSync(f));
  const readers = files.filter((f) => /\bCURIOSA_INSTALL\b/.test(fs.readFileSync(f, "utf8")));
  // The image and the compose file SET it (Dockerfile / yml are not listed here); code files may only mention it in the one reader and in comments pointing to it.
  const codeReaders = readers.filter((f) => fs.readFileSync(f, "utf8").split("\n").some((l) => /(process\.)?env\.CURIOSA_INSTALL|env\[["']CURIOSA_INSTALL/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)));
  assert.deepEqual(codeReaders, ["scripts/install-kind.mjs"]);
});

test("image tags: exact, series and latest for a stable release; only the exact tag for a pre-release (latest never moves to it)", () => {
  assert.deepEqual(imageTagsFor("v0.7.3"), ["0.7.3", "0.7", "latest"]);
  assert.deepEqual(imageTagsFor("0.7.3"), ["0.7.3", "0.7", "latest"]);
  assert.deepEqual(imageTagsFor("v0.8.0-rc.2"), ["0.8.0-rc.2"]);
  assert.deepEqual(imageTagsFor("v10.12.0"), ["10.12.0", "10.12", "latest"]);
  assert.equal(imageTag("v0.6.10"), "0.6.10");
  assert.equal(IMAGE_NAME, "ghcr.io/helldog136/curiosa");
});

test("Docker commands: one line above the floor, one pinned line per step below it", () => {
  assert.deepEqual(dockerCommands(["0.7.0"]), [DOCKER_UPDATE_COMMAND]);
  assert.deepEqual(dockerCommands([]), [DOCKER_UPDATE_COMMAND]);
  const many = dockerCommands(["v0.6.10", "v0.7.0"]);
  assert.equal(many.length, 2);
  assert.equal(many[0], `${VERSION_ENV}=0.6.10 docker compose up -d`);
  assert.equal(many[1], `${VERSION_ENV}=0.7.0 docker compose up -d`);
  assert.equal(DOCKER_UPDATE_COMMAND, "docker compose pull && docker compose up -d");
  assert.equal(KEEP_BACKUPS, 5);
});
