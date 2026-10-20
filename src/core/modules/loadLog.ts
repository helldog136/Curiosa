/**
 * Journal des modules qui ne se chargent pas. Un module en erreur est ré-essayé à chaque requête : sans garde-fou, chaque requête écrirait une pile
 * complète dans le journal. Règle : la pile n'est écrite qu'UNE fois par module et par raison ; ensuite, au plus une ligne toutes les 10 minutes avec
 * le nombre d'échecs depuis la dernière ligne. Aucun minuteur : tout se décide à l'occasion d'un nouvel échec (rien ne tourne en arrière-plan).
 */
export const LOAD_LOG_INTERVAL_MS = 10 * 60 * 1000;
const MAX_TRACKED = 200;

type Seen = { lastLoggedAt: number; skipped: number };
const seen = new Map<string, Seen>();

const reasonOf = (error: unknown): string => {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\s+/g, " ").slice(0, 300);
};

export type LoadLogSink = { error: (...args: unknown[]) => void };

export function reportLoadFailure(moduleId: string, error: unknown, now: number = Date.now(), sink: LoadLogSink = console): void {
  const reason = reasonOf(error);
  const key = `${moduleId}\u0000${reason}`;
  const entry = seen.get(key);
  if (!entry) {
    if (seen.size >= MAX_TRACKED) seen.delete(seen.keys().next().value as string); // borné : on oublie la plus ancienne
    seen.set(key, { lastLoggedAt: now, skipped: 0 });
    sink.error(`[modules] cannot load "${moduleId}":`, error);
    return;
  }
  entry.skipped++;
  if (now - entry.lastLoggedAt >= LOAD_LOG_INTERVAL_MS) {
    sink.error(`[modules] "${moduleId}" still cannot load (${reason}): ${entry.skipped} more failure${entry.skipped > 1 ? "s" : ""} in the last ${Math.round((now - entry.lastLoggedAt) / 60000)} min`);
    entry.lastLoggedAt = now;
    entry.skipped = 0;
  }
}

/** Oublie ce que l'on sait d'un module (rechargé avec succès, réinstallé, retiré) : une nouvelle panne sera de nouveau écrite en entier. */
export function forgetLoadFailures(moduleId?: string): void {
  if (!moduleId) { seen.clear(); return; }
  for (const key of [...seen.keys()]) if (key.startsWith(`${moduleId}\u0000`)) seen.delete(key);
}
