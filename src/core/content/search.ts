import { matchesSearch, searchText } from "../adminkit/search";
import type { EntryView } from "./entries";

/**
 * RECHERCHE DANS UNE LISTE PUBLIQUE d'entrées (blog, liens, codes…). Réglage de chaque instance : « Afficher un champ de recherche ».
 * Sans choix enregistré : la valeur `content.search` du manifeste du module si elle existe, sinon activée pour l'affichage en liste et désactivée pour les autres.
 * Fonctions pures (aucune base de données) : la règle de comparaison est celle des pages d'administration (`adminkit/search.ts` : sans majuscules ni accents,
 * tous les mots saisis doivent se trouver dans le texte affiché).
 */
export const searchSettingKey = (instanceId: string) => `instance.${instanceId}.__search`;

export function effectiveSearch(stored: unknown, display: string, manifestDefault?: boolean): boolean {
  if (typeof stored === "boolean") return stored;
  if (typeof manifestDefault === "boolean") return manifestDefault;
  return display === "list";
}

/** Longueur maximale d'une recherche (au-delà, elle est coupée). */
export const LIST_QUERY_MAX = 80;

/** Lit le paramètre `q` d'une adresse : une seule valeur, sans espaces autour, coupée à `LIST_QUERY_MAX` ; autrement vide. */
export function parseListQuery(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, LIST_QUERY_MAX) : "";
}

/** Tout ce que la liste affiche d'une entrée (titre, résumé, mots-clés, code), sous la forme comparée. */
export function entrySearchText(e: Pick<EntryView, "title" | "summary" | "tags" | "code">): string {
  return searchText([e.title, e.summary, ...e.tags, e.code]);
}

export const entryMatches = (e: Pick<EntryView, "title" | "summary" | "tags" | "code">, query: string): boolean => matchesSearch(entrySearchText(e), query);
