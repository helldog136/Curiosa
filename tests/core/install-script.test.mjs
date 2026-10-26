import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";

/**
 * scripts/install.sh : le chemin d'installation « facile ». Le script n'est JAMAIS lancé pour de vrai ici :
 *  - racine fictive (CURIOSA_ROOT) : tout ce qui irait dans /etc, /var… va dans un dossier jetable ;
 *  - commandes système remplacées par des bouchons dans le PATH (useradd, getent, chown, systemctl, nginx…) : aucun utilisateur créé, aucun service réel ;
 *  - release simulée (archive minuscule + empreinte) servie par un serveur HTTP local ; le « site » de la release est un petit serveur Node qui répond 200.
 * Ce que ça ne prouve pas : systemd, Caddy/HTTPS réels, DNS réel, apt, Ubuntu vierge (voir docs/AGENT-INSTALL.md, « Ce qui est testé »).
 */
const SCRIPT = path.resolve("scripts/install.sh");
const NODE = process.execPath;
const bash = (args, opts = {}) => spawnSync("bash", args, { encoding: "utf8", ...opts });

/** Place libre à partir de laquelle chercher (et suivante libre aussi). */
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

const STUBS = {
  useradd: `#!/bin/sh\nlast=""; for a in "$@"; do last="$a"; done\nhome=""; while [ $# -gt 0 ]; do [ "$1" = "--home-dir" ] && home="$2"; shift; done\necho "$last:$home" >> "$CURIOSA_ROOT/.users"\n`,
  userdel: `#!/bin/sh\necho "$1" >> "$CURIOSA_ROOT/.deleted-users"\n`,
  chown: `#!/bin/sh\nexit 0\n`,
  getent: `#!/bin/sh\nif [ "$1" = passwd ]; then l=$(grep "^$2:" "$CURIOSA_ROOT/.users" 2>/dev/null | head -n1); [ -n "$l" ] || exit 2; echo "$2:x:999:999::$(echo "$l" | cut -d: -f2):/usr/sbin/nologin"; exit 0; fi\nexec /usr/bin/getent "$@"\n`,
  nginx: `#!/bin/sh\nif [ "$1" = "-t" ]; then [ -n "$FAKE_NGINX_FAIL" ] && { echo "nginx: [emerg] configuration invalide (simulée)" >&2; exit 1; }; exit 0; fi\nexit 0\n`,
  systemctl: `#!/bin/sh
state="$CURIOSA_ROOT/.systemctl"; mkdir -p "$state"
echo "$@" >> "$state/calls"
cmd="$1"; shift
case "$cmd" in
  is-active) [ "$1" = "--quiet" ] && shift; n="\${1%.service}"; case ",$FAKE_ACTIVE," in *",$n,"*) exit 0 ;; esac; [ -f "$state/active-$n" ] && exit 0; exit 3 ;;
  daemon-reload|reload|restart|stop|disable) exit 0 ;;
  enable)
    [ -n "$FAKE_ENABLE_FAIL" ] && { echo "Failed to enable (simulé)" >&2; exit 1; }
    [ "$1" = "--now" ] && shift; n="\${1%.service}"; u="$CURIOSA_ROOT/etc/systemd/system/$n.service"
    exec_line=$(sed -n 's/^ExecStart=//p' "$u"); wd=$(sed -n 's/^WorkingDirectory=//p' "$u")
    touch "$state/active-$n"
    cd "$CURIOSA_ROOT$wd" && nohup sh -c "$exec_line" >"$state/$n.out" 2>&1 &
    echo $! >> "$state/pids"; exit 0 ;;
esac
exit 0
`,
};

/** Une archive de release minuscule, mais de la bonne forme (release.json, node_modules/prisma, next, prisma/, .env.example). */
function buildRelease(dir, tag = "v9.9.9") {
  const src = path.join(dir, "src");
  const w = (f, c) => { fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true }); fs.writeFileSync(path.join(src, f), c); };
  w("release.json", JSON.stringify({ name: "curiosa", version: tag.slice(1), platform: "linux-x64" }, null, 2));
  w(".env.example", 'DATABASE_URL="file:../data/curiosa.db"\nSITE_URL="http://localhost:3000"\n# SETUP_TOKEN=""\n');
  w("prisma/schema.prisma", "// fixture\n");
  w("node_modules/prisma/build/index.js", 'const fs=require("fs");fs.mkdirSync("data",{recursive:true});fs.writeFileSync("data/curiosa.db","db");console.log("All migrations have been successfully applied.");\n');
  w("node_modules/next/dist/bin/next", 'const http=require("http");const i=process.argv.indexOf("-p");const h=process.argv.indexOf("-H");http.createServer((q,r)=>{r.statusCode=200;r.end("ok")}).listen(Number(process.argv[i+1]),process.argv[h+1]||"0.0.0.0");\n');
  const file = `curiosa-${tag}-linux-x64.tar.gz`;
  execFileSync("tar", ["-czf", path.join(dir, file), "-C", src, "."]);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex");
  fs.writeFileSync(path.join(dir, `${file}.sha256`), `${hash}  ${file}\n`);
  return { tag, file, hash };
}

/** Faux GitHub : /repos/…/releases/latest et /…/releases/download/<tag>/<fichier>. */
async function startGithub(dir, rel, opts = {}) {
  const hits = { downloads: 0, latest: 0 };
  const srv = http.createServer((q, r) => {
    if (q.url.endsWith("/releases/latest")) { hits.latest++; if (opts.noRelease) { r.statusCode = 404; return r.end("{}"); } r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({ tag_name: rel.tag })); }
    const m = /\/releases\/download\/[^/]+\/([^/]+)$/.exec(q.url);
    if (!m || !fs.existsSync(path.join(dir, m[1]))) { r.statusCode = 404; return r.end(); }
    if (m[1] === rel.file) hits.downloads++;
    if (m[1].endsWith(".sha256") && opts.badSha) return r.end(`${"0".repeat(64)}  ${rel.file}\n`);
    r.end(fs.readFileSync(path.join(dir, m[1])));
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  return { url: `http://127.0.0.1:${srv.address().port}`, hits, close: () => new Promise((res) => srv.close(res)) };
}

/** Un environnement jetable complet. */
async function lab(t, o = {}) {
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "inst-"));
  const root = path.join(base, "root");
  for (const d of ["run/systemd/system", "etc", "var/www", "var/log"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, "os-release"), 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n');
  const bin = path.join(base, "bin"); fs.mkdirSync(bin);
  for (const [n, c] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, n), c, { mode: 0o755 });
  const relDir = path.join(base, "rel"); fs.mkdirSync(relDir);
  const rel = buildRelease(relDir);
  const gh = await startGithub(relDir, rel, o);
  const portStart = o.portStart ?? await freePort();
  const env = {
    PATH: `${bin}:${path.dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: base, TMPDIR: base, LANG: "C.UTF-8",
    CURIOSA_ROOT: root, CURIOSA_ALLOW_NONROOT: "1", CURIOSA_UNAME_M: "x86_64", CURIOSA_OS_RELEASE: path.join(root, "os-release"),
    CURIOSA_GITHUB_API: gh.url, CURIOSA_GITHUB_WEB: gh.url, CURIOSA_MIN_FREE_MB: "1", CURIOSA_PORT_START: String(portStart),
    CURIOSA_PUBLIC_IP: "203.0.113.7", CURIOSA_DOMAIN_IP: "203.0.113.7",
  };
  const L = { base, root, bin, rel, gh, env, portStart, children: [] };
  /** Lance le script (asynchrone : le faux GitHub vit dans ce processus). */
  L.run = (args, extra = {}) => new Promise((res) => {
    const c = spawn("bash", [SCRIPT, ...args], { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => res({ code, out }));
  });
  /** Ce qui existe dans la racine fictive (hors bouchons) : sert à prouver « rien n'a été modifié ». */
  L.snapshot = () => {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === "os-release" || (d === root && e.name.startsWith("."))) continue; out.push(p.slice(root.length)); if (e.isDirectory()) walk(p); } };
    walk(root); return out.sort();
  };
  t.after(async () => {
    const pids = path.join(root, ".systemctl/pids");
    if (fs.existsSync(pids)) for (const p of fs.readFileSync(pids, "utf8").split("\n").filter(Boolean)) { try { process.kill(Number(p)); } catch {} }
    // le serveur lancé par le bouchon est un enfant de `sh` : on tue aussi par le port
    spawnSync("sh", ["-c", `for p in $(grep -l "" /dev/null); do :; done`]);
    await gh.close(); fs.rmSync(base, { recursive: true, force: true });
  });
  return L;
}
const BASE_ARGS = ["--site", "monsite", "--no-domain"];
const tokenOf = (L, site = "monsite") => /^SETUP_TOKEN="(.+)"$/m.exec(fs.readFileSync(path.join(L.root, "var/www", site, ".env"), "utf8"))[1];

test("le script est du bash valide, avec set -euo pipefail ; shellcheck propre s'il est installé", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /^#!\/usr\/bin\/env bash\n/);
  assert.match(src, /^set -euo pipefail$/m);
  assert.equal(bash(["-n", SCRIPT]).status, 0, bash(["-n", SCRIPT]).stderr);
  const sc = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
  if (sc.error) { t_skip("shellcheck n'est pas installé ici : contrôle ignoré (la CI de développement peut l'installer)"); return; }
  const r = spawnSync("shellcheck", ["-x", "-S", "warning", SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
});
function t_skip(msg) { console.log(`# SKIP ${msg}`); }

test("le script est livré : empaqueté dans l'archive (dossier scripts) ET publié seul à côté d'elle", () => {
  const pack = fs.readFileSync("scripts/release-pack.mjs", "utf8");
  assert.match(pack, /"scripts"/);
  assert.match(pack, /copyFileSync\("scripts\/install\.sh", path\.join\(outDir, "install\.sh"\)\)/);
  assert.match(fs.readFileSync(".github/workflows/release.yml", "utf8"), /dist\/\*/, "tout dist/ est joint à la release, install.sh compris");
});

test("--help s'affiche et ne fait rien ; une option inconnue est refusée", () => {
  const h = bash([SCRIPT, "--help"]);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /--dry-run/);
  const bad = bash([SCRIPT, "--nimportequoi"]);
  assert.equal(bad.status, 2);
});

test("--dry-run : tout est vérifié, rien n'est modifié, la release est trouvée, le plan est annoncé", async (t) => {
  const L = await lab(t);
  const before = L.snapshot();
  const r = await L.run([...BASE_ARGS, "--dry-run"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Rien n'a été modifié/);
  assert.match(r.out, /v9\.9\.9/);
  assert.match(r.out, /monsite-web/, "utilisateur proposé : <site>-web");
  assert.deepEqual(L.snapshot(), before);
  assert.equal(L.gh.hits.downloads, 0, "pas de téléchargement de l'archive en --dry-run");
  assert.ok(!fs.existsSync(path.join(L.root, ".users")));
});

test("ARM : arrêt propre AVANT toute modification, avec l'explication et le remède", async (t) => {
  const L = await lab(t); const before = L.snapshot();
  const r = await L.run([...BASE_ARGS, "--yes"], { CURIOSA_UNAME_M: "aarch64" });
  assert.equal(r.code, 1);
  assert.match(r.out, /ARM/); assert.match(r.out, /x86_64|amd64/); assert.match(r.out, /Que faire/);
  assert.deepEqual(L.snapshot(), before); assert.equal(L.gh.hits.latest, 0);
});

test("dossier non vide qui n'est pas à nous : refus, rien n'est écrasé", async (t) => {
  const L = await lab(t);
  const d = path.join(L.root, "var/www/monsite"); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "index.html"), "autre site");
  const before = L.snapshot();
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 1); assert.match(r.out, /n'est pas vide/); assert.match(r.out, /--dir/);
  assert.deepEqual(L.snapshot(), before); assert.equal(fs.readFileSync(path.join(d, "index.html"), "utf8"), "autre site");
});

test("empreinte SHA-256 fausse : rien n'est déplié ni installé, l'espace de travail est nettoyé, pas d'utilisateur créé", async (t) => {
  const L = await lab(t, { badSha: true }); const before = L.snapshot();
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 1); assert.match(r.out, /SHA-256/); assert.match(r.out, /Rien n'a été déplié/);
  assert.ok(!fs.existsSync(path.join(L.root, "var/www/monsite")));
  assert.ok(!fs.existsSync(path.join(L.root, ".users")), "aucun utilisateur créé");
  assert.deepEqual(L.snapshot().filter((p) => !p.startsWith("/var/log")), before.filter((p) => !p.startsWith("/var/log")), "rien de laissé derrière");
  assert.ok(!L.snapshot().some((p) => p.includes("staging")), "dossier provisoire supprimé");
});

test("aucune release stable : arrêt sans rien installer", async (t) => {
  const L = await lab(t, { noRelease: true });
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 1); assert.match(r.out, /GitHub|release/i);
  assert.ok(!fs.existsSync(path.join(L.root, ".users")));
});

test("Node trop ancien : sans accord on s'arrête avant toute modification ; hors Ubuntu/Debian on explique comment faire", async (t) => {
  const L = await lab(t);
  fs.writeFileSync(path.join(L.bin, "node"), "#!/bin/sh\n[ \"$1\" = -v ] && echo v18.19.0\nexit 0\n", { mode: 0o755 });
  const before = L.snapshot();
  const r = await L.run([...BASE_ARGS]);
  assert.equal(r.code, 1); assert.match(r.out, /trop ancien/); assert.match(r.out, /accord|--yes/);
  assert.deepEqual(L.snapshot(), before);
  fs.writeFileSync(path.join(L.root, "os-release"), 'ID=fedora\nPRETTY_NAME="Fedora"\n');
  const r2 = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r2.code, 1); assert.match(r2.out, /nodejs\.org/);
  assert.deepEqual(L.snapshot(), before);
});

test("sans systemd : arrêt expliqué avant toute modification", async (t) => {
  const L = await lab(t); fs.rmSync(path.join(L.root, "run"), { recursive: true });
  const before = L.snapshot();
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 1); assert.match(r.out, /systemd/); assert.deepEqual(L.snapshot(), before);
});

test("entrées invalides : nom de site, domaine, utilisateur root", async (t) => {
  const L = await lab(t);
  for (const [args, re] of [[["--site", "Mon Site", "--no-domain"], /nom du site/], [["--site", "monsite", "--domain", "https://"], /nom de domaine|domaine/], [["--site", "monsite", "--no-domain", "--user", "root"], /root/], [["--site", "monsite", "--domain", "192.168.1.5"], /domaine/]]) {
    const r = await L.run([...args, "--yes", "--dry-run"]);
    assert.equal(r.code, 1, args.join(" ")); assert.match(r.out, re);
  }
});

test("port occupé : le script prend le suivant sans toucher au processus qui l'occupe", async (t) => {
  const start = await freePort();
  const busy = net.createServer(); await new Promise((res) => busy.listen(start, "127.0.0.1", res)); t.after(() => busy.close());
  const L = await lab(t, { portStart: start });
  const r = await L.run([...BASE_ARGS, "--dry-run"]);
  assert.equal(r.code, 0, r.out); assert.match(r.out, new RegExp(`Port local du site : ${start + 1}\\b`));
  const r2 = await L.run([...BASE_ARGS, "--dry-run", "--port", String(start)]);
  assert.equal(r2.code, 1); assert.match(r2.out, /déjà utilisé/);
});

test("installation complète sans domaine : site installé, .env privé sans affichage du code, unité systemd propre, HTTP 200 en local", async (t) => {
  const L = await lab(t);
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 0, r.out);
  const dir = path.join(L.root, "var/www/monsite");
  const env = fs.readFileSync(path.join(dir, ".env"), "utf8");
  assert.equal(fs.statSync(path.join(dir, ".env")).mode & 0o777, 0o600);
  assert.match(env, /^SITE_URL="http:\/\/localhost:\d+"$/m);
  assert.match(env, /^CURIOSA_SUPERVISED=1$/m);
  const token = tokenOf(L); assert.match(token, /^[0-9a-f]{32}$/);
  assert.ok(!r.out.includes(token), "le code d'installation n'apparaît dans AUCUNE sortie du script");
  assert.ok(!fs.readFileSync(path.join(L.root, "var/log/curiosa-install-monsite.log"), "utf8").includes(token), "ni dans le journal");
  assert.match(r.out, /sed -n 's\/\^SETUP_TOKEN=\/\/p' \/var\/www\/monsite\/\.env/, "mais la commande pour le lire soi-même est donnée");
  assert.match(r.out, /\/admin\/setup/);
  assert.ok(fs.existsSync(path.join(dir, "data/curiosa.db")), "migration exécutée");
  assert.ok(fs.existsSync(path.join(dir, ".install-curiosa")));
  const unit = fs.readFileSync(path.join(L.root, "etc/systemd/system/monsite.service"), "utf8");
  assert.match(unit, /^ExecStart=\/\S*\/node node_modules\/next\/dist\/bin\/next start -H 127\.0\.0\.1 -p \d+$/m);
  assert.ok(!/npx/.test(unit)); assert.match(unit, /^User=monsite-web$/m); assert.match(unit, /^WorkingDirectory=\/var\/www\/monsite$/m);
  assert.match(fs.readFileSync(path.join(L.root, ".users"), "utf8"), /^monsite-web:\/var\/www\/monsite$/m, "home = dossier d'installation");
  assert.match(r.out, /HTTP 200/);
});

test("installation avec domaine et nginx déjà là : on AJOUTE un site (ancienne conf intacte), nginx -t avant rechargement, SITE_URL https sans / final", async (t) => {
  const L = await lab(t);
  const av = path.join(L.root, "etc/nginx/sites-available"); fs.mkdirSync(av, { recursive: true }); fs.mkdirSync(path.join(L.root, "etc/nginx/sites-enabled"));
  fs.writeFileSync(path.join(av, "autre.conf"), "server { server_name autre.example.org; }\n");
  const port = await freePort();
  const r = await L.run(["--site", "monsite", "--domain", "Monsite.Example.org", "--yes", "--port", String(port)], { FAKE_ACTIVE: "nginx", CURIOSA_VERIFY_URL: `http://127.0.0.1:${port}/admin/setup` });
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(av, "autre.conf"), "utf8"), "server { server_name autre.example.org; }\n", "l'existant n'est pas touché");
  const conf = fs.readFileSync(path.join(av, "monsite.conf"), "utf8");
  assert.match(conf, /server_name monsite\.example\.org;/); assert.match(conf, new RegExp(`proxy_pass http://127\\.0\\.0\\.1:${port};`));
  assert.ok(fs.lstatSync(path.join(L.root, "etc/nginx/sites-enabled/monsite.conf")).isSymbolicLink());
  assert.match(fs.readFileSync(path.join(L.root, "var/www/monsite/.env"), "utf8"), /^SITE_URL="https:\/\/monsite\.example\.org"$/m);
  assert.match(fs.readFileSync(path.join(L.root, ".systemctl/calls"), "utf8"), /^reload nginx$/m);
  assert.match(r.out, /certbot/, "nginx : la commande du certificat est indiquée");
});

test("nginx refuse la configuration : elle est retirée, l'existant intact, arrêt avec remède", async (t) => {
  const L = await lab(t);
  const av = path.join(L.root, "etc/nginx/sites-available"); fs.mkdirSync(av, { recursive: true }); fs.mkdirSync(path.join(L.root, "etc/nginx/sites-enabled"));
  fs.writeFileSync(path.join(av, "autre.conf"), "A\n");
  const r = await L.run(["--site", "monsite", "--domain", "monsite.example.org", "--yes"], { FAKE_ACTIVE: "nginx", FAKE_NGINX_FAIL: "1" });
  assert.equal(r.code, 1); assert.match(r.out, /nginx -t a échoué/); assert.match(r.out, /--skip-proxy/);
  assert.ok(!fs.existsSync(path.join(av, "monsite.conf"))); assert.equal(fs.readFileSync(path.join(av, "autre.conf"), "utf8"), "A\n");
  assert.ok(!fs.readFileSync(path.join(L.root, ".systemctl/calls"), "utf8").includes("reload nginx"));
});

test("domaine déjà géré par nginx : on n'y touche pas et on le dit", async (t) => {
  const L = await lab(t);
  const av = path.join(L.root, "etc/nginx/sites-available"); fs.mkdirSync(av, { recursive: true });
  fs.writeFileSync(path.join(av, "ancien.conf"), "server { server_name monsite.example.org; }\n");
  const port = await freePort();
  const r = await L.run(["--site", "monsite", "--domain", "monsite.example.org", "--yes", "--port", String(port)], { FAKE_ACTIVE: "nginx" });
  assert.equal(r.code, 10, r.out); assert.match(r.out, /nginx gère déjà monsite\.example\.org/);
  assert.equal(fs.readFileSync(path.join(av, "ancien.conf"), "utf8"), "server { server_name monsite.example.org; }\n");
  assert.ok(!fs.existsSync(path.join(av, "monsite.conf")));
});

test("DNS qui ne pointe pas ici : arrêt AVANT toute modification avec le remède ; --skip-dns-check permet de continuer", async (t) => {
  const L = await lab(t); const before = L.snapshot();
  const args = ["--site", "monsite", "--domain", "monsite.example.org", "--yes", "--skip-proxy"];
  for (const ip of ["198.51.100.9", "none"]) {
    const r = await L.run(args, { CURIOSA_DOMAIN_IP: ip });
    assert.equal(r.code, 1, r.out); assert.match(r.out, /enregistrement A|DNS/); assert.match(r.out, /203\.0\.113\.7/);
    assert.deepEqual(L.snapshot(), before);
  }
  const ok = await L.run([...args, "--skip-dns-check"], { CURIOSA_DOMAIN_IP: "198.51.100.9" });
  assert.equal(ok.code, 0, ok.out);
});

test("reprise : un échec au démarrage du service, puis la même commande reprend sans retélécharger et sans changer le code d'installation", async (t) => {
  const L = await lab(t);
  const bad = await L.run([...BASE_ARGS, "--yes"], { FAKE_ENABLE_FAIL: "1" });
  assert.equal(bad.code, 1); assert.match(bad.out, /service n'a pas pu démarrer/); assert.match(bad.out, /relancez la même commande|Que faire/);
  assert.equal(L.gh.hits.downloads, 1);
  const envPath = path.join(L.root, "var/www/monsite/.env"); const token = tokenOf(L); const envBefore = fs.readFileSync(envPath, "utf8");
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /la reprends/);
  assert.equal(L.gh.hits.downloads, 1, "pas de nouveau téléchargement");
  assert.equal(fs.readFileSync(envPath, "utf8"), envBefore); assert.equal(tokenOf(L), token);
  assert.equal(fs.readFileSync(path.join(L.root, ".users"), "utf8").trim().split("\n").length, 1, "utilisateur créé une seule fois");
});

test("idempotence : relancer une installation terminée ne casse rien (même .env, même unité, même port)", async (t) => {
  const L = await lab(t);
  assert.equal((await L.run([...BASE_ARGS, "--yes"])).code, 0);
  const dir = path.join(L.root, "var/www/monsite"); const unitPath = path.join(L.root, "etc/systemd/system/monsite.service");
  const snap = [fs.readFileSync(path.join(dir, ".env"), "utf8"), fs.readFileSync(unitPath, "utf8")];
  const r = await L.run([...BASE_ARGS, "--yes"]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([fs.readFileSync(path.join(dir, ".env"), "utf8"), fs.readFileSync(unitPath, "utf8")], snap);
});

test("un autre site refuse d'écraser le dossier ou le service d'un premier", async (t) => {
  const L = await lab(t);
  assert.equal((await L.run([...BASE_ARGS, "--yes"])).code, 0);
  const r = await L.run(["--site", "autre", "--no-domain", "--yes", "--dir", "/var/www/monsite"]);
  assert.equal(r.code, 1); assert.match(r.out, /autre installation/);
  const r2 = await L.run(["--site", "autre", "--no-domain", "--yes", "--user", "monsite-web"]);
  assert.equal(r2.code, 1); assert.match(r2.out, /existe déjà/);
});

test("--uninstall : arrête le site, retire le service et la config ajoutée, GARDE le dossier et les données ; --purge exige un terminal", async (t) => {
  const L = await lab(t);
  const av = path.join(L.root, "etc/nginx/sites-available"); fs.mkdirSync(av, { recursive: true }); fs.mkdirSync(path.join(L.root, "etc/nginx/sites-enabled"));
  fs.writeFileSync(path.join(av, "autre.conf"), "A\n");
  const port = await freePort();
  assert.equal((await L.run(["--site", "monsite", "--domain", "monsite.example.org", "--yes", "--port", String(port)], { FAKE_ACTIVE: "nginx", CURIOSA_VERIFY_URL: `http://127.0.0.1:${port}/admin/setup` })).code, 0);
  const r = await L.run(["--uninstall", "--site", "monsite"], { FAKE_ACTIVE: "nginx" });
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(path.join(L.root, "etc/systemd/system/monsite.service")));
  assert.ok(!fs.existsSync(path.join(av, "monsite.conf")));
  assert.equal(fs.readFileSync(path.join(av, "autre.conf"), "utf8"), "A\n");
  assert.ok(fs.existsSync(path.join(L.root, "var/www/monsite/data/curiosa.db")), "les données sont conservées");
  const p = await L.run(["--uninstall", "--purge", "--site", "monsite", "--yes"]);
  assert.equal(p.code, 1); assert.match(p.out, /terminal/);
  assert.ok(fs.existsSync(path.join(L.root, "var/www/monsite/data/curiosa.db")), "rien n'est supprimé sans confirmation tapée");
  const none = await L.run(["--uninstall", "--site", "inconnu"]);
  assert.equal(none.code, 1);
});
