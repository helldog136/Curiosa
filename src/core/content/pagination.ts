/**
 * Pagination par adresse `?page=N` (jamais `/page/N`, qui entrerait en conflit avec un article dont l'adresse serait « page »).
 * Fonctions pures : pas de base de données.
 */

/** Plus grand numéro de page lu dans une adresse (au-delà : valeur invalide). */
export const MAX_PAGE_PARAM = 999_999;

export type PageParam =
  /** Pas de paramètre : première page. */
  | { kind: "first" }
  /** `page=1`, `0`, `abc`, `-3`, `2.5`, répété… : on renvoie vers l'adresse sans paramètre. */
  | { kind: "invalid" }
  | { kind: "page"; page: number };

export function parsePageParam(raw: string | string[] | undefined): PageParam {
  if (raw === undefined) return { kind: "first" };
  if (typeof raw !== "string" || !/^[1-9]\d{0,5}$/.test(raw)) return { kind: "invalid" };
  const page = Number(raw);
  return page <= 1 || page > MAX_PAGE_PARAM ? { kind: "invalid" } : { kind: "page", page };
}

/** Adresse d'une page : la première n'a jamais de paramètre. `base` peut déjà contenir une requête (administration). */
export function pageHref(base: string, page: number): string {
  if (page <= 1) return base;
  return `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
}

/** Numéros affichés : la première, la dernière et une fenêtre autour de la page courante ; `null` = « … ». */
export function pageWindow(page: number, pages: number, around = 1): (number | null)[] {
  const keep = new Set<number>([1, pages]);
  for (let i = page - around; i <= page + around; i++) if (i >= 1 && i <= pages) keep.add(i);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push(null);
    out.push(n);
  });
  return out;
}
