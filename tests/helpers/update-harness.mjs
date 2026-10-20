// Banc d'essai des mises à jour : de vraies archives .tar.gz avec leur empreinte, un vrai tar ; prisma et le redémarrage sont simulés.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const PLATFORM = `${process.platform}-${process.arch}`;
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** Une « release » : un dossier de fichiers + release.json, empaqueté en .tar.gz avec son .sha256, comme le fait la CI. */
export function setup() {
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
export const opts = (s, over = {}) => ({ appDir: s.app, dataDir: s.dataDir, databaseUrl: `file:${s.dbFile}`, download: s.download, ...over });
