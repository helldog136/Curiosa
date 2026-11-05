// scripts/install-docker.sh: the guided Docker install. Never run against a real Docker: `docker`, `curl`, `getent` and `ss` are stubs that record what they are asked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempDir } from "../helpers/tmp.mjs";

const SCRIPT = path.resolve("scripts/install-docker.sh");
const SRC = fs.readFileSync(SCRIPT, "utf8");

// ── catalogues ──
function catalogs() {
  const out = {};
  for (const m of SRC.matchAll(/^catalog_([a-z]{2})\(\) \{ cat <<'CATALOG_([A-Z]+)'\n([\s\S]*?)\nCATALOG_\2\n\}/gm)) {
    const lines = new Map();
    for (const line of m[3].split("\n")) { const k = /^(\S+) (.*)$/.exec(line); assert.ok(k, `catalog_${m[1]}: « key text » expected: ${line}`); assert.ok(!lines.has(k[1]), `duplicate key ${k[1]}`); lines.set(k[1], k[2]); }
    out[m[1]] = lines;
  }
  return out;
}
const CATS = catalogs();
const args = (txt) => [...new Set([...txt.matchAll(/\{(\d)\}/g)].map((m) => m[1]))].sort().join("");

test("messages: EN and FR have exactly the same keys and {arguments}; every key used by the code exists; none is orphaned", () => {
  assert.deepEqual(Object.keys(CATS).sort(), ["en", "fr"]);
  assert.deepEqual([...CATS.en.keys()].sort(), [...CATS.fr.keys()].sort());
  for (const [k, v] of CATS.en) assert.equal(args(CATS.fr.get(k)), args(v), `arguments of ${k}`);
  const body = SRC.split("catalog_en()")[0];
  const used = new Set([...body.matchAll(/\b(?:say|warn|die \d+|plan|t|confirm|ask [A-Z]+) ?"?((?:t|q|c|i|p|w|e|f|err|lbl)\.[a-z_.]+)/g)].map((m) => m[1]));
  for (const m of body.matchAll(/ask [A-Z]+ ((?:q)\.[a-z_]+)/g)) used.add(m[1]);
  for (const m of body.matchAll(/say "i\.proxy_\$mode"/g)) for (const x of ["caddy", "traefik", "host", "none"]) used.add(`i.proxy_${x}`);
  used.delete("i.proxy_");
  for (const k of used) assert.ok(CATS.en.has(k), `key used but missing: ${k}`);
  const orphans = [...CATS.en.keys()].filter((k) => !used.has(k) && k !== "lang.name");
  assert.deepEqual(orphans, [], "orphan keys");
});

test("messages: plain French and English (vouvoiement, no exclamation mark, no « Veuillez », no jargon from the forbidden list)", () => {
  for (const [lang, cat] of Object.entries(CATS)) for (const [k, v] of cat) {
    assert.ok(!v.includes("!"), `${lang}.${k}: no exclamation mark`);
    assert.ok(!/veuillez|\btu\b|\bton\b|\bta\b|\btes\b/i.test(v), `${lang}.${k}: vouvoiement`);
    assert.ok(!/\b(webhook|slug|payload|jeton|token)\b/i.test(v), `${lang}.${k}: jargon`);
  }
});

// ── a sandbox with stub programs ──
function sandbox(over = {}) {
  const root = makeTempDir("curiosa-dk-");
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  const log = path.join(root, "calls.log");
  const w = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  w("docker", `echo "docker $PWD $*" >> "${log}"
case "$1 $2" in
  "info "*) [ -n "$FAKE_NO_DAEMON" ] && exit 1; exit 0;;
  "compose version") echo "\${FAKE_COMPOSE_VERSION:-2.29.1}";;
  "ps --format") printf '%s\\n' "$FAKE_PS";;
  "network inspect") [ -n "$FAKE_NETWORK" ] && exit 0 || exit 1;;
  "inspect -f") echo "\${FAKE_HEALTH:-running healthy}";;
  "compose ps") echo cid123;;
  "compose logs") echo "site-1  | starting";;
  "compose pull"|"compose up") exit \${FAKE_FAIL_PULL:-0};;
esac
exit 0`);
  w("curl", `echo "curl $*" >> "${log}"
out=""; for ((i=1;i<=$#;i++)); do if [ "\${!i}" = -o ]; then j=$((i+1)); out="\${!j}"; fi; done
case "$*" in
  *releases/latest*) echo '{"tag_name": "v0.6.15"}';;
  *raw.example/*) [ -n "$out" ] && printf 'services: {}\\n# from %s\\n' "$*" > "$out";;
  *) exit 22;;
esac`);
  w("getent", `[ "$1" = ahostsv4 ] && [ -n "$FAKE_DNS" ] && echo "$FAKE_DNS STREAM $2"; exit 0`);
  w("ss", `for p in $FAKE_BUSY; do echo "LISTEN 0 4096 0.0.0.0:$p 0.0.0.0:*"; done; exit 0`);
  // A PATH without any docker: only the plain tools the script needs.
  const bare = path.join(root, "bare"); fs.mkdirSync(bare);
  for (const tool of ["bash", "sed", "awk", "grep", "tr", "cut", "head", "tail", "mkdir", "touch", "chmod", "mv", "cp", "cat", "uname", "mktemp", "sort", "rm", "dirname", "env"]) { const p = ["/usr/bin", "/bin"].map((d) => path.join(d, tool)).find((f) => fs.existsSync(f)); if (p) fs.symlinkSync(p, path.join(bare, tool)); }
  const run = (argv, env = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...argv], { cwd: root, encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, LANG: "C", CURIOSA_RAW_BASE: "https://raw.example/repo", CURIOSA_API_BASE: "https://api.example/repos/o/r", CURIOSA_PUBLIC_IP: "203.0.113.7", FAKE_DNS: "203.0.113.7", CURIOSA_POLL_SECONDS: "0", CURIOSA_HEALTH_SECONDS: "6", ...over, ...env }, input: "" });
    return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
  };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "");
  const envText = () => fs.readFileSync(path.join(root, "curiosa", ".env"), "utf8");
  return { root, bare, run, calls, envText, dir: path.join(root, "curiosa"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const ALL = ["--yes", "--domain", "example.org", "--email", "me@example.org", "--setup-token", "abc12345xyz"];

test("dry run: shows everything, writes nothing, runs no docker command that changes anything, never shows the setup code", () => {
  const s = sandbox(); try {
    const r = s.run([...ALL, "--dry-run"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!fs.existsSync(s.dir), "nothing created");
    assert.match(r.out, /Dry run: nothing was changed/);
    assert.match(r.out, /\.env  SITE_URL=https:\/\/example\.org/);
    assert.match(r.out, /COMPOSE_PROFILES=https/);
    assert.match(r.out, /docker compose pull && docker compose up -d/);
    assert.ok(!r.all.includes("abc12345xyz"), "the setup code is not printed");
    assert.ok(!/compose (pull|up)/.test(s.calls()), "no pull, no up");
  } finally { s.cleanup(); }
});

test("real run with Caddy: downloads the compose file of the latest release, writes .env, pulls then starts, waits for health, prints the update command", () => {
  const s = sandbox(); try {
    const r = s.run(ALL);
    assert.equal(r.code, 0, r.all);
    const env = s.envText();
    for (const l of ['SITE_URL="https://example.org"', 'CURIOSA_DOMAIN="example.org"', 'CURIOSA_ACME_EMAIL="me@example.org"', 'SETUP_TOKEN="abc12345xyz"', 'COMPOSE_FILE="docker-compose.yml"', 'COMPOSE_PROFILES="https"', 'CURIOSA_TRUSTED_PROXIES="1"', 'CURIOSA_PORT="3000"']) assert.ok(env.includes(l), l);
    assert.equal((fs.statSync(path.join(s.dir, ".env")).mode & 0o777).toString(8), "600", ".env is private");
    assert.ok(fs.existsSync(path.join(s.dir, "docker-compose.yml")));
    const c = s.calls();
    assert.match(c, /releases\/latest/);
    assert.match(c, /raw\.example\/repo\/v0\.6\.15\/docker-compose\.yml/, "the compose file of the release the image comes from");
    assert.ok(c.indexOf("compose pull") > -1 && c.indexOf("compose pull") < c.indexOf("compose up -d"), "pull, then up");
    assert.ok(c.split("\n").filter((l) => /compose (pull|up)/.test(l)).every((l) => l.includes(` ${s.dir} `)), "run inside the install folder");
    assert.match(r.out, /Curiosa is running/);
    assert.match(r.out, /https:\/\/example\.org\/admin\/setup/);
    assert.match(r.out, /To update later, in .*curiosa: docker compose pull && docker compose up -d/);
    assert.ok(!r.all.includes("abc12345xyz"), "the setup code is never printed");
  } finally { s.cleanup(); }
});

test("second run: same answers, same .env (no duplicate key), compose file kept, nothing deleted", () => {
  const s = sandbox(); try {
    assert.equal(s.run(ALL).code, 0);
    const first = s.envText(), compose = fs.readFileSync(path.join(s.dir, "docker-compose.yml"), "utf8");
    fs.appendFileSync(path.join(s.dir, ".env"), 'MY_OWN_SETTING="kept"\n');
    const r = s.run(ALL);
    assert.equal(r.code, 0, r.all);
    assert.equal(s.envText(), first + 'MY_OWN_SETTING="kept"\n', "identical, plus the person's own line");
    assert.equal(fs.readFileSync(path.join(s.dir, "docker-compose.yml"), "utf8"), compose);
    assert.match(r.out, /Kept docker-compose\.yml as it is/);
    // Run again with no option at all and no terminal: the saved answers are used.
    const again = s.run(["--yes"]);
    assert.equal(again.code, 0, again.all);
    assert.equal(s.envText(), first + 'MY_OWN_SETTING="kept"\n');
    assert.ok(!/\bdown\b|volume rm|rm -/.test(s.calls()), "never removes anything");
  } finally { s.cleanup(); }
});

test("--refresh downloads the compose files again and keeps the old one as .bak", () => {
  const s = sandbox(); try {
    s.run(ALL);
    fs.writeFileSync(path.join(s.dir, "docker-compose.yml"), "old\n");
    assert.equal(s.run([...ALL, "--refresh"]).code, 0);
    assert.equal(fs.readFileSync(path.join(s.dir, "docker-compose.yml.bak"), "utf8"), "old\n");
    assert.match(fs.readFileSync(path.join(s.dir, "docker-compose.yml"), "utf8"), /services/);
  } finally { s.cleanup(); }
});

test("proxy choice: Traefik when one runs here (and Compose >= 2.24), your own server when 80/443 are taken, Caddy otherwise, nothing without a domain", () => {
  let s = sandbox(); try {
    const r = s.run(ALL, { FAKE_PS: "traefik-1 traefik:v3", FAKE_NETWORK: "1" });
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /your Traefik on this machine/);
    const env = s.envText();
    assert.match(env, /COMPOSE_FILE="docker-compose\.yml:docker-compose\.traefik\.yml"/); assert.match(env, /COMPOSE_PROFILES=""/);
    assert.ok(fs.existsSync(path.join(s.dir, "docker-compose.traefik.yml")), "the override is downloaded too");
    const old = s.run([...ALL, "--proxy", "traefik"], { FAKE_COMPOSE_VERSION: "2.20.3" });
    assert.equal(old.code, 3); assert.match(old.err, /too old for the Traefik file: version 2\.24/);
  } finally { s.cleanup(); }
  s = sandbox(); try {
    const r = s.run(ALL, { FAKE_BUSY: "80 443" });
    assert.match(r.out, /something already uses ports 80 or 443/);
    assert.match(s.envText(), /CURIOSA_BIND="127\.0\.0\.1"/); assert.match(s.envText(), /COMPOSE_PROFILES=""/);
    assert.match(r.out, /Point your web server to http:\/\/127\.0\.0\.1:3000/);
  } finally { s.cleanup(); }
  s = sandbox(); try {
    const r = s.run(["--yes"], { FAKE_BUSY: "3000" });
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /a trial on this machine only/);
    assert.match(s.envText(), /SITE_URL="http:\/\/localhost:3001"/, "a busy port is skipped");
    assert.match(r.err, /Port 3000 is busy: using 3001/);
    assert.ok(!/CURIOSA_DOMAIN/.test(s.envText()));
  } finally { s.cleanup(); }
});

test("a pinned version, PUID/PGID and a data folder go to .env; the compose file is the latest release's (it only names an image tag)", () => {
  const s = sandbox(); try {
    const r = s.run([...ALL, "--version", "0.6.15", "--puid", "1026", "--pgid", "100", "--data-dir", "/volume1/docker/curiosa/data"]);
    assert.equal(r.code, 0, r.all);
    for (const l of ['CURIOSA_VERSION="0.6.15"', 'PUID="1026"', 'PGID="100"', 'CURIOSA_DATA_DIR="/volume1/docker/curiosa/data"']) assert.ok(s.envText().includes(l), l);
    assert.match(s.calls(), /releases\/latest/);
    assert.match(s.calls(), /raw\.example\/repo\/v0\.6\.15\/docker-compose\.yml/);
    const other = sandbox(); try {
      other.run([...ALL, "--version", "0.5.9"]);
      assert.match(other.calls(), /raw\.example\/repo\/v0\.6\.15\/docker-compose\.yml/, "never the compose file of an older pinned version (it could still build the image)");
      assert.ok(other.envText().includes('CURIOSA_VERSION="0.5.9"'));
    } finally { other.cleanup(); }
  } finally { s.cleanup(); }
});

test("DNS: a domain that does not point here is a warning (not a stop); --skip-dns skips the check", () => {
  const s = sandbox(); try {
    const r = s.run(ALL, { FAKE_DNS: "198.51.100.9" });
    assert.equal(r.code, 0, r.all);
    assert.match(r.err, /WARNING The domain example\.org points to 198\.51\.100\.9 \s*, not to this machine \(203\.0\.113\.7\)|WARNING The domain example\.org points to 198\.51\.100\.9/);
    assert.match(r.out, /1 warning\(s\) above/);
    const none = s.run(ALL, { FAKE_DNS: "" });
    assert.match(none.err, /does not resolve yet/);
    assert.ok(!/WARNING/.test(s.run([...ALL, "--skip-dns"], { FAKE_DNS: "" }).err));
  } finally { s.cleanup(); }
});

test("Docker missing or not running, Compose too old: plain refusal with exit code 3 and nothing written; --install-docker only on request", () => {
  const s = sandbox(); try {
    const noDocker = spawnSync("bash", [SCRIPT, "--yes"], { cwd: s.root, encoding: "utf8", env: { PATH: s.bare, LANG: "C", HOME: s.root } });
    assert.equal(noDocker.status, 3); assert.match(noDocker.stderr, /Docker is not installed/);
    assert.ok(!fs.existsSync(s.dir));
    const dry = spawnSync("bash", [SCRIPT, "--yes", "--dry-run", "--install-docker"], { cwd: s.root, encoding: "utf8", env: { PATH: s.bare, LANG: "C", HOME: s.root } });
    assert.equal(dry.status, 0, dry.stderr + dry.stdout); assert.match(dry.stdout, /it would be installed with the official script/);
    assert.equal(s.run(["--yes"], { FAKE_NO_DAEMON: "1" }).code, 3);
    assert.equal(s.run(["--yes"], { FAKE_COMPOSE_VERSION: "1.29.2" }).code, 3);
    assert.ok(!fs.existsSync(s.dir));
  } finally { s.cleanup(); }
});

test("the site does not become healthy: exit 10 with the end of its journal; a failing pull is exit 1", () => {
  const s = sandbox(); try {
    const r = s.run(ALL, { FAKE_HEALTH: "exited unhealthy" });
    assert.equal(r.code, 10, r.all);
    assert.match(r.out, /The site does not answer yet/); assert.match(r.out, /site-1  \| starting/);
    const bad = s.run(ALL, { FAKE_FAIL_PULL: "1" });
    assert.equal(bad.code, 1); assert.match(bad.err, /Cannot pull the image/);
  } finally { s.cleanup(); }
});

test("options are validated before anything happens (exit 2)", () => {
  const s = sandbox(); try {
    for (const [argv, re] of [[["--domain", "Not A Domain"], /not a valid domain/], [["--email", "nope"], /not a valid e-mail/], [["--proxy", "nginx"], /Unknown proxy mode/], [["--version", "main"], /Unknown version/], [["--puid", "0"], /PUID and PGID/], [["--setup-token", "short"], /setup code must have/], [["--frobnicate"], /Unknown option/], [["--dir"], /needs a value/]]) {
      const r = s.run(argv); assert.equal(r.code, 2, argv.join(" ")); assert.match(r.err, re);
    }
    assert.ok(!fs.existsSync(s.dir));
    assert.equal(s.run(["--lang", "xx"]).code, 2);
  } finally { s.cleanup(); }
});

test("language: --lang fr and the system language give French messages; English by default; same exit codes", () => {
  const s = sandbox(); try {
    const fr = s.run([...ALL, "--dry-run", "--lang", "fr"]);
    assert.equal(fr.code, 0); assert.match(fr.out, /Essai à blanc : rien n'a été modifié/);
    assert.match(s.run([...ALL, "--dry-run"], { LANG: "fr_BE.UTF-8" }).out, /Ce qui va être fait/);
    assert.match(s.run([...ALL, "--dry-run"]).out, /What will be done/);
    assert.match(s.run(["--lang", "fr", "--proxy", "x"]).err, /Mode de proxy inconnu/);
  } finally { s.cleanup(); }
});

test("safety: the script never removes data, never stops the site, never installs Docker unless asked, never pipes to a shell", () => {
  const code = SRC.split("catalog_en()")[0].split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.ok(!/rm -rf|compose down|volume rm|docker system prune|\| *(ba)?sh\b/.test(code));
  assert.ok(/INSTALL_DOCKER" = 1/.test(code), "Docker is installed only when --install-docker is given");
  assert.ok(/curl -fsSL https:\/\/get\.docker\.com -o "\$f"/.test(code), "downloaded then run, not piped");
});
