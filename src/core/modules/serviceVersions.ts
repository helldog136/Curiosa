/**
 * VERSIONS DE SERVICES — fonctions pures (aucune base, aucun réseau). Un service est un nom (`contact.store`) ; son interface évolue :
 *   offers:   [{ "service": "contact.store", "version": 2 }]   version offerte (entier ≥ 1, défaut 1)
 *   requires: [{ "service": "contact.store", "min": 2 }]       version minimale exigée (entier ≥ 1, défaut 1)
 * Un fournisseur satisfait une exigence quand sa version est ≥ `min`. Les manifestes sans version restent valides (version 1).
 */
export type ServiceOffer = { service: string; version: number; /** Présent (true) seulement pour une offre « chaque instance répond pour elle-même » : pas de maître ni de réplique. */ each?: true };
/** `optional` (présent seulement à true) : besoin FACULTATIF — jamais installé d'office, jamais bloquant, n'empêche pas de désinstaller le fournisseur. */
export type ServiceNeed = { service: string; min: number; optional?: true };

type RawOffer = { service: string; version?: number; each?: boolean };
type RawNeed = { service: string; min?: number; optional?: boolean };

export const offerVersionOf = (offers: RawOffer[] | undefined, service: string): number | null => {
  const found = (offers ?? []).filter((o) => o.service === service);
  return found.length ? Math.max(...found.map((o) => o.version ?? 1)) : null;
};
export const normalizeOffers = (offers: RawOffer[] | undefined): ServiceOffer[] => (offers ?? []).map((o) => ({ service: o.service, version: o.version ?? 1, ...(o.each === true ? { each: true as const } : {}) }));
/** Ce module offre-t-il ce service « chaque instance pour elle-même » (`each`) ? */
export const offerIsEach = (offers: RawOffer[] | undefined, service: string): boolean => (offers ?? []).some((o) => o.service === service && o.each === true);
export const normalizeNeeds = (requires: RawNeed[] | undefined): ServiceNeed[] => (requires ?? []).map((r) => ({ service: r.service, min: r.min ?? 1, ...(r.optional === true ? { optional: true as const } : {}) }));
/** Besoins DURS seulement (sans les facultatifs) : ce qui bloque, s'installe d'office et retient un fournisseur. */
export const hardNeeds = (requires: RawNeed[] | undefined): ServiceNeed[] => normalizeNeeds(requires).filter((n) => !n.optional);
export const satisfiesVersion = (offered: number | null | undefined, min: number): boolean => offered != null && offered >= min;

export const SERVICE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/;
const validVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000;

/**
 * Liste annoncée par l'index du catalogue : `["contact.store", …]` ou des objets `{ service, version }` / `{ service, min }`.
 * Valeurs validées, doublons écartés, 10 au plus ; tout le reste est ignoré (jamais d'erreur : un ancien cœur ignore ces clés).
 */
export function sanitizeServiceList(v: unknown, field: "version" | "min"): { service: string; version?: number; min?: number; each?: true; optional?: true }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: { service: string; version?: number; min?: number; each?: true; optional?: true }[] = [];
  for (const raw of v) {
    const service = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { service?: unknown }).service : undefined;
    if (typeof service !== "string" || !SERVICE_RE.test(service) || out.some((o) => o.service === service)) continue;
    const n = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[field] : undefined;
    // `each` : seulement pour une offre (`version`), et seulement la valeur booléenne true ; tout autre contenu est ignoré.
    const each = field === "version" && raw && typeof raw === "object" && (raw as Record<string, unknown>).each === true;
    // `optional` : seulement pour un besoin (`min`), et seulement la valeur booléenne true (sinon un cœur 0.2.0 installerait d'office un fournisseur facultatif).
    const optional = field === "min" && raw && typeof raw === "object" && (raw as Record<string, unknown>).optional === true;
    out.push({ service, ...(validVersion(n) ? { [field]: n } : {}), ...(each ? { each: true as const } : {}), ...(optional ? { optional: true as const } : {}) });
    if (out.length >= 10) break;
  }
  return out;
}
