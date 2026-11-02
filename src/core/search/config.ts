/**
 * RECHERCHE DANS LE SITE — les réglages (docs/PLATFORM.md). Quatre clés, toutes facultatives : sans rien d'enregistré, la recherche est ACTIVE,
 * son champ est dans l'en-tête, la page montre 10 résultats et tout le contenu public est cherché.
 *   search.enabled    booléen, vrai par défaut (une seule règle : `searchEnabled`)
 *   search.placement  « header » | « footer » | « none » (page /search seule, sans champ)
 *   search.perPage    entier de 5 à 50, 10 par défaut
 *   search.exclude    clés d'instances à ne PAS chercher (une nouvelle instance est donc cherchée d'office)
 */
export const SEARCH_PLACEMENTS = ["header", "footer", "none"] as const;
export type SearchPlacement = (typeof SEARCH_PLACEMENTS)[number];
export const isSearchPlacement = (v: unknown): v is SearchPlacement => (SEARCH_PLACEMENTS as readonly string[]).includes(String(v));

export const PER_PAGE_MIN = 5;
export const PER_PAGE_MAX = 50;
export const PER_PAGE_DEFAULT = 10;

/** Ce que l'en-tête et le pied de page ont besoin de savoir (lu avec la configuration du site, sans requête de plus). */
export type SearchPlacementConfig = { enabled: boolean; placement: SearchPlacement };

export function normalizePlacement(v: unknown): SearchPlacement {
  return isSearchPlacement(v) ? v : "header";
}

/** Entier de 5 à 50 ; tout le reste (absent, texte, décimal, hors bornes) : la valeur par défaut. */
export function normalizePerPage(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= PER_PAGE_MIN && n <= PER_PAGE_MAX ? n : PER_PAGE_DEFAULT;
}

/** Clés d'instances (formes sûres, 100 au plus), sans doublon. */
export function normalizeExclude(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((k): k is string => typeof k === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(k)))].slice(0, 100);
}
