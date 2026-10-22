import { prisma } from "./db";

/**
 * PORTE DES LIENS TERMINÉS. Une page de Next ne peut pas répondre « 410 » : c'est le proxy (src/proxy.ts) qui détourne vers la page « lien terminé » (api/redirect-gone)
 * les adresses dont la date de fin est passée. Il lui faut donc savoir, SANS lire la base à chaque page vue, quelles redirections ont une date de fin.
 * Cette petite carte (chemin → instant de fin, 2 000 au plus, seulement les redirections actives avec une date) est relue au plus toutes les 30 secondes,
 * et aussitôt quand l'administration modifie une redirection. Elle ne contient que des chemins et des dates : jamais une destination.
 */
const TTL_MS = 30_000;
const RETRY_MS = 5_000;
const MAX_ENTRIES = 2000;

type Gate = { map: Map<string, number>; at: number; ttl: number; loading: Promise<void> | null };
const g = globalThis as unknown as { curiosaRedirectGate?: Gate };
const gate = (): Gate => (g.curiosaRedirectGate ??= { map: new Map(), at: 0, ttl: 0, loading: null });

/** À appeler quand une redirection change : la prochaine page vue relit la carte. */
export function invalidateRedirectGate(): void {
  const s = gate();
  s.at = 0;
}

async function refresh(): Promise<void> {
  const s = gate();
  if (s.loading) return s.loading;
  s.loading = (async () => {
    try {
      const rows = await prisma.redirect.findMany({ where: { active: true, expiresAt: { not: null } }, select: { path: true, expiresAt: true }, take: MAX_ENTRIES });
      s.map = new Map(rows.map((r) => [r.path, r.expiresAt!.getTime()]));
      s.ttl = TTL_MS;
    } catch {
      s.ttl = RETRY_MS; // base indisponible : on garde l'ancienne carte et on réessaie vite
    }
    s.at = Date.now();
  })().finally(() => { s.loading = null; });
  return s.loading;
}

/** Ce chemin est-il une redirection active dont la date de fin est passée ? Faux au moindre doute (la page publique prend alors le relais). */
export async function isRedirectEnded(path: string, now = Date.now()): Promise<boolean> {
  const s = gate();
  if (now - s.at >= s.ttl) await refresh();
  const end = gate().map.get(path);
  return end !== undefined && end <= now;
}
