import { getSiteConfig } from "@/core/settings";
import { iconResponse, loadSiteIcon } from "@/core/siteIcon";

export const dynamic = "force-dynamic";

/**
 * Browsers, icon fetchers and MCP clients ask for /favicon.ico by default: the site's icon is answered HERE, with its own content type (no redirect).
 * The old redirect was built from the internal address behind the reverse proxy (`Location: https://localhost:3003/...`), so those clients never got an icon.
 */
async function serve(request: Request): Promise<Response> {
  const icon = await loadSiteIcon(await getSiteConfig());
  // An icon kept on another site (an https address typed in the settings): a redirect to that address, never to an internal one.
  if (icon.kind === "external") return new Response(null, { status: 302, headers: { Location: icon.url, "Cache-Control": "public, max-age=300", Vary: "Host, X-Forwarded-Host" } });
  return iconResponse(icon, request);
}
export const GET = serve;
export const HEAD = serve;
