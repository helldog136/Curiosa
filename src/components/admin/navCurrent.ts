/**
 * Quel lien du menu d'admin correspond à la page ouverte ? Logique pure (sans React), testée telle quelle.
 *
 * Plusieurs entrées de menu partagent le même chemin et ne se distinguent que par leur requête
 * (`/admin/entries?c=blog` et `/admin/entries?c=pages`) : un lien dont l'adresse a une requête n'est donc
 * courant que si l'adresse ouverte porte les mêmes paramètres. Sans requête, seul le chemin compte.
 */

type SearchLike = string | URLSearchParams | { get(name: string): string | null } | null | undefined;

/** Chemin sans barre finale ni ancre. */
function cleanPath(p: string): string {
  const s = p.split("#")[0]!.split("?")[0]!;
  return s.length > 1 ? s.replace(/\/+$/, "") || "/" : s;
}

function paramsOf(search: SearchLike): { get(name: string): string | null } {
  if (search == null) return new URLSearchParams();
  if (typeof search === "string") return new URLSearchParams(search.split("#")[0]!.replace(/^\?/, ""));
  return search;
}

/** Une cible (chemin, avec requête et ancre facultatives) correspond-elle à la page ouverte ? */
function matches(target: string, path: string, search: SearchLike, exact: boolean): boolean {
  const base = cleanPath(target);
  const here = cleanPath(path);
  const inPath = exact ? here === base : here === base || here.startsWith(base === "/" ? "/" : `${base}/`);
  if (!inPath) return false;
  const q = target.split("#")[0]!.split("?")[1];
  if (!q) return true;
  const have = paramsOf(search);
  for (const [k, v] of new URLSearchParams(q)) if (have.get(k) !== v) return false;
  return true;
}

/**
 * `href` : l'adresse du lien (avec sa requête éventuelle). `path` / `search` : l'adresse ouverte.
 * `also` : d'autres adresses (chemins, requêtes permises) qui font aussi de ce lien le lien courant.
 * `exact` : le chemin doit être identique (le tableau de bord), sans sous-pages.
 * `hash` : l'ancre de l'adresse ouverte (sans « # »). Deux entrées peuvent partager une page et se distinguer par l'ancre (Équipe et Rôles) : un lien dont l'adresse porte une ancre n'est
 * courant que si l'ancre ouverte est la même ; `exceptHash` liste les ancres de la même page qui appartiennent à une AUTRE entrée.
 */
export function isCurrent(href: string, path: string, search: SearchLike, opts: { exact?: boolean; also?: string[]; hash?: string; exceptHash?: readonly string[] } = {}): boolean {
  const exact = !!opts.exact;
  const hash = (opts.hash ?? "").replace(/^#/, "");
  if (hash && opts.exceptHash?.includes(hash)) return false;
  const wanted = href.split("#")[1];
  if (wanted !== undefined && wanted !== "" && opts.hash !== undefined && wanted !== hash) return false;
  return [href, ...(opts.also ?? [])].some((t) => matches(t, path, search, exact));
}

/**
 * Where the scrolling list must go so that the current entry is fully visible (null: it already is). Pure, from rectangles:
 * `box` is the visible area of the list, `item` the entry, both in the same coordinates, `scrollTop` the current offset of the list.
 * The entry is left a small margin; an entry taller than the box is aligned on its top.
 */
export function scrollTopToReveal(box: { top: number; bottom: number }, item: { top: number; bottom: number }, scrollTop: number, margin = 8): number | null {
  if (item.top - margin >= box.top && item.bottom + margin <= box.bottom) return null;
  const next = item.top < box.top + margin || item.bottom - item.top + 2 * margin > box.bottom - box.top
    ? scrollTop + (item.top - box.top - margin)
    : scrollTop + (item.bottom - box.bottom + margin);
  return Math.max(0, Math.round(next));
}
