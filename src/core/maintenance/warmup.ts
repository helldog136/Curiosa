import { prisma } from "@/core/db";
import { getCatalogue } from "@/core/modules/catalogue";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { health } from "./inspect";

/**
 * After a restart every cache of the site is empty, and the first call of an AI maintenance access used to pay for all of it (the 70 modules loaded one by one, the
 * catalogue, the check of every repository). This warms them in the background, a few seconds AFTER the server is listening, and only for a site that has an AI access.
 * It reads and caches; it changes nothing. Never throws, never blocks the start.
 */
export const WARMUP_DELAY_MS = 5_000;

export async function warmMaintenance(): Promise<void> {
  try {
    if ((await prisma.apiToken.count({ where: { revokedAt: null } })) === 0) return;
    peekModulesReport();   // starts the check of the module versions when the saved one is old; the result is saved for the next restart
    const rows = await listModuleRows();
    await Promise.allSettled([
      getCatalogue(),
      health(),
      (async () => { for (let i = 0; i < rows.length; i += 4) await Promise.allSettled(rows.slice(i, i + 4).map((r) => loadModule(r))); })(),
    ]);
  } catch (error) {
    console.error("[maintenance] warm-up failed:", (error as Error)?.message);
  }
}

/** Schedules the warm-up once the server has had time to start listening. */
export function scheduleMaintenanceWarmup(): void {
  const timer = setTimeout(() => { void warmMaintenance(); }, WARMUP_DELAY_MS);
  timer.unref?.();
}
