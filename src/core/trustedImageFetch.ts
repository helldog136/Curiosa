import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { addressIsPrivate } from "@/core/url";
import { pinnedLookup, resolveHost, type Resolver } from "@/core/maintenance/content/net";
import { McpToolError } from "@/core/services/mcp/validate";
import { matchSource, type TrustedSource } from "@/core/trustedImageSources";

/**
 * THE ONLY PLACE WHERE THE SITE DOWNLOADS AN IMAGE FROM AN ADDRESS, and it is used by `media_import` and nothing else.
 *
 * Every rule below is a line of the threat table in docs/MAINTENANCE-IA.md and has its own test (tests/services/mcp-media-import.test.mjs):
 *   - https only; no user name or password in the address; the host is the EXACT text of an entry of the owner's list, the port too, the path by whole segments;
 *   - no IP number as a host; the name is resolved ONCE and every address must be public (private, loopback, link-local, shared 100.64/10, metadata, IPv4 and
 *     IPv6 including IPv4-mapped forms: `addressIsPrivate`); the connection is then opened to the verified addresses only (pinned lookup, no second resolution:
 *     no DNS rebinding);
 *   - a redirect is followed at most twice, and each hop goes through all of the above again (so it must match the list too);
 *   - one 10 second deadline for the whole image (name, connection, redirects, body); the body is read as a stream and cut at 3 MB;
 *   - no cookie, no credential, no header from the caller; a fixed User-Agent; no compression accepted (nothing to inflate);
 *   - the answer is only BYTES: what they are is decided by the caller from the bytes, never from the type the server announces.
 */
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
export const IMPORT_TIMEOUT_MS = 10_000;
export const IMPORT_MAX_REDIRECTS = 2;
export const IMPORT_USER_AGENT = "Curiosa-ImageImport/1 (+https://github.com/helldog136/Curiosa)";
const ADMIN_PLACE = "Admin > AI assistants > Trusted image sources";

/** Replaceable in tests only (a fake name server, a short deadline). */
export const importDeps: { resolve: Resolver; timeoutMs: number } = { resolve: resolveHost, timeoutMs: IMPORT_TIMEOUT_MS };
export function resetImportDeps(): void { importDeps.resolve = resolveHost; importDeps.timeoutMs = IMPORT_TIMEOUT_MS; }

/**
 * TESTS ONLY: lets the tests talk to a server of their own on 127.0.0.1 over plain http. It opens nothing else: only the address 127.0.0.1 is exempt from the
 * public-address rule, and it is ignored when NODE_ENV is "production".
 */
const testLocal = (): boolean => process.env.CURIOSA_TEST_IMPORT_LOCAL === "1" && process.env.NODE_ENV !== "production";

/** Host and path without the query, for messages and the journal (a query can hold a secret). */
export const shown = (url: URL): string => `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);

/** Everything that can be decided from the address and the list alone, without the network. `hop` > 0: the address came from a redirection. */
export function checkTrustedUrl(raw: string, sources: readonly TrustedSource[], hop = 0): { url: URL; source: TrustedSource } {
  const what = hop > 0 ? "The redirection target" : "This address";
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new McpToolError(`"${String(raw).slice(0, 80)}" is not a web address. Write it in full, for example https://images.example.org/screens/home.png.`); }
  if (url.protocol !== "https:" && !(testLocal() && url.protocol === "http:")) throw new McpToolError(`${what} must start with https:// (other kinds of address are never fetched).`);
  if (url.username || url.password) throw new McpToolError(`${what} contains a user name or a password (the part before @). This is refused: write the plain address.`);
  if (url.hostname.startsWith("[") || isIP(url.hostname) !== 0) throw new McpToolError(`${what} uses a number instead of a site name. Only site names from the trusted list are fetched.`);
  const source = matchSource(url, sources);
  if (!source) throw new McpToolError(`${what} (${shown(url)}) is not in the trusted image sources. The owner can add it in ${ADMIN_PLACE}; until then, send the image itself with media_upload.`);
  return { url, source };
}

/** The name is resolved once; every address must be public. Returns the verified addresses. */
async function verifiedAddresses(url: URL): Promise<string[]> {
  const found = await importDeps.resolve(url.hostname);
  if (!found.ok) throw new McpToolError(found.reason === "notfound" ? `The site name ${url.hostname} cannot be found. Check the address.` : `The site name ${url.hostname} did not answer in time. Try again later.`);
  const exempt = (a: string) => testLocal() && a === "127.0.0.1";
  if (found.addresses.some((a) => addressIsPrivate(a) && !exempt(a))) throw new McpToolError(`${url.hostname} points to a private or internal network address. This is refused for safety: nothing was downloaded.`);
  return found.addresses;
}

type Hop = { redirect: string } | { body: Buffer };

function fetchOnce(url: URL, addresses: string[], signal: AbortSignal): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const secure = url.protocol === "https:";
    const transport = secure ? https : http;
    let done = false;
    const fail = (error: Error) => { if (!done) { done = true; reject(error); } };
    const req = transport.request({
      host: url.hostname, port: url.port ? Number(url.port) : secure ? 443 : 80, path: `${url.pathname}${url.search}`, method: "GET", agent: false,
      headers: { "user-agent": IMPORT_USER_AGENT, accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml;q=0.8", "accept-encoding": "identity", connection: "close" },
      ...(secure ? { servername: url.hostname } : {}),
      lookup: pinnedLookup(addresses, testLocal() && addresses.every((a) => a === "127.0.0.1")) as never,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location;
        res.resume(); req.destroy();
        if (!location || location.length > 2048) return fail(new McpToolError("The site answered with a redirection that has no usable destination."));
        if (!done) { done = true; resolve({ redirect: location }); }
        return;
      }
      if (status !== 200) { res.resume(); req.destroy(); return fail(new McpToolError(`The site answered with status ${status} instead of an image. Check that the address is right and public.`)); }
      const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
      if (encoding !== "identity") { req.destroy(); return fail(new McpToolError("The site sent a compressed answer, which is not accepted for an image.")); }
      const tooBig = () => new McpToolError(`The image is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB. Use a smaller or compressed version (for example a 1600 pixel wide webp) and import it again.`);
      const length = Number(res.headers["content-length"]);
      if (Number.isFinite(length) && length > IMPORT_MAX_BYTES) { req.destroy(); return fail(tooBig()); }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > IMPORT_MAX_BYTES) { chunks.length = 0; req.destroy(); return fail(tooBig()); }
        chunks.push(chunk);
      });
      res.on("end", () => { if (!done) { done = true; resolve({ body: Buffer.concat(chunks) }); } });
      res.on("error", () => fail(new McpToolError("The download was interrupted. Try again.")));
      res.on("aborted", () => fail(new McpToolError("The download was interrupted. Try again.")));
    });
    const onAbort = () => { req.destroy(); fail(new McpToolError(`The site did not answer within ${Math.round(importDeps.timeoutMs / 1000)} seconds. Try again later.`)); };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", () => fail(new McpToolError("The site could not be reached (connection or certificate problem). Check the address and try again.")));
    req.end();
  });
}

/** Downloads one image from a trusted source. Returns the bytes and the address they finally came from. */
export async function fetchTrustedImage(raw: string, sources: readonly TrustedSource[]): Promise<{ bytes: Buffer; from: URL; requested: URL }> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), importDeps.timeoutMs);
  try {
    let current = raw;
    let first: URL | null = null;
    const seen = new Set<string>();
    for (let redirects = 0; ; redirects++) {
      const { url } = checkTrustedUrl(current, sources, redirects);
      first ??= url;
      const key = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
      if (seen.has(key)) throw new McpToolError("The address redirects in a circle. Use the final address of the image.");
      seen.add(key);
      const addresses = await verifiedAddresses(url);
      if (control.signal.aborted) throw new McpToolError(`The site did not answer within ${Math.round(importDeps.timeoutMs / 1000)} seconds. Try again later.`);
      const hop = await fetchOnce(url, addresses, control.signal);
      if ("body" in hop) return { bytes: hop.body, from: url, requested: first };
      if (redirects >= IMPORT_MAX_REDIRECTS) throw new McpToolError(`The address redirects more than ${IMPORT_MAX_REDIRECTS} times. Use the final address of the image.`);
      try { current = new URL(hop.redirect, url).href; } catch { throw new McpToolError("The site answered with a redirection that has no usable destination."); }
    }
  } finally { clearTimeout(timer); }
}
