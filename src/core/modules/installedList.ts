// Liste « compacte » des modules installés : texte cherché, filtre et regroupement par catégorie. Logique pure (ni base ni réseau), testée telle quelle.

/** Sans accents ni majuscules : « Réseaux » et « reseaux » se valent. */
export const foldText = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Texte cherché d'un module : nom, description, identifiant, catégorie (libellé et code), nom, surnom et identifiant de chaque instance. */
export function moduleSearchText(parts: (string | null | undefined)[]): string {
  return foldText(parts.filter((p): p is string => !!p).join(" "));
}

/** Tous les mots de la recherche doivent se trouver dans `searchText` (déjà passé par foldText). Une recherche vide laisse tout passer. */
export function matchesQuery(searchText: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  return words.every((w) => searchText.includes(w));
}

export type ListItem = { id: string; type: string; search: string };
export type ListGroup<T extends ListItem> = { type: string; items: T[] };

/** Regroupe par catégorie (ou par la clé que donne `keyOf`, p. ex. la famille) dans l'ordre donné, puis les catégories inconnues (hors « broken ») par ordre d'arrivée, et enfin « broken » ; les groupes vides disparaissent. Dans un groupe : ordre alphabétique des noms. */
export function buildModuleGroups<T extends ListItem & { name: string }>(items: T[], order: readonly string[], query = "", keyOf: (i: T) => string = (i) => i.type): ListGroup<T>[] {
  const kept = items.filter((i) => matchesQuery(i.search, query));
  const known = new Set(order);
  const extra = [...new Set(kept.map(keyOf))].filter((t) => !known.has(t) && t !== "broken");
  return [...order, ...extra, "broken"]
    .map((type) => ({ type, items: kept.filter((i) => keyOf(i) === type).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.items.length > 0);
}
