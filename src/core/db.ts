import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { fairFactory } from "./dbFair";
import { sqliteFile, sqliteNativeBinding } from "./dbFile";
import { bumpSettingsGeneration, SETTING_WRITES } from "./settingsGeneration";

/** What `new PrismaClient({ adapter })` accepts (the factory type of the Prisma driver adapters). */
type SqlDriverAdapterFactory = NonNullable<NonNullable<ConstructorParameters<typeof PrismaClient>[0]>["adapter"]>;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * The SQLite driver for Prisma 7 (driver adapters are required). Kept exactly as Prisma 6 behaved on existing databases:
 *  - the same file: a relative DATABASE_URL is relative to prisma/ (src/core/dbFile.ts), never to the current folder;
 *  - dates stored as milliseconds since 1970 (`unixepoch-ms`), the format every existing site already has. The adapter's default (ISO text)
 *    would mix two formats in one column, and comparisons or sorting on dates would silently go wrong (tests/core/prisma7-upgrade.test.mjs);
 *  - the driver compiled for THIS Node.js when the archive carries several (src/core/dbFile.ts);
 *  - one connection used fairly: the event loop breathes between queries, and a transaction holds the connection until it ends (src/core/dbFair.ts).
 */
export function sqliteAdapter(url?: string, appDir?: string): SqlDriverAdapterFactory {
  // The address is read when Prisma CONNECTS (its first query), not when this file is imported: as with Prisma 6, a process (or a test) may set
  // DATABASE_URL after importing the core.
  const connect = () => {
    const where = appDir ?? process.cwd();
    const file = sqliteFile(url ?? process.env.DATABASE_URL, where);
    // No address: importing this file must still work (tools, tests and the skin check import the core without a database, as with Prisma 6);
    // connecting succeeds and each query fails with a clear message. Never a silent database in memory.
    if (!file) {
      const refuse = () => Promise.reject(new Error("DATABASE_URL must be a SQLite address starting with file: (for example file:../data/curiosa.db)"));
      return Promise.resolve({ provider: "sqlite", adapterName: "curiosa-no-database", queryRaw: refuse, executeRaw: refuse, executeScript: refuse, startTransaction: refuse, dispose: () => Promise.resolve() });
    }
    const nativeBinding = sqliteNativeBinding(where);
    const driver = new PrismaBetterSqlite3({ url: file, ...(nativeBinding ? { nativeBinding } : {}) }, { timestampFormat: "unixepoch-ms" });
    return fairFactory(driver as unknown as Parameters<typeof fairFactory>[0]).connect();
  };
  return { provider: "sqlite", adapterName: "@prisma/adapter-better-sqlite3", connect } as unknown as SqlDriverAdapterFactory;
}

/**
 * The client, extended so that every write to `Setting` (also inside an interactive transaction) bumps the settings generation: the process-level settings cache
 * (settings.ts) can then be exact instead of "fresh enough". The extension changes nothing else; the type stays `PrismaClient` on purpose.
 */
function createClient(): PrismaClient {
  return new PrismaClient({ adapter: sqliteAdapter() }).$extends({
    query: {
      setting: {
        async $allOperations({ operation, args, query }) {
          try { return await query(args); } finally { if (SETTING_WRITES.has(operation)) bumpSettingsGeneration(); }
        },
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
