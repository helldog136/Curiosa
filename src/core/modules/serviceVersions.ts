/**
 * VERSIONS DE SERVICES — fonctions pures (aucune base, aucun réseau). Un service est un nom (`contact.store`) ; son interface évolue :
 *   offers:   [{ "service": "contact.store", "version": 2 }]   version offerte (entier ≥ 1, défaut 1)
 *   requires: [{ "service": "contact.store", "min": 2 }]       version minimale exigée (entier ≥ 1, défaut 1)
 * Un fournisseur satisfait une exigence quand sa version est ≥ `min`. Les manifestes sans version restent valides (version 1).
 */
export type ServiceOffer = { service: string; version: number };
export type ServiceNeed = { service: string; min: number };

type RawOffer = { service: string; version?: number };
type RawNeed = { service: string; min?: number };

export const offerVersionOf = (offers: RawOffer[] | undefined, service: string): number | null => {
  const found = (offers ?? []).filter((o) => o.service === service);
  return found.length ? Math.max(...found.map((o) => o.version ?? 1)) : null;
};
export const normalizeOffers = (offers: RawOffer[] | undefined): ServiceOffer[] => (offers ?? []).map((o) => ({ service: o.service, version: o.version ?? 1 }));
export const normalizeNeeds = (requires: RawNeed[] | undefined): ServiceNeed[] => (requires ?? []).map((r) => ({ service: r.service, min: r.min ?? 1 }));
export const satisfiesVersion = (offered: number | null | undefined, min: number): boolean => offered != null && offered >= min;

const SERVICE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/;
const validVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000;

/**
 * Liste annoncée par l'index du catalogue : `["contact.store", …]` ou des objets `{ service, version }` / `{ service, min }`.
 * Valeurs validées, doublons écartés, 10 au plus ; tout le reste est ignoré (jamais d'erreur : un ancien cœur ignore ces clés).
 */
export function sanitizeServiceList(v: unknown, field: "version" | "min"): { service: string; version?: number; min?: number }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: { service: string; version?: number; min?: number }[] = [];
  for (const raw of v) {
    const service = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { service?: unknown }).service : undefined;
    if (typeof service !== "string" || !SERVICE_RE.test(service) || out.some((o) => o.service === service)) continue;
    const n = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[field] : undefined;
    out.push(validVersion(n) ? { service, [field]: n } : { service });
    if (out.length >= 10) break;
  }
  return out;
}
