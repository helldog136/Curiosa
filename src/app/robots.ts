import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/config";
import { robotsRules } from "@/core/seo";
import { getSetting } from "@/core/settings";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const blockAi = (await getSetting<boolean>("seo.blockAiBots").catch(() => undefined)) !== false;
  return { rules: robotsRules(blockAi), sitemap: `${siteUrl}/sitemap.xml` };
}
