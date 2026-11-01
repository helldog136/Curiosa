import { prisma } from "./db";
import { siteUrl } from "./config";
import { destinationKey } from "./redirectDestination";
import { getSetting } from "./settings";
import { isSafeExternalUrl } from "./url";

/**
 * « COMPTER LES CLICS SUR MES LIENS » : quand le réglage est activé, un bouton du site qui mène à une adresse pour laquelle la personne a un lien court ACTIF
 * passe par ce lien court (qui compte alors le clic, de façon anonyme : voir redirectStats.ts). Désactivé par défaut.
 *
 * Règles (toutes vérifiées par tests/core/redirect-measure.test.mjs) :
 *  - seules les adresses http(s) vers un AUTRE site sont réécrites ; `mailto:`, `tel:`, `javascript:`, `data:`, chemins du site et adresses du site même restent tels quels
 *    (donc jamais de chaîne : un lien déjà court n'est pas réécrit) ;
 *  - « même destination » = même clé que le total par destination (`destinationKey` : casse du domaine, `www.`, barre finale, paramètres de suivi ignorés ; les autres
 *    paramètres comptent) ; le lien court mène donc là où le bouton menait : même site, même page ;
 *  - un lien inactif, terminé (date de fin passée, vérifiée AU MOMENT du rendu) ou inexistant n'est jamais utilisé : le bouton garde son adresse d'origine ;
 *  - plusieurs liens pour la même destination : le plus ancien (puis par ordre alphabétique) est utilisé, toujours le même ;
 *  - une destination qui est une page du site lui-même n'est jamais réécrite (pas de boucle).
 * La carte « destination → lien court » (2 000 liens au plus : chemin et date de fin, jamais de donnée de visiteur) est relue au plus toutes les 30 secondes et aussitôt
 * quand un lien change (invalidateRedirectGate), sans minuteur de fond. Réglage désactivé : aucune lecture de liens.
 */
export const MEASURE_SETTING = "redirects.measureLinks";
const TTL_MS = 30_000;
const RETRY_MS = 5_000;
const MAX_ENTRIES = 2000;
const CHUNK = 500;

export type MeasureEntry = { path: string; expiresAt: number | null };
export type MeasureMap = ReadonlyMap<string, MeasureEntry>;

type State = { map: Map<string, MeasureEntry>; enabled: boolean; at: number; ttl: number; loading: Promise<void> | null };
const g = globalThis as unknown as { curiosaRedirectMeasure?: State };
const state = (): State => (g.curiosaRedirectMeasure ??= { map: new Map(), enabled: false, at: 0, ttl: 0, loading: null });

/** À appeler quand le réglage ou un lien change : le prochain affichage relit la carte. */
export function invalidateRedirectMeasure(): void {
  state().at = 0;
}

export async function isMeasureEnabled(): Promise<boolean> {
  return (await getSetting<boolean>(MEASURE_SETTING)) === true;
}

async function build(now: number): Promise<Map<string, MeasureEntry>> {
  const rows = await prisma.redirect.findMany({
    where: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] },
    orderBy: [{ createdAt: "asc" }, { path: "asc" }], take: MAX_ENTRIES,
    select: { path: true, targetUrl: true, entryId: true, expiresAt: true },
  });
  const entryIds = [...new Set(rows.map((r) => r.entryId).filter((x): x is string => !!x))];
  const entryUrl = new Map<string, string>();
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    for (const e of await prisma.entry.findMany({ where: { id: { in: entryIds.slice(i, i + CHUNK) } }, select: { id: true, url: true }, take: CHUNK })) if (e.url) entryUrl.set(e.id, e.url);
  }
  const hostOfSite = siteHost();
  const map = new Map<string, MeasureEntry>();
  for (const r of rows) {
    const dest = (r.entryId && entryUrl.get(r.entryId)) || r.targetUrl;
    const key = isSafeExternalUrl(dest) ? destinationKey(dest) : null; // même contrôle que resolveRedirect : un lien refusé là ne sert pas ici
    if (!key || map.has(key)) continue;
    if (key.split(/[/:?#]/)[0] === hostOfSite) continue; // une page du site lui-même : jamais réécrite
    map.set(key, { path: r.path, expiresAt: r.expiresAt ? r.expiresAt.getTime() : null });
  }
  return map;
}

/** La carte courante, ou une carte vide si le réglage est désactivé (ou la base indisponible). Ne lève jamais. */
export async function loadMeasureMap(now = Date.now()): Promise<MeasureMap> {
  const s = state();
  if (now - s.at >= s.ttl) {
    if (!s.loading) {
      s.loading = (async () => {
        try {
          s.enabled = await isMeasureEnabled();
          s.map = s.enabled ? await build(now) : new Map();
          s.ttl = TTL_MS;
        } catch {
          s.ttl = RETRY_MS; // base indisponible : on garde la carte d'avant et on réessaie vite
        }
        s.at = Date.now();
      })().finally(() => { s.loading = null; });
    }
    await s.loading;
  }
  return state().enabled ? state().map : new Map();
}

function siteHost(): string {
  try { return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/**
 * Pur : l'adresse à mettre dans le bouton. Renvoie `href` tel quel si rien ne s'applique. `absolute` : l'adresse complète du lien court (pour un e-mail, un flux) ;
 * sinon le chemin du site (`/ig`), qui reste sur le même hôte quelle que soit l'adresse publique réglée.
 */
export function measureHref(map: MeasureMap, href: string, opts: { absolute?: boolean; now?: number } = {}): string {
  if (typeof href !== "string" || map.size === 0 || href.length > 2100 || !/^https?:\/\//i.test(href)) return href;
  let host: string;
  try { host = new URL(href).hostname.toLowerCase().replace(/^www\./, ""); } catch { return href; }
  if (host === siteHost()) return href;
  const key = destinationKey(href);
  const hit = key ? map.get(key) : undefined;
  if (!hit || (hit.expiresAt !== null && hit.expiresAt <= (opts.now ?? Date.now()))) return href;
  return opts.absolute ? `${siteUrl}/${hit.path}` : `/${hit.path}`;
}

/** Commodité : charge la carte (si le réglage est activé) et réécrit une adresse. Ne lève jamais. */
export async function measuredHref(href: string, opts: { absolute?: boolean; now?: number } = {}): Promise<string> {
  try { return measureHref(await loadMeasureMap(opts.now), href, opts); } catch { return href; }
}
