import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const V = await import("@/core/updates/versions");
const { runUpdate, readState, resolveSqlitePath, safeEntry } = await import("../../scripts/update-lib.mjs");
const sh = promisify(execFile);

test("versions : étiquettes stables seulement, comparaison numérique (1.10 > 1.9)", () => {
  assert.deepEqual(V.parseVersion("v1.2.3"), [1, 2, 3, Infinity]);
  assert.deepEqual(V.parseVersion("10.0.1"), [10, 0, 1, Infinity]);
  for (const bad of ["1.2", "v1.2.3-beta", "latest", "1.2.3.4", "", "v1.2.x", "../v1.0.0", "v1.0.0;rm"]) assert.equal(V.parseVersion(bad), null, bad);
  assert.equal(V.compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(V.compareVersions("v2.0.0", "2.0.0"), 0);
  assert.equal(V.compareVersions("0.9.0", "v0.10.0"), -1);
  assert.throws(() => V.compareVersions("x", "1.0.0"));
});

test("versions : nature de la mise à jour — patch, minor, major ; rien si la cible n'est pas plus récente", () => {
  assert.equal(V.classify("1.2.3", "v1.2.4"), "patch");
  assert.equal(V.classify("1.2.3", "v1.3.0"), "minor");
  assert.equal(V.classify("1.2.3", "v2.0.0"), "major");
  assert.equal(V.classify("1.2.3", "v1.2.3"), null);
  assert.equal(V.classify("1.2.3", "v1.0.0"), null);
  assert.equal(V.classify("pas une version", "v1.0.0"), null);
});

test("versions : la plus haute version stable parmi les releases qui ont leur archive — brouillons, pré-versions et releases sans archive ignorés", () => {
  const asset = (tag) => `curiosa-${tag}-linux-x64.tar.gz`;
  const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: asset(tag) }], ...extra });
  const list = [rel("v1.0.0"), rel("v1.10.0"), rel("v1.9.9"), rel("v2.0.0", { draft: true }), rel("v2.0.1", { prerelease: true }), rel("v3.0.0", { assets: [] }), rel("v2.0.0-beta.1"), rel("nightly"), null, { tag_name: 5 }];
  assert.equal(V.pickLatestRelease(list, asset), "v1.10.0");
  assert.equal(V.pickLatestRelease([], asset), null);
  assert.equal(V.pickLatestRelease("pas une liste", asset), null);
  assert.equal(V.pickLatestRelease([rel("v1.0.0", { assets: [{ name: "curiosa-v1.0.0-darwin-arm64.tar.gz" }] })], asset), null, "archive d'une autre plateforme : rien à proposer");
});

test("versions : release candidates — ordre rc.1 < rc.2 < stable, canal « stable » les ignore, canal « rc » les propose", () => {
  assert.equal(V.compareVersions("1.2.0-rc.1", "1.2.0-rc.2"), -1);
  assert.equal(V.compareVersions("1.2.0-rc.10", "1.2.0-rc.9"), 1);
  assert.equal(V.compareVersions("1.2.0-rc.9", "1.2.0"), -1);
  assert.equal(V.compareVersions("1.1.9", "1.2.0-rc.1"), -1);
  assert.equal(V.parseVersion("v1.2.0-rc.1"), null, "une étiquette rc n'est pas une version stable");
  assert.equal(V.isPrerelease("v1.2.0-rc.1"), true);
  assert.equal(V.isPrerelease("v1.2.0"), false);
  for (const bad of ["v1.2.0-rc", "v1.2.0-rc.", "v1.2.0-beta.1", "v1.2.0-rc.1-x", "dev-20261007-abc1234"]) assert.equal(V.parseVersion(bad, true), null, bad);
  assert.equal(V.classify("1.1.0", "v1.2.0-rc.1"), "minor");
  assert.equal(V.classify("1.2.0-rc.1", "v1.2.0-rc.2"), "patch");
  assert.equal(V.classify("1.2.0-rc.2", "v1.2.0"), "patch", "la stable qui suit la rc");
  assert.equal(V.classify("1.2.0", "v1.2.0-rc.3"), null, "on ne « descend » jamais vers une rc");
  const asset = (tag) => `curiosa-${tag}-linux-x64.tar.gz`;
  const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: tag.includes("-rc."), assets: [{ name: asset(tag) }], ...extra });
  const list = [rel("v1.1.0"), rel("v1.2.0-rc.1"), rel("v1.2.0-rc.2"), rel("v1.3.0-rc.1", { draft: true }), rel("dev-20261007-abc1234", { prerelease: true }), rel("v1.4.0-rc.1", { assets: [] })];
  assert.equal(V.pickLatestRelease(list, asset), "v1.1.0");
  assert.equal(V.pickLatestRelease(list, asset, "rc"), "v1.2.0-rc.2");
  assert.equal(V.pickLatestRelease([...list, rel("v1.2.0")], asset, "rc"), "v1.2.0", "la stable l'emporte sur ses rc");
});

test("versions : modules git — la plus haute version stable d'un `git ls-remote --tags`", () => {
  const out = ["aaa\trefs/tags/v1.0.0", "bbb\trefs/tags/v1.2.0", "ccc\trefs/tags/v1.2.0^{}", "ddd\trefs/tags/v1.10.0", "eee\trefs/tags/v2.0.0-beta.1", "fff\trefs/tags/nightly", "hhh\trefs/heads/main", ""].join("\n");
  assert.equal(V.pickLatestTag(out), "v1.10.0");
  assert.equal(V.pickLatestTag(""), null);
});

test("base : chemin SQLite — absolu tel quel, relatif résolu depuis prisma/ comme le fait Prisma, autre fournisseur ignoré", () => {
  assert.equal(resolveSqlitePath("file:/var/lib/app/db.sqlite", "/srv/app"), "/var/lib/app/db.sqlite");
  assert.equal(resolveSqlitePath("file:../data/app.db", "/srv/app"), "/srv/app/data/app.db");
  assert.equal(resolveSqlitePath("file:./dev.db?connection_limit=1", "/srv/app"), "/srv/app/prisma/dev.db");
  assert.equal(resolveSqlitePath("postgresql://x", "/srv/app"), null);
  assert.equal(resolveSqlitePath(undefined, "/srv/app"), null);
});

/* ───────────── Installation réelle : archives compilées, vrai tar, vraie empreinte ───────────── */

const PLATFORM = `${process.platform}-${process.arch}`;
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** Une « release » : un dossier de fichiers + release.json, empaqueté en .tar.gz avec son .sha256, comme le fait la CI. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-upd-"));
  const hosted = path.join(root, "hosted"); // ce que « GitHub » sert
  fs.mkdirSync(hosted);
  const build = (version, { files = {}, paths, platform = PLATFORM, badSum = false } = {}) => {
    const dir = path.join(root, `build-${version}`);
    fs.mkdirSync(path.join(dir, ".next"), { recursive: true });
    fs.mkdirSync(path.join(dir, "prisma", "migrations"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "curiosa", version }));
    fs.writeFileSync(path.join(dir, ".next", "BUILD_ID"), `build-${version}`);
    fs.writeFileSync(path.join(dir, "prisma", "migrations", "001.sql"), `migration-${version}`);
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
    const all = paths ?? [".next", "package.json", "prisma/migrations", "release.json"];
    fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify({ name: "curiosa", version, platform, repo: "owner/curiosa", paths: all }));
    const name = `curiosa-v${version}-${PLATFORM}.tar.gz`;
    execFileSync("tar", ["-czf", path.join(hosted, name), "-C", dir, ...all.filter((p) => fs.existsSync(path.join(dir, p)))]);
    fs.writeFileSync(path.join(hosted, `${name}.sha256`), `${badSum ? "0".repeat(64) : sha(path.join(hosted, name))}  ${name}\n`);
  };
  const app = path.join(root, "app");
  fs.mkdirSync(path.join(app, ".next"), { recursive: true });
  fs.mkdirSync(path.join(app, "prisma", "migrations"), { recursive: true });
  fs.mkdirSync(path.join(app, "prisma", "data"), { recursive: true });
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "curiosa", version: "1.0.0" }));
  fs.writeFileSync(path.join(app, ".next", "BUILD_ID"), "build-1.0.0");
  fs.writeFileSync(path.join(app, "prisma", "migrations", "001.sql"), "migration-1.0.0");
  fs.writeFileSync(path.join(app, "prisma", "data", "garde.txt"), "données");
  fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ name: "curiosa", version: "1.0.0", platform: PLATFORM, repo: "owner/curiosa", paths: [".next", "package.json", "prisma/migrations", "release.json"] }));
  fs.writeFileSync(path.join(app, ".env"), "SECRET=1");
  const dataDir = path.join(app, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, "site.db");
  fs.writeFileSync(dbFile, "DONNEES-AVANT");
  fs.writeFileSync(path.join(dataDir, "upload.png"), "image");
  build("1.0.0");
  const calls = [], downloads = [];
  // tar est réel ; prisma et le redémarrage sont simulés (on enregistre l'ordre) — `fail` fait échouer une commande précise.
  const make = ({ fail = null, mutateDb = false, always = false } = {}) => {
    let failed = false;
    return async (cmd, args, opts = {}) => {
      const line = `${cmd} ${args.join(" ")}`;
      if (cmd === "tar") return { stdout: execFileSync("tar", args, { cwd: opts.cwd }).toString() };
      calls.push(line);
      if (fail && line.includes(fail) && (always || !failed)) { failed = true; throw new Error(`échec simulé : ${line}`); }
      if (mutateDb && line.includes("migrate deploy")) fs.writeFileSync(dbFile, "DONNEES-APRES-MIGRATION");
      return { stdout: "ok" };
    };
  };
  const download = async (url, dest) => {
    downloads.push(url);
    const f = path.join(hosted, path.basename(url));
    if (!fs.existsSync(f)) throw new Error("404");
    fs.copyFileSync(f, dest);
  };
  const buildId = () => fs.readFileSync(path.join(app, ".next", "BUILD_ID"), "utf8");
  return { root, app, dataDir, dbFile, calls, downloads, build, make, download, buildId, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const opts = (s, over = {}) => ({ appDir: s.app, dataDir: s.dataDir, databaseUrl: `file:${s.dbFile}`, download: s.download, ...over });

test("mise à jour : succès — sauvegarde, téléchargement, empreinte, bascule, migrations, redémarrage ; aucune compilation ni git", async () => {
  const s = setup(); try {
    s.build("1.1.0", { files: { "modules-community/x.txt": "nouveau" }, paths: [".next", "package.json", "prisma/migrations", "release.json", "modules-community"] });
    const restarts = [];
    const exec = async (cmd, args, o) => { if (cmd === "sh") { restarts.push(args[1]); return { stdout: "" }; } return s.make()(cmd, args, o); };
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec, restartCommand: "systemctl restart curiosa" });
    assert.deepEqual(r, { ok: true });
    assert.equal(s.buildId(), "build-1.1.0", "le build livré est en place");
    assert.equal(fs.readFileSync(path.join(s.app, "modules-community", "x.txt"), "utf8"), "nouveau");
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.app, "package.json"), "utf8")).version, "1.1.0");
    assert.deepEqual(s.calls, ["npx prisma migrate deploy"], "rien d'autre : ni npm ci, ni build, ni git");
    assert.deepEqual(s.downloads, ["https://github.com/owner/curiosa/releases/download/v1.1.0/curiosa-v1.1.0-" + PLATFORM + ".tar.gz", "https://github.com/owner/curiosa/releases/download/v1.1.0/curiosa-v1.1.0-" + PLATFORM + ".tar.gz.sha256"]);
    assert.deepEqual(restarts, ["systemctl restart curiosa"]);
    const st = readState(s.dataDir);
    assert.deepEqual([st.status, st.target, st.restart, st.error, st.rolledBack], ["success", "v1.1.0", "command", null, false]);
    const backups = fs.readdirSync(path.join(s.dataDir, "backups"));
    assert.equal(fs.readFileSync(path.join(s.dataDir, "backups", backups[0]), "utf8"), "DONNEES-AVANT", "sauvegarde faite AVANT les migrations");
    for (const left of [".curiosa-staging", ".curiosa-previous"]) assert.ok(!fs.existsSync(path.join(s.app, left)), `${left} nettoyé`);
    assert.match(fs.readFileSync(path.join(s.dataDir, "update", "update.log"), "utf8"), /v1\.1\.0 installée/);
  } finally { s.cleanup(); }
});

test("mise à jour : une release candidate s'installe comme une stable (archive vX.Y.Z-rc.N, version cohérente)", async () => {
  const s = setup(); try {
    s.build("1.1.0-rc.1");
    assert.deepEqual(await runUpdate({ ...opts(s), tag: "v1.1.0-rc.1", exec: s.make() }), { ok: true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.app, "package.json"), "utf8")).version, "1.1.0-rc.1");
  } finally { s.cleanup(); }
});

test("mise à jour : les données de l'exploitant (.env, data/, prisma/data) ne sont jamais touchées", async () => {
  const s = setup(); try {
    s.build("1.1.0");
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() })).ok, true);
    assert.equal(fs.readFileSync(path.join(s.app, ".env"), "utf8"), "SECRET=1");
    assert.equal(fs.readFileSync(path.join(s.dataDir, "upload.png"), "utf8"), "image");
    assert.equal(fs.readFileSync(path.join(s.app, "prisma", "data", "garde.txt"), "utf8"), "données");
  } finally { s.cleanup(); }
});

test("mise à jour : sans commande de redémarrage ni superviseur, elle le dit — le site n'est jamais coupé d'office", async () => {
  const s = setup(); try {
    s.build("1.0.1");
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.0.1", exec: s.make() })).ok, true);
    assert.equal(readState(s.dataDir).restart, "needed");
  } finally { s.cleanup(); }
});

test("mise à jour : échec des migrations → anciens dossiers rétablis, base sauvegardée restaurée, redémarrage demandé", async () => {
  const s = setup(); try {
    s.build("1.1.0");
    const exec = async (cmd, args, o) => {
      if (`${cmd} ${args.join(" ")}`.includes("migrate deploy")) { fs.writeFileSync(s.dbFile, "BASE-A-MOITIE-MIGREE"); throw new Error("migration cassée"); }
      return s.make()(cmd, args, o);
    };
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec });
    assert.deepEqual(r, { ok: false, error: "step-failed:migrate" });
    assert.equal(s.buildId(), "build-1.0.0", "build précédent rétabli");
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.app, "package.json"), "utf8")).version, "1.0.0");
    assert.equal(fs.readFileSync(path.join(s.app, "prisma", "migrations", "001.sql"), "utf8"), "migration-1.0.0");
    assert.equal(fs.readFileSync(s.dbFile, "utf8"), "DONNEES-AVANT", "base d'avant la mise à jour");
    const st = readState(s.dataDir);
    assert.deepEqual([st.status, st.rolledBack, st.restart], ["failed", true, "needed"]);
    for (const left of [".curiosa-staging", ".curiosa-previous"]) assert.ok(!fs.existsSync(path.join(s.app, left)), `${left} nettoyé`);
  } finally { s.cleanup(); }
});

test("mise à jour : archive introuvable ou réseau en panne → rien n'est modifié", async () => {
  const s = setup(); try {
    assert.deepEqual(await runUpdate({ ...opts(s), tag: "v9.9.9", exec: s.make() }), { ok: false, error: "step-failed:download" });
    assert.equal(s.buildId(), "build-1.0.0");
    assert.deepEqual(s.calls, []);
    assert.equal(readState(s.dataDir).rolledBack, false, "rien à annuler : la bascule n'a pas eu lieu");
    assert.ok(!fs.existsSync(path.join(s.app, ".curiosa-staging")));
  } finally { s.cleanup(); }
});

test("mise à jour : empreinte différente de celle publiée → refus net avant d'extraire quoi que ce soit", async () => {
  const s = setup(); try {
    s.build("1.1.0", { badSum: true });
    assert.deepEqual(await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() }), { ok: false, error: "checksum-mismatch" });
    assert.equal(s.buildId(), "build-1.0.0");
    assert.deepEqual(s.calls, []);
  } finally { s.cleanup(); }
});

test("mise à jour : archive de la mauvaise plateforme ou d'une autre version, ou listant un chemin protégé → refusée", async () => {
  for (const [label, build] of [
    ["plateforme", { platform: "darwin-arm64" }],
    ["chemin protégé", { files: { "data/x": "x" }, paths: [".next", "package.json", "prisma/migrations", "release.json", "data"] }],
    ["sortie du dossier", { paths: [".next", "package.json", "../evil", "release.json"] }],
    ["données prisma", { files: { "prisma/data/x": "x" }, paths: [".next", "package.json", "prisma/data", "release.json"] }],
  ]) {
    const s = setup(); try {
      s.build("1.1.0", build);
      const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() });
      assert.deepEqual(r, { ok: false, error: "bad-archive" }, label);
      assert.equal(s.buildId(), "build-1.0.0", label);
      assert.equal(fs.readFileSync(path.join(s.app, "prisma", "data", "garde.txt"), "utf8"), "données", label);
    } finally { s.cleanup(); }
  }
  const s = setup(); try {
    s.build("1.1.0"); fs.copyFileSync(path.join(s.root, "hosted", `curiosa-v1.1.0-${PLATFORM}.tar.gz`), path.join(s.root, "hosted", `curiosa-v1.2.0-${PLATFORM}.tar.gz`));
    fs.writeFileSync(path.join(s.root, "hosted", `curiosa-v1.2.0-${PLATFORM}.tar.gz.sha256`), `${sha(path.join(s.root, "hosted", `curiosa-v1.2.0-${PLATFORM}.tar.gz`))}  x\n`);
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.2.0", exec: s.make() })).error, "bad-archive", "l'archive dit 1.1.0 alors qu'on a demandé 1.2.0");
  } finally { s.cleanup(); }
});

test("mise à jour : installation sans release.json (clone git de développement) → refus net, rien n'est touché", async () => {
  const s = setup(); try {
    fs.rmSync(path.join(s.app, "release.json"));
    s.build("1.1.0");
    assert.deepEqual(await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() }), { ok: false, error: "not-a-release-install" });
    assert.deepEqual(s.calls, []);
    assert.ok(!fs.existsSync(path.join(s.dataDir, "backups")), "pas même de sauvegarde");
  } finally { s.cleanup(); }
});

test("mise à jour : valeur de version ou de dépôt dangereuse refusée avant toute commande", async () => {
  const s = setup(); try {
    for (const tag of ["main", "v1.0.0; rm -rf /", "--upload-pack=x", "../x", "v1.0", ""]) {
      const r = await runUpdate({ ...opts(s), tag, exec: s.make() });
      assert.deepEqual(r, { ok: false, error: "invalid-tag" }, JSON.stringify(tag));
    }
    s.build("1.1.0");
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", repo: "a/b/../c", exec: s.make() })).error, "no-release-source");
    assert.deepEqual(s.calls, []);
    assert.deepEqual(s.downloads, []);
  } finally { s.cleanup(); }
});

test("mise à jour : une seule à la fois (verrou), mais un verrou périmé ne bloque pas", async () => {
  const s = setup(); try {
    s.build("1.1.0");
    fs.mkdirSync(path.join(s.dataDir, "update"), { recursive: true });
    const lock = (startedAt) => fs.writeFileSync(path.join(s.dataDir, "update", "state.json"), JSON.stringify({ status: "running", startedAt }));
    lock(Date.now());
    assert.deepEqual(await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() }), { ok: false, error: "already-running" });
    lock(Date.now() - 2 * 3_600_000);
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() })).ok, true, "verrou vieux de 2 h : processus mort, on reprend");
  } finally { s.cleanup(); }
});

test("sauvegardes : on garde les 5 dernières seulement", async () => {
  const s = setup(); try {
    const backups = path.join(s.dataDir, "backups");
    fs.mkdirSync(backups, { recursive: true });
    for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(backups, `pre-update-v0.0.${i}-${1000 + i}.db`), "x");
    fs.writeFileSync(path.join(backups, "autre-fichier.db"), "à ne pas toucher");
    s.build("1.0.1");
    await runUpdate({ ...opts(s), tag: "v1.0.1", exec: s.make() });
    const left = fs.readdirSync(backups).filter((f) => f.startsWith("pre-update-"));
    assert.equal(left.length, 5);
    assert.ok(fs.existsSync(path.join(backups, "autre-fichier.db")));
  } finally { s.cleanup(); }
});

test("redémarrage supervisé : le serveur est arrêté par signal pour que le superviseur le relance", async () => {
  const s = setup(); try {
    s.build("1.0.1");
    const child = (await import("node:child_process")).spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    const exited = new Promise((res) => child.on("exit", (code, signal) => res(signal)));
    await runUpdate({ ...opts(s), tag: "v1.0.1", exec: s.make(), supervised: true, serverPid: child.pid });
    assert.equal(await exited, "SIGTERM");
    assert.equal(readState(s.dataDir).restart, "signal");
  } finally { s.cleanup(); }
});

test("entrées d'archive : chemins absolus, `..` ou caractères de contrôle refusés", () => {
  for (const ok of [".next/BUILD_ID", "./package.json", "node_modules/.bin/next"]) assert.equal(safeEntry(ok), true, ok);
  for (const bad of ["/etc/passwd", "../x", "a/../../x", "", "a\nb"]) assert.equal(safeEntry(bad), false, JSON.stringify(bad));
});

test("le script en ligne de commande : https seulement, taille bornée, aucun shell (execFile)", () => {
  const cli = fs.readFileSync("scripts/update.mjs", "utf8");
  assert.ok(cli.includes("execFile") && !/\bexec\(|execSync|shell:\s*true/.test(cli.replace(/promisify\(execFile\)/, "")));
  assert.ok(cli.includes("https requis"));
  assert.match(cli, /MAX_BYTES/);
  assert.ok(sh);
});

test("empaquetage : release-pack refuse une version qui ne correspond pas à package.json et exclut les données de l'exploitant", () => {
  const src = fs.readFileSync("scripts/release-pack.mjs", "utf8");
  assert.match(src, /pkg\.version !== version/);
  assert.ok(!/["']data["']|\.env["'],|prisma\/data/.test(src.split("const PATHS")[1].split("].filter")[0]), "ni data/, ni .env, ni prisma/data dans l'archive");
});

test("empaquetage : le moteur de base de données est livré pour OpenSSL 1.1 (Ubuntu 20.04, Debian ≤ 11) ET 3.0 — une archive compilée une fois doit tourner partout", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /binaryTargets\s*=\s*\[[^\]]*"debian-openssl-1\.1\.x"[^\]]*"debian-openssl-3\.0\.x"|binaryTargets\s*=\s*\[[^\]]*"debian-openssl-3\.0\.x"[^\]]*"debian-openssl-1\.1\.x"/);
  const pack = fs.readFileSync("scripts/release-pack.mjs", "utf8");
  assert.ok(pack.includes("debian-openssl-1.1.x") && pack.includes("debian-openssl-3.0.x"));
});
