// Regenerates the era fixtures of the backup conversion tests (tests/core/backup-eras.test.mjs): a backup written by the REAL code of a published release, from demo data only.
//   node tests/fixtures/backup-eras/generate.mjs [tag ...]      (default: every era below)
// For each tag: a throwaway worktree of the tag (git), a node_modules that links the dependencies of a checkout with the same Prisma major, a fresh migrated database, then
// seed.mjs runs INSIDE it. Nothing of the current checkout runs in there. Needs git, the network is not used. The result is `<tag>.chiffre.bin` (password in seed.mjs, 1000 iterations).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = import.meta.dirname;
const repo = path.resolve(here, "../../..");
// era -> a checkout whose node_modules serves it (Prisma 6.19 for the early releases, Prisma 7 from 0.31). Override with ERA_MODULES_6 / ERA_MODULES_7.
const ERAS = { "v0.1.19": "6", "v0.1.28": "6", "v0.2.14": "6", "v0.6.17": "6", "v0.31.1": "7", "v0.38.0": "7" };
const MODULES = { 6: process.env.ERA_MODULES_6 ?? "/home/user/work-core010/node_modules", 7: process.env.ERA_MODULES_7 ?? path.join(repo, "node_modules") };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });

for (const tag of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ERAS)) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `era-${tag}-`)); // tmp-ok: a developer tool, removed in the finally below, never run by the tests
  const tree = path.join(work, "tree");
  try {
    run("git", ["-C", repo, "worktree", "add", "--detach", tree, tag]);
    const source = MODULES[ERAS[tag]];
    const nm = path.join(tree, "node_modules");
    fs.mkdirSync(nm);
    for (const e of fs.readdirSync(source)) {
      if (e === ".prisma" || e === "@prisma") continue;
      fs.symlinkSync(path.join(source, e), path.join(nm, e));
    }
    fs.mkdirSync(path.join(nm, "@prisma"));
    for (const e of fs.readdirSync(path.join(source, "@prisma"))) {
      const from = path.join(source, "@prisma", e);
      if (e === "client") fs.cpSync(from, path.join(nm, "@prisma", e), { recursive: true }); else fs.symlinkSync(from, path.join(nm, "@prisma", e));
    }
    if (fs.existsSync(path.join(source, ".prisma"))) fs.cpSync(path.join(source, ".prisma"), path.join(nm, ".prisma"), { recursive: true });
    const env = { ...process.env, DATABASE_URL: `file:${path.join(work, "demo.db")}`, DATA_DIR: path.join(work, "data"), ERA_TAG: tag, ERA_OUT: path.join(here, `${tag}.chiffre.bin`), CURIOSA_ALLOW_LOCAL_MODULES: "1" };
    run("npx", ["prisma", "generate"], { cwd: tree, env });
    run("npx", ["prisma", "migrate", "deploy"], { cwd: tree, env });
    fs.copyFileSync(path.join(here, "seed.mjs"), path.join(tree, "era-seed.mjs"));
    process.stdout.write(run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./tests/helpers/register.mjs", "era-seed.mjs"], { cwd: tree, env }));
  } finally {
    try { run("git", ["-C", repo, "worktree", "remove", "--force", tree]); } catch { /* already gone */ }
    fs.rmSync(work, { recursive: true, force: true });
  }
}
