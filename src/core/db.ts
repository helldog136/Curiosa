import { PrismaClient } from "@prisma/client";
import { bumpSettingsGeneration, SETTING_WRITES } from "./settingsGeneration";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * The client, extended so that every write to `Setting` (also inside an interactive transaction) bumps the settings generation: the process-level settings cache
 * (settings.ts) can then be exact instead of "fresh enough". The extension changes nothing else; the type stays `PrismaClient` on purpose.
 */
function createClient(): PrismaClient {
  return new PrismaClient().$extends({
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
