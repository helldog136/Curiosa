import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/config";
import { getActiveInstances } from "@/core/modules/registry";
import { entryPath, listEntries } from "@/core/content/entries";
import { languageAlternates, pageUrl } from "@/core/seo";
import { getSiteConfig } from "@/core/settings";

/**
 * PLAN DU SITE. Un seul fichier (sitemap.xml) tant qu'il tient dans la limite du protocole : 50 000 adresses. Au-delà, on garde les pages fixes
 * (accueil, confidentialité, listes) puis les entrées les plus récentes, l'erreur est écrite UNE fois dans le journal, et la page « Visibilité dans les
 * réponses des IA » affiche un bandeau. Pas de plan en plusieurs fichiers (generateSitemaps) dans cette version.
 */
export const SITEMAP_MAX_URLS = 50_000;

type Url = MetadataRoute.Sitemap[number];
export type SitemapResult = { urls: MetadataRoute.Sitemap; /** Adresses avant troncature. */ total: number; truncated: boolean };

let reported = false;
/** Pour les tests : « une seule fois » repart de zéro. */
export function resetSitemapReport(): void { reported = false; }

/** Garde pure (testable avec 50 001 adresses simulées) : pages fixes d'abord, puis les entrées les plus récentes. */
export function capSitemap(fixed: Url[], entries: Url[], max = SITEMAP_MAX_URLS): SitemapResult {
  const total = fixed.length + entries.length;
  if (total <= max) return { urls: [...fixed, ...entries], total, truncated: false };
  const room = Math.max(0, max - fixed.length);
  const newest = entries
    .map((u, i) => ({ u, i, t: u.lastModified ? new Date(u.lastModified).getTime() : -Infinity }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .slice(0, room)
    .map((x) => x.u);
  return { urls: [...fixed, ...newest].slice(0, max), total, truncated: true };
}

export async function buildSitemap(max = SITEMAP_MAX_URLS): Promise<SitemapResult> {
  const config = await getSiteConfig();
  // Une page qui existe dans toutes les langues déclare ses versions (hreflang) ; une seule langue : pas de bloc inutile.
  const everywhere = (locale: string, path: string): Url => {
    const alt = languageAlternates(siteUrl, config.locales, locale, config.defaultLocale, path);
    return { url: alt.canonical, ...(alt.languages ? { alternates: { languages: alt.languages } } : {}) };
  };
  const fixed: Url[] = config.locales.map((l) => everywhere(l, "/"));
  for (const l of config.locales) fixed.push(everywhere(l, "/privacy"));
  const entryUrls: Url[] = [];
  for (const { instance: collection, mod } of (await getActiveInstances()).filter((a) => a.instance.basePath !== null)) {
    for (const locale of config.locales) {
      if (collection.basePath) fixed.push(everywhere(locale, `/${collection.basePath}`));
      if (!mod.manifest.content || collection.clickAction === "external") continue;
      for (const entry of await listEntries({ instance: collection, locale })) {
        if (entry.locale !== locale) continue; // pas de doublon pour les repli de langue
        const languages = entry.translations.length > 1
          ? Object.fromEntries(entry.translations.filter((tr) => config.locales.includes(tr.locale)).map((tr) => [tr.locale, pageUrl(siteUrl, tr.locale, config.defaultLocale, `${entry.basePath ? `/${entry.basePath}` : ""}/${tr.slug}`)]))
          : undefined;
        // `lastModified` : la date de publication, quand il y en a une (jamais l'heure courante).
        entryUrls.push({ url: `${siteUrl}${entryPath(entry, config.defaultLocale)}`, lastModified: entry.publishedAt ?? undefined, ...(languages && Object.keys(languages).length > 1 ? { alternates: { languages } } : {}) });
      }
    }
  }
  const result = capSitemap(fixed, entryUrls, max);
  if (result.truncated && !reported) {
    reported = true;
    console.error(`[sitemap] ${result.total} addresses, over the limit of ${max}: only the ${max} most recent are listed in sitemap.xml.`);
  }
  return result;
}
