import type { MetadataRoute } from "next";
import { siteUrl } from "@/core/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/m/"] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
