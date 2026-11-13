import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { siteUrl, UPLOADS_DIR } from "./config";
import { publicOrigin } from "./publicOrigin";
import { getSiteConfig } from "./settings";
import { defaultFaviconSvg } from "./favicon";
import { deriveImage, readImageSize } from "./imageDerive";
import { splitImageRef } from "./imageCrop";
import { pickLogo } from "./logos";
import type { SiteConfig } from "./settings";
import { mimeFor, UPLOAD_NAME_RE } from "./services/uploads";

/**
 * THE ICON OF A SITE, served directly (no redirect): /favicon.ico, /mcp-icon (and so `serverInfo.icons` of the MCP server) all read it here.
 * Source, in order: the site's favicon (Settings → Identity), else its square logo, else the icon generated from the site colours (never nothing).
 * A redirect is avoided on purpose: clients that fetch an icon (browsers probing /favicon.ico, the MCP clients) reject or ignore one that leaves the
 * origin (MCP specification, `icons`: "Disallow scheme changes and redirects to hosts on different origins").
 */
export type SiteIcon = { kind: "bytes"; body: Uint8Array; mime: string; etag: string } | { kind: "external"; url: string };

const etagOf = (body: Uint8Array): string => `"${crypto.createHash("sha1").update(body).digest("hex").slice(0, 20)}"`;
const generated = (config: Pick<SiteConfig, "accent" | "background">): SiteIcon => {
  const body = new TextEncoder().encode(defaultFaviconSvg(config.accent, config.background));
  return { kind: "bytes", body, mime: "image/svg+xml", etag: etagOf(body) };
};

/** The stored address of the icon (an upload with or without its `?c=` framing, or an https address), or null when the site has none. */
export const siteIconRef = (config: Pick<SiteConfig, "logos">): string | null => pickLogo(config.logos, "favicon", false);

export async function loadSiteIcon(config: Pick<SiteConfig, "logos" | "accent" | "background">): Promise<SiteIcon> {
  const ref = siteIconRef(config);
  if (!ref) return generated(config);
  if (/^https:\/\//.test(ref)) return { kind: "external", url: ref };
  const parsed = splitImageRef(ref);
  const name = parsed.path.replace(/^\/uploads\//, "");
  if (!parsed.path.startsWith("/uploads/") || !UPLOAD_NAME_RE.test(name)) return generated(config);
  try {
    if (parsed.crop) {
      const made = await deriveImage(name, parsed.crop, parsed.share);
      if (made.ok) { const body = new Uint8Array(await fs.promises.readFile(made.file)); return { kind: "bytes", body, mime: made.mime, etag: etagOf(body) }; }
    }
    const body = new Uint8Array(await fs.promises.readFile(path.join(UPLOADS_DIR, name)));
    return { kind: "bytes", body, mime: mimeFor(name), etag: etagOf(body) };
  } catch { return generated(config); }
}

/** Icon responses: short cache (the owner can change the logo), validated by ETag, per host, readable by any page (a hosted client may fetch the image). */
export const ICON_HEADERS = { "Cache-Control": "public, max-age=300", Vary: "Host, X-Forwarded-Host", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "X-Content-Type-Options": "nosniff" } as const;
// An svg opened on its own address can run nothing, even if cleaning had a flaw (same policy as /uploads).
const SVG_POLICY = { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };

export function iconResponse(icon: Extract<SiteIcon, { kind: "bytes" }>, request: Request): Response {
  const headers: Record<string, string> = { ...ICON_HEADERS, ETag: icon.etag, "Content-Type": icon.mime, ...(icon.mime === "image/svg+xml" ? SVG_POLICY : {}) };
  if (request.headers.get("if-none-match") === icon.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : (icon.body as BodyInit), { headers: { ...headers, "Content-Length": String(icon.body.byteLength) } });
}

/** `icons` of the MCP `serverInfo`: ONE entry on the exact public host (same origin as the server, as the specification asks). */
export async function mcpIcons(config: Pick<SiteConfig, "logos" | "accent" | "background">, origin: string): Promise<{ src: string; mimeType: string; sizes: string[] }[]> {
  const icon = await loadSiteIcon(config);
  // An outside logo is never fetched by the server (and clients refuse another origin): the generated icon stands in.
  const bytes = icon.kind === "bytes" ? icon : generated(config) as Extract<SiteIcon, { kind: "bytes" }>;
  let sizes = ["any"];
  if (bytes.mime !== "image/svg+xml") {
    const size = await readImageSize(Buffer.from(bytes.body)).catch(() => null);
    if (size && typeof size === "object") sizes = [`${size.width}x${size.height}`];
  }
  return [{ src: `${origin}/mcp-icon?v=${bytes.etag.replace(/"/g, "")}`, mimeType: bytes.mime, sizes }];
}

/** For the MCP routes: the icons of THIS site on the host the request came to (see `ServerIcons` in services/mcp/server.ts). */
export async function mcpServerIcons(request: Request): Promise<unknown[]> {
  return mcpIcons(await getSiteConfig(), publicOrigin(request.headers, siteUrl));
}
