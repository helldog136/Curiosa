// Prisma 7 configuration (read by the Prisma CLI: `prisma generate`, `prisma migrate deploy`). The site itself opens the database in src/core/db.ts.
//
// Two behaviours of Prisma 6 that installed sites rely on are kept on purpose (tests/core/prisma-config.test.mjs):
//  - `.env` next to this file is read when present (Prisma 6 read it by itself; Prisma 7 does not). A variable already set wins, as before.
//    install.sh runs `migrate deploy` with only the `.env` file to find DATABASE_URL.
//  - a relative SQLite path (`file:../data/curiosa.db`, written by install.sh) is relative to the prisma/ folder, as in Prisma 6.
//    The CLI is always given an ABSOLUTE path, so it never depends on the current folder: the same file as src/core/db.ts and the backups.
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

const appDir = path.dirname(new URL(import.meta.url).pathname);
const envFile = path.join(appDir, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

/** `file:<absolute path>` for a SQLite DATABASE_URL (relative = relative to prisma/), the URL unchanged otherwise. Query parameters are kept. */
export function absoluteSqliteUrl(url: string | undefined, base = appDir): string {
  const m = /^file:([^?]*)(\?.*)?$/.exec(String(url ?? ""));
  if (!m || !m[1]) return String(url ?? "");
  return `file:${path.isAbsolute(m[1]) ? m[1] : path.resolve(base, "prisma", m[1])}${m[2] ?? ""}`;
}

export default defineConfig({
  schema: path.join(appDir, "prisma/schema.prisma"),
  migrations: { path: path.join(appDir, "prisma/migrations") },
  // `prisma generate` needs no database: an empty value is fine there; `migrate deploy` without DATABASE_URL fails with Prisma's own message.
  datasource: { url: absoluteSqliteUrl(process.env.DATABASE_URL) },
});
