import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/config";
import { getActiveInstances } from "@/core/modules/registry";
import { entryPath, listEntries } from "@/core/content/entries";
import { languageAlternates, pageUrl } from "@/core/seo";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = await getSiteConfig();
  // Une page qui existe dans toutes les langues déclare ses versions (hreflang) ; une seule langue : pas de bloc inutile.
  const everywhere = (locale: string, path: string): MetadataRoute.Sitemap[number] => {
    const alt = languageAlternates(siteUrl, config.locales, locale, config.defaultLocale, path);
    return { url: alt.canonical, ...(alt.languages ? { alternates: { languages: alt.languages } } : {}) };
  };
  const urls: MetadataRoute.Sitemap = config.locales.map((l) => everywhere(l, "/"));
  for (const l of config.locales) urls.push(everywhere(l, "/privacy"));
  for (const { instance: collection, mod } of (await getActiveInstances()).filter((a) => a.instance.basePath !== null)) {
    for (const locale of config.locales) {
      if (collection.basePath) urls.push(everywhere(locale, `/${collection.basePath}`));
      if (!mod.manifest.content || collection.clickAction === "external") continue;
      for (const entry of await listEntries({ instance: collection, locale })) {
        if (entry.locale !== locale) continue; // pas de doublon pour les repli de langue
        const languages = entry.translations.length > 1
          ? Object.fromEntries(entry.translations.filter((tr) => config.locales.includes(tr.locale)).map((tr) => [tr.locale, pageUrl(siteUrl, tr.locale, config.defaultLocale, `${entry.basePath ? `/${entry.basePath}` : ""}/${tr.slug}`)]))
          : undefined;
        // `lastModified` : la date de publication, quand il y en a une (jamais l'heure courante).
        urls.push({ url: `${siteUrl}${entryPath(entry, config.defaultLocale)}`, lastModified: entry.publishedAt ?? undefined, ...(languages && Object.keys(languages).length > 1 ? { alternates: { languages } } : {}) });
      }
    }
  }
  return urls;
}
