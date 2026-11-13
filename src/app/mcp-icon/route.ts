import { getSiteConfig } from "@/core/settings";
import { iconResponse, loadSiteIcon, ICON_HEADERS } from "@/core/siteIcon";
import { defaultFaviconSvg } from "@/core/favicon";

export const dynamic = "force-dynamic";

/** The icon announced to MCP clients (`serverInfo.icons`): same image as /favicon.ico, always served directly, never redirected, no credentials needed. */
async function serve(request: Request): Promise<Response> {
  const config = await getSiteConfig();
  const icon = await loadSiteIcon(config);
  if (icon.kind === "bytes") return iconResponse(icon, request);
  return new Response(defaultFaviconSvg(config.accent, config.background), { headers: { ...ICON_HEADERS, "Content-Type": "image/svg+xml" } });
}
export const GET = serve;
export const HEAD = serve;
