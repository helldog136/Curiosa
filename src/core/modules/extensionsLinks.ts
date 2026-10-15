// Adresses de la page Extensions et correspondance avec les anciennes adresses (Modules, Catalogue, Intégrations, Overlays). Logique pure, testée telle quelle.
import type { ExtensionFamily } from "./extensionFamilies";

export const EXTENSIONS_HREF = "/admin/extensions";
export const EXTENSIONS_ADD_HREF = "/admin/extensions/add";
export const EXTENSIONS_UPDATES_HREF = "/admin/extensions/updates";

/** Les extensions installées, limitées à une famille. */
export const extensionsFamilyHref = (family: ExtensionFamily): string => `${EXTENSIONS_HREF}?family=${family}`;

export type RawQuery = Record<string, string | string[] | undefined>;

function withQuery(path: string, query: RawQuery, drop: readonly string[] = []): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (drop.includes(k)) continue;
    for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) params.append(k, one);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Où mène une ancienne adresse d'admin (null = pas une ancienne adresse). Les paramètres (message d'erreur, avis, id, repo…) sont conservés.
 * Les pages de détail d'un module (/admin/modules/<id>) et d'une instance (/admin/instances/<id>) ne bougent pas.
 */
export function legacyExtensionsTarget(pathname: string, query: RawQuery = {}): string | null {
  switch (pathname.replace(/\/+$/, "")) {
    case "/admin/modules": {
      // Ancien retour d'une recherche de mise à jour : le message s'affiche sur la page du module concerné.
      const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
      const checked = one(query.module);
      if (checked && one(query.update)) return withQuery(`/admin/modules/${encodeURIComponent(checked)}`, query, ["tab"]);
      return query.tab === "updates" ? withQuery(EXTENSIONS_UPDATES_HREF, query, ["tab"]) : withQuery(EXTENSIONS_HREF, query, ["tab"]);
    }
    case "/admin/catalogue":
      return withQuery(EXTENSIONS_ADD_HREF, query);
    case "/admin/catalogue/details":
      return withQuery(`${EXTENSIONS_ADD_HREF}/details`, query);
    case "/admin/integrations":
      return extensionsFamilyHref("connections");
    case "/admin/overlays":
      return extensionsFamilyHref("overlays");
    default:
      return null;
  }
}
