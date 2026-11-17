import fs from "node:fs";
import path from "node:path";

/**
 * SQLite file of DATABASE_URL (relative = relative to the prisma/ folder, as Prisma 6 did; query parameters such as `?connection_limit=1` are ignored).
 * The ONE rule for the site (src/core/db.ts), the backups and the maintenance tools; prisma.config.ts and scripts/shared-lib.mjs apply the same one
 * (tests/core/prisma-config.test.mjs checks they agree).
 */
export function sqliteFile(url = process.env.DATABASE_URL, appDir = process.cwd()): string | null {
  const m = /^file:(.+)$/.exec(String(url ?? ""));
  if (!m) return null;
  const p = m[1]!.split("?")[0]!;
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(/* turbopackIgnore: true */ appDir, "prisma", p);
}

/**
 * The compiled SQLite driver that matches THIS Node.js. A release archive is built once, with one Node.js, and installed on servers that may run
 * another major version (20, 22, 24): it carries one driver per Node.js ABI in `node_modules/better-sqlite3/prebuilds/node-v<abi>-<platform>-<arch>/`
 * (scripts/release-pack.mjs). Undefined when there is no such folder (development, `npm ci`): the driver then finds its own build.
 */
export function sqliteNativeBinding(appDir = process.cwd(), versions = process.versions, platform: string = process.platform, arch: string = process.arch): string | undefined {
  const file = path.join(/* turbopackIgnore: true */ appDir, "node_modules/better-sqlite3/prebuilds", `node-v${versions.modules}-${platform}-${arch}`, "better_sqlite3.node");
  return fs.existsSync(file) ? file : undefined;
}
