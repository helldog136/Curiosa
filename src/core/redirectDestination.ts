/**
 * COMPARER DES DESTINATIONS (pur, sans base de données). Utilisé par le total par destination (redirectGroups.ts) et par la réécriture des boutons du site
 * (redirectMeasure.ts) : les deux doivent juger « même destination » exactement de la même façon.
 */
/** Paramètres d'adresse qui ne servent qu'à suivre un clic (pas à choisir la page) : ils ne comptent pas dans la comparaison. */
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "dclid", "msclkid", "twclid", "ttclid", "yclid", "igshid", "igsh", "si", "feature", "mc_cid", "mc_eid", "_ga", "_gl", "ref_src", "ref_url", "s_cid"]);
const isTracking = (name: string) => TRACKING_PARAMS.has(name.toLowerCase()) || name.toLowerCase().startsWith("utm_");

/**
 * La clé de comparaison d'une destination, ou null si ce n'est pas une adresse http(s).
 * Ignorés : http/https, `www.`, majuscules du nom de domaine, point final du domaine, port par défaut, barre finale(s) du chemin, ordre des paramètres,
 * paramètres de suivi (utm_*, fbclid, gclid, igsh…). Gardés : le chemin (avec ses majuscules : « /Emma » et « /emma » peuvent différer),
 * les autres paramètres de requête (« ?v=abc » désigne une vidéo), le fragment (« #contact »).
 */
export function destinationKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host) return null;
  const port = u.port && !((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) ? `:${u.port}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  const pairs: [string, string][] = [];
  for (const [k, v] of u.searchParams) if (!isTracking(k)) pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const query = pairs.length ? "?" + pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
  return `${host}${port}${path}${query}${u.hash && u.hash !== "#" ? u.hash : ""}`;
}
