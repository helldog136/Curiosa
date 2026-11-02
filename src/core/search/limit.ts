/**
 * RECHERCHE DANS LE SITE — la limite de débit. Sert à empêcher qu'un visiteur (ou un robot) fasse travailler le site sans fin, PAS à observer qui que ce soit.
 *
 * Ce qui est gardé, et pour combien de temps : un compteur par EMPREINTE du visiteur (`ctx.api.visitor.fingerprint` : condensé salé et non réversible de l'adresse
 * de confiance, sel tiré au hasard, gardé en mémoire seulement, renouvelé chaque jour ; voir modules/visitorFingerprint.ts), uniquement dans la mémoire du processus,
 * pendant une minute au plus. Jamais d'adresse, jamais le texte cherché, jamais de fichier, de base ou de cookie. Un compteur périmé est oublié à la
 * recherche suivante (aucun minuteur). Mémoire bornée : 2 000 compteurs au plus.
 */
export const LIMIT_PER_VISITOR = 30;
/** Plafond pour tout le site (toutes personnes confondues) : un envoi massif ne fait pas travailler le serveur sans fin. */
export const LIMIT_GLOBAL = 600;
export const LIMIT_WINDOW_MS = 60_000;
export const LIMIT_MAX_KEYS = 2000;

type Bucket = { start: number; count: number };
type Store = { visitors: Map<string, Bucket>; global: Bucket };
const state = globalThis as unknown as { curiosaSearchLimit?: Store };
const store = (): Store => (state.curiosaSearchLimit ??= { visitors: new Map(), global: { start: 0, count: 0 } });

/** Remet les compteurs à zéro (tests). */
export function resetSearchLimit(): void { state.curiosaSearchLimit = undefined; }
/** Nombre de compteurs en mémoire (tests). */
export function limitSize(): number { return store().visitors.size; }

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; scope: "visitor" | "site" };

/** Compte UNE recherche pour cette empreinte. */
export function countSearch(fingerprint: string, now: number = Date.now()): LimitResult {
  const s = store();
  if (now - s.global.start >= LIMIT_WINDOW_MS) s.global = { start: now, count: 0 };
  if (s.global.count >= LIMIT_GLOBAL) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((s.global.start + LIMIT_WINDOW_MS - now) / 1000)), scope: "site" };
  let bucket = s.visitors.get(fingerprint);
  if (!bucket || now - bucket.start >= LIMIT_WINDOW_MS) {
    s.visitors.delete(fingerprint);
    if (s.visitors.size >= LIMIT_MAX_KEYS) {
      for (const [k, b] of s.visitors) if (now - b.start >= LIMIT_WINDOW_MS) s.visitors.delete(k);
      // Toujours plein : les plus anciens sont oubliés (la Map garde l'ordre d'arrivée).
      while (s.visitors.size >= LIMIT_MAX_KEYS) s.visitors.delete(s.visitors.keys().next().value as string);
    }
    bucket = { start: now, count: 0 };
    s.visitors.set(fingerprint, bucket);
  }
  if (bucket.count >= LIMIT_PER_VISITOR) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.start + LIMIT_WINDOW_MS - now) / 1000)), scope: "visitor" };
  bucket.count++;
  s.global.count++;
  return { ok: true };
}
