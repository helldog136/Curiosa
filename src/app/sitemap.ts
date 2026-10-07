import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/config";
import { getActiveInstances } from "@/core/modules/registry";
import { entryPath, listEntries } from "@/core/content/entries";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = await getSiteConfig();
  const urls: MetadataRoute.Sitemap = config.locales.map((l) => ({
    url: `${siteUrl}${l === config.defaultLocale ? "" : `/${l}`}/`,
  }));
  for (const { instance: collection, mod } of (await getActiveInstances()).filter((a) => a.instance.basePath !== null)) {
    for (const locale of config.locales) {
      const prefix = locale === config.defaultLocale ? "" : `/${locale}`;
      if (collection.basePath) urls.push({ url: `${siteUrl}${prefix}/${collection.basePath}` });
      if (!mod.manifest.content || collection.clickAction === "external") continue;
      for (const entry of await listEntries({ instance: collection, locale })) {
        if (entry.locale !== locale) continue; // pas de doublon pour les repli de langue
        urls.push({ url: `${siteUrl}${entryPath(entry, config.defaultLocale)}`, lastModified: entry.publishedAt ?? undefined });
      }
    }
  }
  return urls;
}
