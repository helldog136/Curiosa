/**
 * Recherche en direct des pages d'administration (pur, testé sans navigateur) : LA règle commune à `LiveSearch`, au bloc `table` des modules et aux listes du cœur.
 * Insensible à la casse et aux accents ; tous les mots saisis doivent se trouver dans le texte de la ligne ; aucun seuil (une seule lettre filtre déjà).
 */
import { foldText } from "../modules/installedList";

export { foldText };

/** Le texte cherché d'une ligne : tout ce qui est affiché (et ce qu'on veut pouvoir retrouver), mis sous la forme comparée (sans accents ni majuscules). */
export function searchText(parts: readonly (string | number | null | undefined | false)[]): string {
  return foldText(parts.filter((p): p is string | number => p !== null && p !== undefined && p !== false && String(p) !== "").map(String).join(" ").replace(/\s+/g, " "));
}

/** Les mots d'une recherche (sans accents ni majuscules). */
export const queryWords = (query: string): string[] => foldText(query).split(/\s+/).filter(Boolean);

/** Une recherche vide laisse tout passer ; sinon chaque mot doit figurer dans `haystack` (déjà passé par `searchText`). */
export function matchesSearch(haystack: string, query: string): boolean {
  return queryWords(query).every((w) => haystack.includes(w));
}

/** Filtres rapides (pastilles) : une clé → une valeur choisie (« all » ou absente : pas de filtre sur cette clé). */
export type PillFilter = Record<string, string | undefined>;

/** Une ligne `{ haystack, <clé>: valeur }` passe-t-elle la recherche ET toutes les pastilles ? */
export function rowPasses(row: { haystack: string } & Record<string, string | undefined>, query: string, pills: PillFilter = {}): boolean {
  if (!matchesSearch(row.haystack, query)) return false;
  for (const [key, want] of Object.entries(pills)) {
    if (want === undefined || want === "all") continue;
    if (row[key] !== want) return false;
  }
  return true;
}

/** Les pastilles d'une colonne : chaque valeur distincte, dans l'ordre d'arrivée, avec son nombre de lignes. */
export function pillOptions(values: readonly string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== "") counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
}

/** Pagination côté navigateur : les lignes de la page `page` (à partir de 1), et le nombre de pages. */
export function pageSlice<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  if (!(size > 0)) return { items: [...items], page: 1, pages: 1 };
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((at - 1) * size, at * size), page: at, pages };
}

/** Taille de page par défaut d'un tableau d'administration (règle R15 : 50 au plus). */
export const TABLE_PAGE_SIZE = 50;
