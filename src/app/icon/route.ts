import { defaultFaviconSvg } from "@/core/favicon";
import { getSiteConfig } from "@/core/settings";
import { ICON_HEADERS } from "@/core/siteIcon";

export const dynamic = "force-dynamic";

/** Icône par défaut (sans image envoyée) : couleurs d'accent et de fond du site. Per host (Vary), so subdomains behind one cache never share it. */
export async function GET(): Promise<Response> {
  const config = await getSiteConfig();
  return new Response(defaultFaviconSvg(config.accent, config.background), { headers: { ...ICON_HEADERS, "Content-Type": "image/svg+xml" } });
}
