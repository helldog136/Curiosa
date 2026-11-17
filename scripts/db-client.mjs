// The Prisma client for scripts run outside the site (plain Node, no TypeScript: they run from the production archive too).
// Same rules as src/core/db.ts: the file of DATABASE_URL (relative = relative to prisma/), dates in milliseconds, the SQLite driver of THIS Node.js
// when the archive carries one per Node.js. Scripts run alone, so no fair sharing of the connection is needed (src/core/dbFair.ts).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveSqlitePath } from "./shared-lib.mjs";

/** The application folder: the one that holds this scripts/ folder (and node_modules, prisma/). */
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function openPrisma({ url = process.env.DATABASE_URL, appDir = APP_DIR } = {}) {
  const file = resolveSqlitePath(url, appDir);
  if (!file) throw new Error("DATABASE_URL must be a SQLite address starting with file: (for example file:../data/curiosa.db)");
  const require = createRequire(path.join(appDir, "package.json"));
  const { PrismaClient } = require("@prisma/client");
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
  const own = path.join(appDir, "node_modules/better-sqlite3/prebuilds", `node-v${process.versions.modules}-${process.platform}-${process.arch}`, "better_sqlite3.node");
  const nativeBinding = fs.existsSync(own) ? own : undefined;
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: file, ...(nativeBinding ? { nativeBinding } : {}) }, { timestampFormat: "unixepoch-ms" }) });
}
