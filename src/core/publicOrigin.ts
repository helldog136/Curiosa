/**
 * PUBLIC ORIGIN of a site, for every absolute address the core builds from a request (icon addresses, redirects).
 *
 * Behind the reverse proxy the application listens on an internal address (`localhost:300x`): `request.url` carries THAT origin, never the public one.
 * An address built from it (for example a `Location` header) sends the visitor to `https://localhost:3003/...`. Rules, in order:
 *   1. `SITE_URL` (set in .env, one per site) when it is a real address: it always wins, so a visitor-supplied header can never change it;
 *   2. otherwise (SITE_URL left at its development value) the host the reverse proxy forwarded (`X-Forwarded-Host`, first value), then `Host`,
 *      with `X-Forwarded-Proto`: the same trust the passkeys already place in them (core/auth/relying.ts);
 *   3. otherwise SITE_URL as it is.
 * Pure function: no disk, no network.
 */
type HeaderBag = Pick<Headers, "get">;

const DEV_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/i;
const INTERNAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$/i;

export function publicOrigin(headers: HeaderBag, siteUrl: string): string {
  let configured: URL | null = null;
  try { configured = new URL(siteUrl); } catch { /* unreadable: fall through */ }
  if (configured && !DEV_URL.test(configured.origin)) return configured.origin;
  const first = (name: string) => (headers.get(name) ?? "").split(",")[0]!.trim();
  const host = first("x-forwarded-host") || first("host");
  if (host && HOST.test(host) && !INTERNAL_HOST.test(host)) {
    const proto = first("x-forwarded-proto").toLowerCase() === "https" ? "https" : "http";
    return `${proto}://${host.toLowerCase()}`;
  }
  return configured ? configured.origin : "http://localhost:3000";
}

/** A path-only `Location`: the browser resolves it against the address it asked for, so it is always on the public host, whatever the internal origin. */
export const relativeLocation = (path: string): string => (path.startsWith("/") && !path.startsWith("//") ? path : `/${path.replace(/^\/+/, "")}`);
