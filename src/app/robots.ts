import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/config";
import { robotsRules } from "@/core/seo";
import { getAiBlocking } from "@/core/seoSettings";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  return { rules: robotsRules(await getAiBlocking()), sitemap: `${siteUrl}/sitemap.xml` };
}
