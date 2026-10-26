import { RESERVED_PATHS } from "../config";

/**
 * MÉTADONNÉES DE PAGE ET ROUTES À SEGMENT LIBRE (cœur 0.3.0). Fonctions pures (ni base ni Next), lues par la page publique, le plan du site, llms.txt et la route `/m/…`.
 *
 * Frontière de confiance : un module ne choisit JAMAIS un en-tête ni une directive. Il peut seulement
 *   - demander `robots: "noindex"` (le cœur pose lui-même la balise ; la demande ne peut que RÉDUIRE l'exposition de la page) ;
 *   - déclarer des chemins de SA page pour le plan du site, bornés, validés ici, sous le préfixe de SON instance (jamais ailleurs sur le site) ;
 *   - recevoir en dernier segment d'une de ses routes une valeur qui passe le motif strict `SLUG_RE`.
 */

/** Un segment de chemin libre : lettres, chiffres, tiret et tiret bas, 1 à 80 caractères. Rien d'autre (ni point, ni pourcentage, ni barre). */
export const SLUG_RE = /^[A-Za-z0-9_-]{1,80}$/;
/** Chemins déclarés pour le plan du site : 50 au plus par page, 5 niveaux au plus sous l'adresse de l'instance. */
export const SITEMAP_MAX_PATHS = 50;
export const SITEMAP_MAX_DEPTH = 5;

/** Seule valeur permise : « noindex » (le cœur ajoute aussi « nofollow »). Toute autre chose est ignorée. */
export function pageRobots(value: unknown): "noindex" | undefined {
  return value === "noindex" ? "noindex" : undefined;
}

/**
 * Chemins du plan du site déclarés par une page, nettoyés. `declared` vient d'un module : n'importe quoi. Garde, dans l'ordre et sans doublon (casse ignorée :
 * le cœur sert les chemins en minuscules), les chaînes qui sont des chemins du SITE sous l'adresse de l'instance (`/<basePath>/…`), segments conformes à `SLUG_RE`,
 * 5 niveaux au plus, 50 au plus. L'adresse de l'instance elle-même est déjà dans le plan : elle n'est pas répétée. Instance montée à la racine (`basePath` vide) :
 * tout chemin dont le premier segment n'est pas réservé au cœur. Le reste est écarté sans bruit.
 */
export function cleanSitemapPaths(declared: unknown, basePath: string | null): string[] {
  if (basePath === null || !Array.isArray(declared)) return [];
  const prefix = basePath === "" ? [] : [basePath.toLowerCase()];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of declared.slice(0, SITEMAP_MAX_PATHS * 4)) {
    if (typeof raw !== "string" || raw.length > 600 || !raw.startsWith("/") || raw.endsWith("/")) continue;
    const segments = raw.slice(1).split("/").map((s) => s.toLowerCase());
    if (!segments.every((s) => SLUG_RE.test(s))) continue;
    if (prefix.length > 0 && segments[0] !== prefix[0]) continue;
    if (prefix.length === 0 && RESERVED_PATHS.has(segments[0]!)) continue;
    const below = segments.length - prefix.length;
    if (below < 1 || below > SITEMAP_MAX_DEPTH) continue;
    const path = `/${segments.join("/")}`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= SITEMAP_MAX_PATHS) break;
  }
  return out;
}

/** Suffixe d'une clé de `routes` qui accepte un dernier segment libre : `"go/:slug"` ou `":slug"`. */
export const SLUG_SUFFIX = ":slug";

export type RouteMatch<H> = { handler: H; params: { slug?: string } };

/**
 * Quelle route répond à ce chemin ? D'abord la route de ce nom exact, EXACTEMENT comme avant la 0.3.0 (une route existante n'est jamais détournée). Sinon, une
 * route déclarée `"<préfixe>/:slug"` (ou `":slug"` seul) dont le préfixe est celui du chemin et dont le DERNIER segment passe `SLUG_RE`. Rien d'autre : un seul
 * segment libre, toujours le dernier ; une valeur hors motif donne « introuvable ».
 */
export function matchModuleRoute<H>(routes: Record<string, H> | undefined, segments: readonly string[]): RouteMatch<H> | null {
  if (!routes) return null;
  const last = segments[segments.length - 1];
  if (last === SLUG_SUFFIX) return null;   // la clé déclarée n'est pas une adresse : on ne l'appelle jamais « à la lettre »
  const exact = routes[segments.join("/")];
  if (exact) return { handler: exact, params: {} };
  if (last === undefined || !SLUG_RE.test(last)) return null;
  const key = [...segments.slice(0, -1), SLUG_SUFFIX].join("/");
  if (!Object.prototype.hasOwnProperty.call(routes, key)) return null;
  const handler = routes[key];
  return handler ? { handler, params: { slug: last } } : null;
}
