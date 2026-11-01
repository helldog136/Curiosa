import type { MetadataRoute } from "next";
import { buildSitemap } from "@/core/sitemap";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await buildSitemap()).urls;
}
