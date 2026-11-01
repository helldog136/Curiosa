#!/usr/bin/env node
// Gestion du site de référence.
//   node scripts/visual/site.mjs prepare            clone/épingle les modules, migre, amorce, fige l'instantané (ROOT/snapshot)
//   node scripts/visual/site.mjs up <profil> [port] copie l'instantané, applique le profil, démarre `next start` (PID noté), attend /api/health
//   node scripts/visual/site.mjs down <profil>      arrête le serveur de ce profil PAR PID (et ses fils)
//   node scripts/visual/site.mjs status
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CORE_DIR, ROOT, EXTRAS_DIR, EXTRAS_URL, SNAPSHOT_DIR, PORT_BASE, PORT_MAX, FIXED_NOW, SEED, HERE } from "./config.mjs";
import { PROFILES } from "./profiles.mjs";
import { sh, start, stopPid, waitHttp, alive } from "./lib/proc.mjs";

const runDir = (profile) => `${ROOT}/run-${profile}`;
const portOf = (profile) => PORT_BASE + Object.keys(PROFILES).indexOf(profile);
const baseEnv = (dataDir, dbFile, port) => ({
  ...process.env,
  HOME: `${ROOT}/home`, TMPDIR: `${ROOT}/tmp`, NEXT_TELEMETRY_DISABLED: "1",
  DATA_DIR: dataDir, DATABASE_URL: `file:${dbFile}`,
  SITE_URL: `http://127.0.0.1:${port}`, AUTH_SECRET: "visual-harness-fixed-secret-not-for-production", AUTH_TRUST_HOST: "1",
  CURIOSA_ALLOW_LOCAL_MODULES: "1", CURIOSA_CATALOGUE_RUNTIME: "0", CURIOSA_CATALOGUE_REPO: "file:///nonexistent/curiosa-extras",
  VISUAL_NOW: FIXED_NOW, VISUAL_SEED: SEED, VISUAL_NET_LOG: `${dataDir}/../net-blocked.log`,
  NODE_OPTIONS: `--require ${path.join(HERE, "preload.cjs")} --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`,
});

function ensureDirs() { for (const d of [ROOT, `${ROOT}/home`, `${ROOT}/tmp`]) fs.mkdirSync(d, { recursive: true }); }

function ensureExtras() {
  if (!fs.existsSync(path.join(EXTRAS_DIR, "modules"))) sh("git", ["clone", "--no-hardlinks", EXTRAS_URL, EXTRAS_DIR], { stdio: "inherit" });
  return sh("git", ["-C", EXTRAS_DIR, "rev-parse", "HEAD"]).trim();
}

function coreCommit() { try { return sh("git", ["-C", CORE_DIR, "rev-parse", "HEAD"]).trim(); } catch { return "inconnu"; } }

function migrate(dbFile, env) {
  const clean = { ...env, DATABASE_URL: `file:${dbFile}` };
  delete clean.NODE_OPTIONS; // pas de préchargement (ni horloge figée ni réseau coupé) pour l'outil de migration
  return sh(path.join(CORE_DIR, "node_modules/.bin/prisma"), ["migrate", "deploy"], { cwd: CORE_DIR, env: clean });
}

async function prepare() {
  ensureDirs();
  ensureExtras();
  if (process.env.VISUAL_EXTRAS_REF) sh("git", ["-C", EXTRAS_DIR, "checkout", "--detach", process.env.VISUAL_EXTRAS_REF]);
  const extrasHead = sh("git", ["-C", EXTRAS_DIR, "rev-parse", "HEAD"]).trim();
  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  const data = `${SNAPSHOT_DIR}/data`;
  fs.mkdirSync(data, { recursive: true });
  const db = `${data}/curiosa.db`;
  const env = { ...baseEnv(data, db, PORT_BASE), VISUAL_EXTRAS: EXTRAS_DIR };
  console.log("migration de la base…");
  migrate(db, env);
  console.log("amorçage (tous les modules, contenu de démonstration)…");
  const out = sh("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./tests/helpers/register.mjs", "-r", path.join(HERE, "preload.cjs"), path.join(HERE, "seed/index.mjs")], { cwd: CORE_DIR, env, maxBuffer: 1 << 26 });
  console.log(out.trim().split("\n").slice(-3).join("\n"));
  // Le journal des appels réseau refusés pendant l'amorçage est conservé pour audit.
  const sha = crypto.createHash("sha256").update(fs.readFileSync(db)).digest("hex");
  fs.writeFileSync(`${SNAPSHOT_DIR}/snapshot.json`, JSON.stringify({ extrasCommit: extrasHead, preparedWith: coreCommit(), now: FIXED_NOW, seed: SEED, dbSha256: sha, extrasUrl: EXTRAS_URL }, null, 2));
  console.log("instantané :", SNAPSHOT_DIR, sha.slice(0, 12));
}

/** Copie le skin d'essai dans DATA_DIR/skins/<id>/<version>/ et rend la ligne `skin.installed` COMPLÈTE : l'empreinte vient du validateur du cœur (sans elle, le skin serait ignoré en silence).
 *  VISUAL_SKIN_IGNORE_MINCORE=1 (réglage de test) : le `minCore` de la COPIE est ramené à la version du cœur essayé, pour juger un skin écrit pour une version plus récente. */
function installSkinCopy(dir, p) {
  const dest = `${dir}/data/skins/${p.skinId}/${p.skinVersion}`;
  fs.cpSync(p.skinDir, dest, { recursive: true });
  const coreVersion = JSON.parse(fs.readFileSync(path.join(CORE_DIR, "package.json"), "utf8")).version;
  if (process.env.VISUAL_SKIN_IGNORE_MINCORE === "1") {
    const f = `${dest}/skin.json`;
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    if (m.minCore) { m.minCore = coreVersion; fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); }
  }
  const out = sh("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(CORE_DIR, "tests/helpers/register.mjs"), path.join(HERE, "skin-fingerprint.mjs"), dest, p.skinId, coreVersion], { cwd: CORE_DIR });
  const got = JSON.parse(String(out).trim().split("\n").pop());
  if (!got.ok) throw new Error(`le skin d'essai est refusé par le cœur ${coreVersion} :\n  ${got.issues.join("\n  ")}\n(minCore trop récent ? VISUAL_SKIN_IGNORE_MINCORE=1)`);
  return { id: p.skinId, version: p.skinVersion, repo: "", ref: null, subdir: null, source: "personal", commit: "", tree: null, fingerprint: got.fingerprint, installedAt: "2026-06-15T00:00:00.000Z" };
}

function applyProfile(dbFile, profile, skinRow = null) {
  const db = new DatabaseSync(dbFile);
  const put = db.prepare("INSERT INTO Setting (key, locale, value) VALUES (?, ?, ?) ON CONFLICT(key, locale) DO UPDATE SET value = excluded.value");
  const settings = { ...PROFILES[profile].settings };
  if (skinRow) settings["skin.installed"] = [skinRow];
  for (const [k, v] of Object.entries(settings)) {
    const m = /^@(\w+):(.+)$/.exec(k);
    put.run(m ? m[2] : k, m ? m[1] : "", JSON.stringify(v));
  }
  db.close();
}

async function up(profile, portArg) {
  if (!PROFILES[profile]) throw new Error(`profil inconnu : ${profile} (${Object.keys(PROFILES).join(", ")})`);
  if (!fs.existsSync(`${SNAPSHOT_DIR}/snapshot.json`)) throw new Error("pas d'instantané : lancez d'abord `node scripts/visual/site.mjs prepare`");
  ensureDirs();
  const dir = runDir(profile);
  if (fs.existsSync(`${dir}/server.pid`)) { const old = Number(fs.readFileSync(`${dir}/server.pid`, "utf8")); if (alive(old)) throw new Error(`un serveur tourne déjà pour ${profile} (pid ${old}) : \`down ${profile}\``); }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(`${SNAPSHOT_DIR}/data`, `${dir}/data`, { recursive: true });
  const skinProfile = PROFILES[profile];
  let skinRow = null;
  if (skinProfile.skinDir) skinRow = installSkinCopy(dir, skinProfile);
  const port = Number(portArg || portOf(profile));
  if (port < PORT_BASE || port > PORT_MAX) throw new Error(`port ${port} hors de la plage ${PORT_BASE}-${PORT_MAX}`);
  const dbFile = `${dir}/data/curiosa.db`;
  const env = baseEnv(`${dir}/data`, dbFile, port);
  migrate(dbFile, env); // le candidat peut porter des migrations de plus que la référence
  applyProfile(dbFile, profile, skinRow);
  const pid = start("node", [path.join(CORE_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: CORE_DIR, env: { ...env, NODE_ENV: "production" }, logFile: `${dir}/server.log` });
  fs.writeFileSync(`${dir}/server.pid`, String(pid));
  if (!(await waitHttp(`http://127.0.0.1:${port}/api/health`))) { await stopPid(pid); throw new Error(`le serveur ne répond pas (voir ${dir}/server.log)`); }
  console.log(JSON.stringify({ profile, port, pid, url: `http://127.0.0.1:${port}` }));
}

async function down(profile) {
  const f = `${runDir(profile)}/server.pid`;
  if (!fs.existsSync(f)) { console.log(`${profile} : pas de serveur`); return; }
  const pid = Number(fs.readFileSync(f, "utf8"));
  const ok = await stopPid(pid);
  fs.rmSync(f, { force: true });
  let free = true;
  try { await fetch(`http://127.0.0.1:${portOf(profile)}/api/health`, { signal: AbortSignal.timeout(1500) }); free = false; } catch {}
  console.log(`${profile} : ${ok ? "arrêté" : "ENCORE VIVANT"} (pid ${pid}), port ${portOf(profile)} ${free ? "libre" : "répond encore"}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "prepare") await prepare();
else if (cmd === "up") await up(a, b);
else if (cmd === "down") await down(a);
else if (cmd === "status") { for (const p of Object.keys(PROFILES)) { const f = `${runDir(p)}/server.pid`; console.log(p, fs.existsSync(f) && alive(Number(fs.readFileSync(f, "utf8"))) ? "en marche" : "arrêté"); } }
else { console.error("usage : site.mjs prepare | up <profil> [port] | down <profil> | status"); process.exit(2); }
