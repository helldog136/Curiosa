/**
 * WHY a git command failed, from what git said (core 0.46.2). Pure: no process, no network, no secret. The text it reads has already been through `scrub()`
 * (gitAccess.ts), and nothing of it is returned except a kind and, for a redirect, an address that passes the same check as every other address.
 * Before this, every host refusal was one "refused" and everything else "cannot be reached": a code that git never sent, a repository that moved and a real
 * wrong code all read the same, and the owner could not tell what to change.
 */
export type GitFailureKind =
  | "address"      // git did not understand the address (or refused its protocol)
  | "notFound"     // no such repository, or the code has no right to read it (GitHub answers "not found" for a private one: both read the same on purpose)
  | "rejected"     // the host refused the code itself: wrong, expired or revoked
  | "tooOld"       // git is missing, too old, or did not use the code it was given
  | "unreachable"  // network, name resolution, certificate, timeout
  | "redirect"     // the repository answered with a redirect (renamed or moved); redirects are never followed while a code is attached
  | "unknown";

export type GitFailure = { kind: GitFailureKind; /** Only for "redirect", only when git printed it and it is a plain repository address. */ location?: string };

const TIMEOUT = /timed out|timeout|Operation too slow|Connection timed out/i;
const UNREACHABLE = /Could not resolve (host|proxy)|Failed to connect|Connection refused|Couldn'?t connect|Network is unreachable|No route to host|Connection reset|Empty reply from server|SSL(?: certificate)? (?:problem|connection)|OpenSSL SSL_(?:connect|read)|gnutls_handshake|TLS (?:connect|handshake)|RPC failed|early EOF|unexpected disconnect|Proxy CONNECT aborted|Temporary failure in name resolution/i;
const TOO_OLD = /is not a git command|unknown (?:option|config|switch|subcommand)|unrecognized (?:option|config)|invalid option|bad config (?:line|variable|key)|usage: git|remote-https|command not found|ENOENT|spawn git/i;
const REDIRECT = /returned error: 30[1278]\b|unable to update url base from redirection|redirecting to/i;
const ADDRESS = /does not appear to be a git repository|invalid url|bad\/illegal format|protocol .* not supported|transport '.*' not allowed|Unable to find remote helper|unsupported URL|URL using bad|malformed/i;
const REJECTED = /Authentication failed|Invalid username or password|Bad credentials|HTTP Basic: Access denied|returned error: 401|Support for password authentication was removed|token (?:has )?(?:expired|been revoked)|credentials? (?:are |is )?(?:invalid|expired|revoked)/i;
const NO_CREDENTIAL_ASKED = /could not read (?:Username|Password)|terminal prompts disabled/i;
const NOT_FOUND = /Repository not found|repository '[^']*' not found|returned error: (?:403|404)|Permission to .* denied|Permission denied|access denied|not found|has not been granted|forbidden/i;

/** `https://github.com/owner/repo` out of what git printed after `redirect:`, or undefined. Only the shape is checked here; the caller applies `accessTarget`. */
function locationOf(stderr: string): string | undefined {
  const m = /redirect(?:ing to|ion)?:?\s+(https?:\/\/[^\s'"]+)/i.exec(stderr);
  if (!m) return undefined;
  try {
    const u = new URL(m[1]!);
    if (u.username || u.password) return undefined;
    return `${u.origin}${u.pathname.replace(/\/+$/, "").replace(/\/info\/refs$/, "").replace(/\.git$/, "")}`;
  } catch { return undefined; }
}

/**
 * `credentialsSent`: the call carried an access code. Then "could not read Username" means git never used it (an old git ignores the configuration the code
 * travels in), not that the host refused it. `timedOut`: the process was stopped by the core's own timer.
 */
export function classifyGitFailure(stderr: string, opts: { credentialsSent?: boolean; timedOut?: boolean; missing?: boolean } = {}): GitFailure {
  const s = String(stderr ?? "");
  if (opts.missing) return { kind: "tooOld" };
  if (opts.timedOut || TIMEOUT.test(s)) return { kind: "unreachable" };
  if (UNREACHABLE.test(s)) return { kind: "unreachable" };
  if (TOO_OLD.test(s)) return { kind: "tooOld" };
  if (REDIRECT.test(s)) { const location = locationOf(s); return location ? { kind: "redirect", location } : { kind: "redirect" }; }
  if (NO_CREDENTIAL_ASKED.test(s)) return { kind: opts.credentialsSent ? "tooOld" : "rejected" };
  if (REJECTED.test(s)) return { kind: "rejected" };
  if (NOT_FOUND.test(s)) return { kind: "notFound" };
  if (ADDRESS.test(s)) return { kind: "address" };
  return { kind: "unknown" };
}

/** A failure of the host about the code or the repository: the page asks for (or re-asks) the code. The others are not about the code. */
export const isAccessKind = (k: GitFailureKind): boolean => k === "rejected" || k === "notFound";

/** git ≥ 2.31 reads GIT_CONFIG_COUNT/KEY_n/VALUE_n: the way the header reaches git without being on a command line. */
export function parseGitVersion(text: string): [number, number] | null {
  const m = /git version (\d+)\.(\d+)/i.exec(String(text ?? ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
}
export const supportsEnvConfig = (v: [number, number] | null): boolean => !v || v[0] > 2 || (v[0] === 2 && v[1] >= 31);
