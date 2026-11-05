import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/**
 * docker-compose.yml and .env.example must not drift apart: the compose file is driven by variables from `.env`,
 * so every variable it reads has to be documented in .env.example, and nothing site-specific may be hard-coded.
 */
const root = path.resolve(import.meta.dirname, "../..");
const composeText = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const compose = YAML.parse(composeText);
const site = compose.services.site;
const caddy = compose.services.caddy;

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
  assert.ok(site.volumes.some((v) => v.startsWith("curiosa_data:/app/data")));
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

test("compose: every ${VAR} it reads is documented in .env.example (and the reverse for Docker-only names)", () => {
  const used = new Set([...composeText.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  assert.ok(used.size >= 8, "the compose file reads its settings from variables");
  const documented = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const missing = [...used].filter((v) => !documented.has(v));
  assert.deepEqual(missing, [], `variables read by docker-compose.yml but missing from .env.example: ${missing.join(", ")}`);
  const dockerBlock = envExample.slice(envExample.indexOf("# ─── Docker (docker-compose.yml)"));
  assert.ok(dockerBlock.length > 0 && dockerBlock.length < envExample.length, "a separate Docker block exists");
  for (const v of ["CURIOSA_DOMAIN", "CURIOSA_PORT", "CURIOSA_BIND", "TZ"]) assert.ok(dockerBlock.includes(v + "="), `${v} is in the Docker block`);
});
