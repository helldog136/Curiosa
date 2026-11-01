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
 */
export function isCurrent(href: string, path: string, search: SearchLike, opts: { exact?: boolean; also?: string[] } = {}): boolean {
  const exact = !!opts.exact;
  return [href, ...(opts.also ?? [])].some((t) => matches(t, path, search, exact));
}
