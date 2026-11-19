/**
 * The environment and the fixed options of EVERY git child process the core starts (core 0.42.0, security review of PR #251).
 *
 * - ALLOW-LIST, not a copy of `process.env`: the site secret and every other secret of the server never reach git (nor the hooks, filters and helpers git may start).
 *   Only what git really needs is passed: PATH and HOME, the temporary folder, the locale, the proxy and CA settings of the host, and a few `GIT_*` settings.
 * - `GIT_LFS_SKIP_SMUDGE=1`, plus `filter.lfs.*` emptied on the command line: a repository that declares a Large File Storage filter never makes git-lfs run, so no
 *   request leaves for an address chosen by the repository (`.lfsconfig`) and git-lfs never writes the access header into `.git/lfs/logs/`.
 */
const EXACT = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "TZ", "LANG", "LANGUAGE",
  "SYSTEMROOT", "COMSPEC", "PATHEXT", "WINDIR",
  "XDG_CONFIG_HOME",
  // proxy and certificate settings of the host (both spellings)
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
  "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_EXEC_PATH", "GIT_TEMPLATE_DIR",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE",
  "GIT_CONFIG_COUNT",
]);
const PATTERN = /^(?:LC_[A-Z_]+|GIT_CONFIG_(?:KEY|VALUE)_\d{1,3})$/;

/** What a git child gets: the allowed variables of this process, then `extra` (set by the core), then the fixed settings that nothing overrides. */
export function gitChildEnv(extra: Record<string, string | undefined> = {}, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(source)) if (v !== undefined && (EXACT.has(k) || PATTERN.test(k))) env[k] = v;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  // GIT_ASKPASS "true": a question from git is answered with nothing (it used to be "echo", which answered with the question itself).
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true", GIT_LFS_SKIP_SMUDGE: "1" };
}

/** Command-line options for every git child: no Large File Storage filter, ever. */
export const GIT_NO_LFS_ARGS = ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false"] as const;
