/**
 * HOST NAMES: the one place that normalises and compares them, and the two rule sets that judge whether a host name is acceptable.
 *
 * Pure functions, no database, no network. Several spellings of "the same site" exist on purpose, because the callers disagree on the trailing dot:
 *
 *   bareHost / bareHostOf / sameHost    lower case, leading "www." removed. The trailing dot is KEPT ("example.com." stays distinct).
 *   canonicalHost / sameSiteHost        lower case, ONE trailing dot removed, leading "www." removed.
 *   hostOf                              lower case, trailing dot removed, "www." kept (the site's own host name, as `SITE_URL` spells it).
 *
 * Do not merge the two families without a decision: they answer differently for "example.com." (see tests/core/host.test.mjs, which pins both).
 */

/** Lower case and without a leading "www.": `www.Site.be` and `site.be` are the same site. A trailing dot is kept. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/** `bareHost` of the host name of an address; "" when the address cannot be read. */
export function bareHostOf(url: string): string {
  try { return bareHost(new URL(url).hostname); } catch { return ""; }
}

/** Two host names are the same site: case and a leading "www." are ignored (a trailing dot is not). Two empty names are equal. */
export const sameHost = (a: string, b: string): boolean => bareHost(a) === bareHost(b);

/** Lower case, one trailing dot and a leading "www." removed. */
export const canonicalHost = (host: string): string => host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

/** Same site, ignoring case, the trailing dot and a leading "www."; false when either name is empty. */
export function sameSiteHost(a: string, b: string): boolean {
  return !!a && !!b && canonicalHost(a) === canonicalHost(b);
}

/** The host name of an address (a site's `SITE_URL`): lower case, without a trailing dot, "www." kept; "" when the address cannot be read. */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}

/* ───────────── Rule set 1: what the SERVER may visit (anti-SSRF) ───────────── */

const INTERNAL_SUFFIX = /\.(localhost|local|localdomain|internal|intranet|private|lan|home|corp|home\.arpa)$/i;

export type FetchTargetProblem = "scheme" | "credentials" | "port" | "address" | "internal" | "invalid";

/**
 * Why the server must not visit this address (null: it may, subject to name resolution: `addressIsPrivate` in url.ts).
 * Refuses: a scheme other than http(s), credentials in the address, a port other than 443 (80 for http), a numeric address (IPv4 in every spelling, IPv6),
 * an internal name (`localhost`, `.local`, `.lan`, a name without a dot...). Used by every outgoing visit of content-supplied addresses.
 */
export function fetchTargetProblem(input: URL | string): FetchTargetProblem | null {
  let url: URL;
  try { url = input instanceof URL ? input : new URL(String(input)); } catch { return "invalid"; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "scheme";
  if (url.username || url.password) return "credentials";
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return "port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return "invalid";
  if (host.startsWith("[") || host.includes(":")) return "address";
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return "address"; // 127.0.0.1, 2130706433, 0x7f000001... (the URL parser already normalises them)
  if (!host.includes(".") || host === "localhost" || INTERNAL_SUFFIX.test(host)) return "internal";
  if (!/^[a-z0-9._-]+$/.test(host)) return "invalid"; // international names: already converted to "xn--" by the URL parser
  return null;
}

/* ───────────── Rule set 2: what may be the site's PUBLIC address ───────────── */

/** A public domain name: labels of letters, digits and hyphens, at least one dot, an alphabetic ending (".be", ".com"). No numeric address. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;
/** Name endings that designate a private network: refused for a public site. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".corp", ".intranet", ".test", ".invalid", ".example"];

export type PublicHostProblem = "empty" | "form" | "ip" | "local" | "invalid" | "toolong";

/** Checks a domain NAME (already lower case, without port or scheme). Returns the problem, or null when it suits a public site. */
export function publicHostProblem(host: string): PublicHostProblem | null {
  if (!host) return "empty";
  if (host.length > 253) return "toolong";
  if (/^\[.*\]$/.test(host) || host.includes(":")) return "ip";
  if (/^\d+(?:\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return "ip";
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return "local";
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !LABEL.test(l))) return "invalid";
  if (!TLD.test(labels[labels.length - 1]!)) return "invalid";
  return null;
}
