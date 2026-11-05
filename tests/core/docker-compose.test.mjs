import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { execFileSync } from "node:child_process";
import { makeTempDir } from "../helpers/tmp.mjs";

/**
 * docker-compose.yml and .env.example must not drift apart: the compose file is driven by variables from `.env`,
 * so every variable it reads has to be documented in .env.example, and nothing site-specific may be hard-coded.
 */
const root = path.resolve(import.meta.dirname, "../..");
const composeText = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const traefikText = fs.readFileSync(path.join(root, "docker-compose.traefik.yml"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const compose = YAML.parse(composeText);
const site = compose.services.site;
const caddy = compose.services.caddy;
// Compose-only tags (!reset, !override) are not plain YAML: drop the tag, keep the value.
const traefik = YAML.parse(traefikText.replace(/!(reset|override)\s+/g, ""));

test("compose: the image is pulled from GHCR (never built), version from CURIOSA_VERSION (default latest), PUID/PGID passed through; build is a separate dev file", () => {
  assert.equal(site.image, "ghcr.io/helldog136/curiosa:${CURIOSA_VERSION:-latest}");
  assert.equal(site.build, undefined, "no build in the main file");
  assert.equal(site.environment.PUID, "${PUID:-1000}");
  assert.equal(site.environment.PGID, "${PGID:-1000}");
  assert.equal(site.stop_grace_period, "30s");
  const dev = YAML.parse(fs.readFileSync(path.join(root, "docker-compose.build.yml"), "utf8"));
  assert.deepEqual(dev.services.site.build, { context: ".", dockerfile: "Dockerfile.source" });
  assert.equal(dev.services.site.image, undefined);
  assert.ok(!/--build/.test(composeText.split("\n").filter((l) => /docker compose up/.test(l) && !/build\.yml/.test(l)).join("\n")), "no instruction builds the image except the development one");
});

test("compose: Caddy takes an optional certificate e-mail through a generated Caddyfile (the shell is valid and the plain command stays the fallback)", () => {
  assert.equal(caddy.environment.CURIOSA_ACME_EMAIL, "${CURIOSA_ACME_EMAIL:-}");
  const script = caddy.entrypoint[2];
  assert.match(script, /reverse_proxy site:3000/);
  assert.match(script, /exec caddy run --config \/tmp\/Caddyfile --adapter caddyfile/);
  assert.match(script, /exec caddy reverse-proxy --from "\$\$CURIOSA_DOMAIN" --to site:3000/);
  // The very script, run for real with the compose escapes ($$ -> $) and a stub caddy: the Caddyfile it writes is the expected one.
  const dir = makeTempDir("curiosa-caddy-");
  try {
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "caddy"), "#!/bin/sh\necho \"caddy $*\"\nif [ -f \"$CADDYFILE\" ]; then cat \"$CADDYFILE\"; fi\n", { mode: 0o755 });
    const sh = script.replaceAll("$$", "$").replaceAll("/tmp/Caddyfile", path.join(dir, "Caddyfile"));
    const run = (env) => execFileSync("sh", ["-c", sh], { env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, CADDYFILE: path.join(dir, "Caddyfile"), ...env }, encoding: "utf8" });
    assert.equal(run({ CURIOSA_DOMAIN: "example.org", CURIOSA_ACME_EMAIL: "" }).trim(), "caddy reverse-proxy --from example.org --to site:3000");
    const withMail = run({ CURIOSA_DOMAIN: "example.org", CURIOSA_ACME_EMAIL: "me@example.org" });
    assert.match(withMail, /caddy run --config .*Caddyfile --adapter caddyfile/);
    assert.match(withMail, /\{\n\temail me@example\.org\n\}\nexample\.org \{\n\treverse_proxy site:3000\n\}/);
    assert.throws(() => run({ CURIOSA_DOMAIN: "" }), /Command failed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("compose: the public address is read from SITE_URL, never hard-coded", () => {
  assert.match(site.environment.SITE_URL, /^\$\{SITE_URL(:-[^}]*)?\}$/);
  assert.equal(/^\s*SITE_URL:\s*"?https?:\/\/(?!localhost)/m.test(composeText), false, "a real domain must not appear in the compose file");
  for (const name of ["SETUP_TOKEN", "AUTH_SECRET", "LEGACY_HOSTS", "CURIOSA_TRUSTED_PROXIES", "TZ"]) {
    assert.ok(String(site.environment[name] ?? "").includes("${" + name), `${name} is passed through from .env`);
  }
});

test("compose: data paths are fixed into the volume, so a copied .env cannot break them", () => {
  assert.equal(site.environment.DATABASE_URL, "file:/app/data/curiosa.db");
  assert.equal(site.environment.DATA_DIR, "/app/data");
  assert.equal(site.env_file, undefined, "no env_file: .env.example carries non-Docker values");
  assert.deepEqual(site.volumes, ["${CURIOSA_DATA_DIR:-curiosa_data}:/app/data"], "named volume by default, host folder when CURIOSA_DATA_DIR is a path");
  assert.ok(Object.keys(compose.volumes).includes("curiosa_data"));
});

test("compose: the site port is published on CURIOSA_BIND:CURIOSA_PORT, loopback by default", () => {
  assert.deepEqual(site.ports, ["${CURIOSA_BIND:-127.0.0.1}:${CURIOSA_PORT:-3000}:3000"]);
  assert.ok(site.healthcheck && JSON.stringify(site.healthcheck.test).includes("/api/health"));
  assert.equal(site.profiles, undefined, "the site starts without any profile");
});

test("compose: the https profile adds Caddy on 80, 443 and 443/udp with persistent certificates", () => {
  assert.deepEqual(caddy.profiles, ["https"]);
  assert.match(caddy.image, /^caddy:2/);
  assert.deepEqual(caddy.ports.sort(), ["443:443", "443:443/udp", "80:80"]);
  const cmd = [].concat(caddy.entrypoint ?? [], caddy.command ?? []).join(" ");
  assert.match(cmd, /CURIOSA_DOMAIN/);
  assert.match(cmd, /--to site:3000/);
  assert.ok(caddy.volumes.some((v) => v.startsWith("caddy_data:/data")) && caddy.volumes.some((v) => v.startsWith("caddy_config:/config")));
  assert.ok(Object.keys(compose.volumes).includes("caddy_data") && Object.keys(compose.volumes).includes("caddy_config"));
  assert.deepEqual([].concat(caddy.depends_on), ["site"]);
  assert.equal(caddy.restart, "unless-stopped");
  // Compose interpolates every service even with its profile off: a `:?` here would break the plain `docker compose up`.
  assert.equal(composeText.includes("CURIOSA_DOMAIN:?"), false);
});

test("compose: every ${VAR} it reads is documented in .env.example, in every compose file", () => {
  const used = new Set([...(composeText + "\n" + traefikText).matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  assert.ok(used.size >= 8, "the compose file reads its settings from variables");
  const documented = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const missing = [...used].filter((v) => !documented.has(v));
  assert.deepEqual(missing, [], `variables read by docker-compose.yml but missing from .env.example: ${missing.join(", ")}`);
  const dockerBlock = envExample.slice(envExample.indexOf("# ─── Docker (docker-compose.yml)"));
  assert.ok(dockerBlock.length > 0 && dockerBlock.length < envExample.length, "a separate Docker block exists");
  for (const v of ["CURIOSA_VERSION", "PUID", "PGID", "COMPOSE_FILE", "COMPOSE_PROFILES", "CURIOSA_ACME_EMAIL", "CURIOSA_DOMAIN", "CURIOSA_PORT", "CURIOSA_BIND", "CURIOSA_DATA_DIR", "TZ", "TRAEFIK_NETWORK", "TRAEFIK_ENTRYPOINT", "TRAEFIK_CERTRESOLVER"]) assert.ok(dockerBlock.includes(v + "="), `${v} is in the Docker block`);
});

test("traefik override: labels, no host port, external network, domain required, no Caddy", () => {
  const labels = traefik.services.site.labels.join("\n");
  for (const needle of ["traefik.enable=true", "Host(`${CURIOSA_DOMAIN:?", "${TRAEFIK_ENTRYPOINT:-websecure}", "tls=true", "${TRAEFIK_CERTRESOLVER:-letsencrypt}", "loadbalancer.server.port=3000", "traefik.docker.network="]) {
    assert.ok(labels.includes(needle), `label missing: ${needle}`);
  }
  assert.match(traefikText, /ports: !reset \[\]/, "the base host port mapping is removed");
  assert.equal(traefik.services.site.environment.CURIOSA_TRUSTED_PROXIES, "1");
  assert.deepEqual(traefik.services.site.networks, ["default", "traefik"]);
  assert.equal(traefik.networks.traefik.external, true);
  assert.equal(traefik.networks.traefik.name, "${TRAEFIK_NETWORK:-traefik}");
  assert.match(traefikText, /caddy:\n\s+profiles: !override \["disabled-with-traefik"\]/, "the Caddy profile cannot start with Traefik");
});
