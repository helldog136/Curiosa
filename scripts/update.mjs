// Lancé en tâche détachée par l'admin (ou à la main : `node scripts/update.mjs v1.2.3`).
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { runUpdate } from "./update-lib.mjs";

const run = promisify(execFile);
const appDir = process.cwd();
const result = await runUpdate({
  appDir,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(appDir, "data")),
  tag: process.argv[2],
  databaseUrl: process.env.DATABASE_URL,
  remote: process.env.VITRINE_UPDATE_REMOTE || "origin",
  restartCommand: process.env.VITRINE_RESTART_COMMAND || undefined,
  supervised: process.env.VITRINE_SUPERVISED === "1",
  serverPid: Number(process.env.VITRINE_SERVER_PID) || undefined,
  exec: (cmd, args, opts = {}) => run(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, maxBuffer: 20 * 1024 * 1024, timeout: 30 * 60_000 }),
});
process.exit(result.ok ? 0 : 1);
