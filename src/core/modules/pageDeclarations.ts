import { cleanSitemapPaths, pageRobots } from "./pageMeta";
import { hasPublicPage } from "./publicPage";
import { runPage } from "./runtime";
import type { ActiveInstance } from "./registry";

/**
 * Ce qu'une page de module DÉCLARE pour le plan du site et llms.txt (cœur 0.3.0) : « noindex » et chemins supplémentaires, lus sur la page de l'instance.
 *
 * Sûreté : le cœur n'exécute `page()` pour cela QUE si le module le demande (`sitemapFromPage` dans module.json). Un module existant n'est donc jamais appelé
 * par le plan du site : rien ne change pour lui (pas de visite comptée, pas de coût). La réponse est gardée 60 secondes (un robot qui lit le plan
 * ne fait pas tourner le module à chaque lecture), 200 instances au plus, et chaque chemin est nettoyé par `cleanSitemapPaths`.
 */
export type PageDeclarations = { noindex: boolean; paths: string[] };
export const NO_DECLARATIONS: PageDeclarations = { noindex: false, paths: [] };

const TTL_MS = 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; value: PageDeclarations }>();

/** Pour les tests. */
export function resetPageDeclarations(): void { cache.clear(); }

export async function pageDeclarations(active: ActiveInstance, defaultLocale: string, now = Date.now()): Promise<PageDeclarations> {
  if (!active.mod.manifest.sitemapFromPage || !active.mod.def.page || !hasPublicPage(active)) return NO_DECLARATIONS;
  const key = `${active.instance.id}@${active.mod.manifest.version}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  let value = NO_DECLARATIONS;
  try {
    const page = await runPage(active.instance.key, [], defaultLocale, "sitemap");
    if (page && !page.notFound) value = { noindex: pageRobots(page.robots) === "noindex", paths: cleanSitemapPaths(page.sitemap, active.instance.basePath) };
  } catch {
    value = NO_DECLARATIONS;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now, value });
  return value;
}
