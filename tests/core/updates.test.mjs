import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const V = await import("@/core/updates/versions");
const { runUpdate, readState, resolveSqlitePath, depsFingerprint } = await import("../../scripts/update-lib.mjs");
const sh = promisify(execFile);

test("versions : étiquettes stables seulement, comparaison numérique (1.10 > 1.9)", () => {
  assert.deepEqual(V.parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(V.parseVersion("10.0.1"), [10, 0, 1]);
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

test("versions : la plus haute version stable d'un `git ls-remote --tags`, pré-versions et étiquettes annotées comprises", () => {
  const out = [
    "aaa\trefs/tags/v1.0.0", "bbb\trefs/tags/v1.2.0", "ccc\trefs/tags/v1.2.0^{}", "ddd\trefs/tags/v1.10.0", "eee\trefs/tags/v2.0.0-beta.1",
    "fff\trefs/tags/nightly", "ggg\trefs/tags/v1.9.9", "hhh\trefs/heads/main", "",
  ].join("\n");
  assert.equal(V.pickLatestTag(out), "v1.10.0");
  assert.equal(V.pickLatestTag(""), null);
  assert.equal(V.pickLatestTag("aaa\trefs/tags/v2.0.0-rc1\nbbb\trefs/tags/foo"), null);
});

test("base : chemin SQLite — absolu tel quel, relatif résolu depuis prisma/ comme le fait Prisma, autre fournisseur ignoré", () => {
  assert.equal(resolveSqlitePath("file:/var/lib/app/db.sqlite", "/srv/app"), "/var/lib/app/db.sqlite");
  assert.equal(resolveSqlitePath("file:../data/app.db", "/srv/app"), "/srv/app/data/app.db");
  assert.equal(resolveSqlitePath("file:./dev.db?connection_limit=1", "/srv/app"), "/srv/app/prisma/dev.db");
  assert.equal(resolveSqlitePath("postgresql://x", "/srv/app"), null);
  assert.equal(resolveSqlitePath(undefined, "/srv/app"), null);
});

/* ───────────── Installation réelle : amont git avec versions, copie « installée » ───────────── */

function git(cwd, ...args) { return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" }).toString().trim(); }

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-upd-"));
  const upstream = path.join(root, "upstream");
  fs.mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(upstream, ".gitignore"), "data/\n.env\nnode_modules/\n");
  const release = (version, extra = {}) => {
    const deps = extra.deps ?? { next: "1.0.0" };
    delete extra.deps;
    fs.writeFileSync(path.join(upstream, "package.json"), JSON.stringify({ name: "vitrine", version, dependencies: deps }));
    fs.writeFileSync(path.join(upstream, "package-lock.json"), JSON.stringify({ name: "vitrine", version, lockfileVersion: 3, packages: { "": { name: "vitrine", version, dependencies: deps }, ...Object.fromEntries(Object.entries(deps).map(([k, v]) => [`node_modules/${k}`, { version: v }])) } }));
    for (const [f, c] of Object.entries(extra)) fs.writeFileSync(path.join(upstream, f), c);
    git(upstream, "add", "-A"); git(upstream, "commit", "-q", "-m", `v${version}`); git(upstream, "tag", `v${version}`);
  };
  release("1.0.0");
  const app = path.join(root, "app");
  git(root, "clone", "-q", upstream, app);
  const dataDir = path.join(app, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, "site.db");
  fs.writeFileSync(dbFile, "DONNEES-AVANT");
  const calls = [];
  // git est réel ; npm / prisma / build sont simulés (on enregistre l'ordre) — `fail` fait échouer une étape précise.
  const make = ({ fail = null, mutateDb = false, always = false } = {}) => {
    let failed = false;
    return async (cmd, args, opts = {}) => {
    const line = `${cmd} ${args.join(" ")}`;
    if (cmd === "git") return { stdout: git(opts.cwd, ...args) };
    calls.push(line);
    if (fail && line.includes(fail) && (always || !failed)) { failed = true; throw new Error(`échec simulé : ${line}`); }
    if (mutateDb && line.includes("migrate deploy")) fs.writeFileSync(dbFile, "DONNEES-APRES-MIGRATION");
    return { stdout: "ok" };
    };
  };
  return { root, upstream, app, dataDir, dbFile, calls, release, make, head: () => git(app, "rev-parse", "HEAD"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const opts = (s, over = {}) => ({ appDir: s.app, dataDir: s.dataDir, databaseUrl: `file:${s.dbFile}`, ...over });

test("mise à jour : succès — sauvegarde, version récupérée, dépendances, migrations, build, redémarrage demandé, dans cet ordre", async () => {
  const s = setup(); try {
    s.release("1.1.0", { "feature.txt": "nouveau" });
    const restarts = [];
    const exec = async (cmd, args, o) => { if (cmd === "sh") { restarts.push(args[1]); return { stdout: "" }; } return s.make()(cmd, args, o); };
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec, restartCommand: "systemctl restart vitrine" });
    assert.deepEqual(r, { ok: true });
    assert.equal(fs.readFileSync(path.join(s.app, "feature.txt"), "utf8"), "nouveau", "le code de la version est en place");
    assert.deepEqual(s.calls, ["npx prisma migrate deploy", "npm run build"], "dépendances inchangées : node_modules n'est pas touché");
    assert.deepEqual(restarts, ["systemctl restart vitrine"]);
    const st = readState(s.dataDir);
    assert.deepEqual([st.status, st.target, st.restart, st.error, st.rolledBack], ["success", "v1.1.0", "command", null, false]);
    const backups = fs.readdirSync(path.join(s.dataDir, "backups"));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(s.dataDir, "backups", backups[0]), "utf8"), "DONNEES-AVANT", "sauvegarde faite AVANT les migrations");
    assert.match(fs.readFileSync(path.join(s.dataDir, "update", "update.log"), "utf8"), /v1\.1\.0 installée/);
  } finally { s.cleanup(); }
});

test("mise à jour : sans commande de redémarrage ni superviseur, elle le dit — le site n'est jamais coupé d'office", async () => {
  const s = setup(); try {
    s.release("1.0.1");
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.0.1", exec: s.make() })).ok, true);
    assert.equal(readState(s.dataDir).restart, "needed");
  } finally { s.cleanup(); }
});

test("mise à jour : échec du build → retour à la version précédente, base intacte, etat « failed » lisible", async () => {
  const s = setup(); try {
    const before = s.head();
    s.release("1.1.0");
    // le `release` ne touche pas la copie installée : elle est toujours sur 1.0.0
    assert.equal(s.head(), before);
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make({ fail: "run build" }) });
    assert.deepEqual(r, { ok: false, error: "step-failed:build" });
    assert.equal(s.head(), before, "code précédent rétabli");
    assert.equal(git(s.app, "symbolic-ref", "-q", "--short", "HEAD"), "main", "revenu sur sa branche");
    const st = readState(s.dataDir);
    assert.deepEqual([st.status, st.error, st.rolledBack], ["failed", "step-failed:build", true]);
    assert.ok(s.calls.filter((c) => c === "npm run build").length === 2, "le build précédent est refait pour que le site reste cohérent");
  } finally { s.cleanup(); }
});

test("mise à jour : si le retour arrière échoue lui aussi, l'état le dit honnêtement (rolledBack = false)", async () => {
  const s = setup(); try {
    s.release("1.1.0");
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make({ fail: "run build", always: true }) });
    assert.equal(r.ok, false);
    assert.equal(readState(s.dataDir).rolledBack, false);
  } finally { s.cleanup(); }
});

test("mise à jour : échec pendant les migrations → la base sauvegardée est restaurée et un redémarrage est demandé", async () => {
  const s = setup(); try {
    s.release("1.1.0");
    const exec = async (cmd, args, o) => {
      const line = `${cmd} ${args.join(" ")}`;
      if (line.includes("migrate deploy")) { fs.writeFileSync(s.dbFile, "BASE-A-MOITIE-MIGREE"); throw new Error("migration cassée"); }
      return s.make()(cmd, args, o);
    };
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec });
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(s.dbFile, "utf8"), "DONNEES-AVANT", "base d'avant la mise à jour");
    const st = readState(s.dataDir);
    assert.equal(st.rolledBack, true);
    assert.equal(st.restart, "needed", "le serveur en cours tient l'ancien fichier ouvert : il doit redémarrer");
  } finally { s.cleanup(); }
});

test("mise à jour : étiquette inconnue ou réseau en panne → rien n'est modifié", async () => {
  const s = setup(); try {
    const before = s.head();
    assert.deepEqual(await runUpdate({ ...opts(s), tag: "v9.9.9", exec: s.make() }), { ok: false, error: "unknown-tag" });
    assert.equal(s.head(), before);
    assert.deepEqual(s.calls, [], "aucune installation tentée");
    s.release("1.1.0");
    const exec = async (cmd, args, o) => { if (cmd === "git" && args[0] === "fetch") throw new Error("réseau"); return s.make()(cmd, args, o); };
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", exec })).error, "step-failed:fetch");
    assert.equal(s.head(), before);
    assert.equal(readState(s.dataDir).rolledBack, false, "rien à annuler : la bascule n'a pas eu lieu");
  } finally { s.cleanup(); }
});

test("mise à jour : modifications locales → refus net, rien n'est touché", async () => {
  const s = setup(); try {
    s.release("1.1.0");
    fs.writeFileSync(path.join(s.app, "package.json"), '{"name":"vitrine","version":"1.0.0","modifié":true}');
    const r = await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() });
    assert.deepEqual(r, { ok: false, error: "local-changes" });
    assert.deepEqual(s.calls, []);
    assert.ok(!fs.existsSync(path.join(s.dataDir, "backups")), "pas même de sauvegarde");
  } finally { s.cleanup(); }
});

test("mise à jour : les données (base, envois, .env) ne comptent pas comme des modifications locales", async () => {
  const s = setup(); try {
    s.release("1.1.0");
    fs.writeFileSync(path.join(s.app, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(s.dataDir, "uploads.txt"), "x");
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() })).ok, true);
    assert.equal(fs.readFileSync(path.join(s.app, ".env"), "utf8"), "SECRET=1", ".env conservé");
  } finally { s.cleanup(); }
});

test("mise à jour : valeur de version dangereuse refusée avant toute commande", async () => {
  const s = setup(); try {
    for (const tag of ["main", "v1.0.0; rm -rf /", "--upload-pack=x", "../x", "v1.0", ""]) {
      const r = await runUpdate({ ...opts(s), tag, exec: s.make() });
      assert.deepEqual(r, { ok: false, error: "invalid-tag" }, JSON.stringify(tag));
    }
    assert.deepEqual(s.calls, []);
  } finally { s.cleanup(); }
});

test("mise à jour : une seule à la fois (verrou), mais un verrou périmé ne bloque pas", async () => {
  const s = setup(); try {
    s.release("1.1.0");
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
    s.release("1.0.1");
    await runUpdate({ ...opts(s), tag: "v1.0.1", exec: s.make() });
    const left = fs.readdirSync(backups).filter((f) => f.startsWith("pre-update-"));
    assert.equal(left.length, 5);
    assert.ok(fs.existsSync(path.join(backups, "autre-fichier.db")));
  } finally { s.cleanup(); }
});

test("redémarrage supervisé : le serveur est arrêté par signal pour que le superviseur le relance", async () => {
  const s = setup(); try {
    s.release("1.0.1");
    const child = (await import("node:child_process")).spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    const exited = new Promise((res) => child.on("exit", (code, signal) => res(signal)));
    await runUpdate({ ...opts(s), tag: "v1.0.1", exec: s.make(), supervised: true, serverPid: child.pid });
    assert.equal(await exited, "SIGTERM");
    assert.equal(readState(s.dataDir).restart, "signal");
  } finally { s.cleanup(); }
});

test("le script en ligne de commande est présent et n'exécute que ce qu'il reçoit via exec (aucun shell sur la version)", () => {
  const cli = fs.readFileSync("scripts/update.mjs", "utf8");
  assert.ok(cli.includes("execFile") && !/\bexec\(|execSync|shell:\s*true/.test(cli.replace(/promisify\(execFile\)/, "")));
  assert.ok(sh);
});

test("dépendances : empreinte — le numéro de version du projet est ignoré, une dépendance modifiée ne l'est pas", () => {
  const pkg = (version, deps) => JSON.stringify({ name: "x", version, dependencies: deps });
  const lock = (version, deps) => JSON.stringify({ name: "x", version, packages: { "": { name: "x", version, dependencies: deps }, "node_modules/a": { version: deps.a } } });
  assert.equal(depsFingerprint(pkg("1.0.0", { a: "1" }), lock("1.0.0", { a: "1" })), depsFingerprint(pkg("1.0.1", { a: "1" }), lock("1.0.1", { a: "1" })));
  assert.notEqual(depsFingerprint(pkg("1.0.0", { a: "1" }), lock("1.0.0", { a: "1" })), depsFingerprint(pkg("1.0.0", { a: "2" }), lock("1.0.0", { a: "2" })));
  assert.equal(depsFingerprint("{pas du json", ""), null, "illisible → traité comme modifié");
});

test("mise à jour : dépendances modifiées → réinstallées (npm ci, generate) avant les migrations et le build", async () => {
  const s = setup(); try {
    s.release("1.1.0", { deps: { next: "2.0.0" } });
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() })).ok, true);
    assert.deepEqual(s.calls, ["npm ci --include=dev", "npx prisma generate", "npx prisma migrate deploy", "npm run build"]);
    assert.match(fs.readFileSync(path.join(s.dataDir, "update", "update.log"), "utf8"), /dépendances modifiées/);
  } finally { s.cleanup(); }
});

test("mise à jour : le schéma de base modifié → client régénéré même si les dépendances sont les mêmes", async () => {
  const s = setup(); try {
    fs.mkdirSync(path.join(s.upstream, "prisma")); fs.writeFileSync(path.join(s.upstream, "prisma", "schema.prisma"), "// v1");
    git(s.upstream, "add", "-A"); git(s.upstream, "commit", "-q", "-m", "schema"); git(s.upstream, "tag", "v1.0.5");
    git(s.app, "pull", "-q", "--ff-only"); // l'installation est à jour du schéma v1
    s.release("1.1.0", {}); fs.writeFileSync(path.join(s.upstream, "prisma", "schema.prisma"), "// v2"); git(s.upstream, "commit", "-qam", "schema v2"); git(s.upstream, "tag", "-f", "v1.1.0");
    assert.equal((await runUpdate({ ...opts(s), tag: "v1.1.0", exec: s.make() })).ok, true);
    assert.deepEqual(s.calls, ["npx prisma generate", "npx prisma migrate deploy", "npm run build"]);
  } finally { s.cleanup(); }
});
