import { runDueAutoBackup } from "./run";

const TICK = 10 * 60_000;
const FIRST = 2 * 60_000;
const g = globalThis as unknown as { curiosaAutoBackupScheduler?: boolean };

/**
 * The timer of the automatic backup: one per process, a first look 2 minutes after the start (this is the catch-up: a slot that passed while the server was off is
 * found due and run once), then every 10 minutes. State lives in the settings, so a restart loses nothing. The timer never keeps the server from stopping.
 */
export function startAutoBackupScheduler(): void {
  if (g.curiosaAutoBackupScheduler) return;
  g.curiosaAutoBackupScheduler = true;
  const tick = () => runDueAutoBackup().catch((error) => console.error("[autobackup] tick failed:", error?.name));
  setTimeout(() => { void tick(); setInterval(() => void tick(), TICK).unref(); }, FIRST).unref();
}
