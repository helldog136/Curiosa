/**
 * ACCESS TO A PRIVATE REPOSITORY (core 0.42.0) : the owner pastes a read-only access code (a GitHub fine-grained token limited to ONE repository) so that a
 * skin or a custom module can be installed and updated from a private repository. Rules that never bend:
 *   - ONE code per repository (`owner/repo` on github.com), never one for a whole account or host;
 *   - the code is stored SEALED (AES-256-GCM, key from the site secret) in the setting `git.secret.access` (the key name makes the readable backup summary mask it;
 *     the backup carries only the ciphertext, and the site secret is not in the backup, so a restore on another server asks for the code again);
 *   - it reaches git ONLY through the environment of the child process, inside the single `git()` helper (modules/installer.ts): never in a URL, never in argv,
 *     never in `.git/config` (the checkout of a module stays on disk and its code can read it), never in a log, a journal line, an error, an MCP answer or a page;
 *   - the header is scoped to the exact repository address (`http.<url>.extraheader`). That is defence in depth only: real git re-applies its extra headers after a
 *     redirect, so every call that carries a code also forbids redirects and any protocol but https (see `runGit`).
 * This file holds no network code: the check that a code works is in gitAccessAdmin.ts.
 */
import { prisma } from "./db";
import { seal, unseal } from "./seal";

export const ACCESS_SETTING = "git.secret.access";
const PURPOSE = "git-access-seal";
/** GitHub only, for now (the allowed-hosts list of the installer is kept for the address itself). */
export const ACCESS_HOST = "github.com";

/** A fine-grained token: the only kind that can be limited to one repository and to read-only. */
export const FINE_GRAINED_RE = /^github_pat_[A-Za-z0-9_]{22,255}$/;
/** Classic and other broad tokens (read and write on every private repository): refused with an explanation. */
const BROAD_RE = /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/;

export type CodeCheck = "ok" | "empty" | "broad" | "format";
export function checkCodeFormat(code: string): CodeCheck {
  const c = code.trim();
  if (!c) return "empty";
  if (BROAD_RE.test(c)) return "broad";
  return FINE_GRAINED_RE.test(c) ? "ok" : "format";
}

/** `owner/repo` (lowercase) of a github.com repository address, or null (another host, another shape). Accepts `https://github.com/owner/repo[.git][/]`. */
/**
 * Test seam ONLY (nothing in the product sets it): lets tests use a real git against a local server on 127.0.0.1 (any port) instead of github.com, so that what git
 * really does with the header (redirects, partial clones) is tested and not only what the core hands to it.
 */
export const testSeam = { loopback: false };

export function accessTarget(url: string | null | undefined): { host: string; repo: string } | null {
  const raw = String(url ?? "");
  if (/[\u0000-\u0020\u007f]/.test(raw)) return null;   // a tab or a line break would be silently dropped by the URL parser, but not by git
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (testSeam.loopback && u.protocol === "http:" && u.hostname === "127.0.0.1" && !u.username && !u.password && !u.search && !u.hash) {
    const m = /^\/([\w.-]{1,39})\/([\w.-]{1,100}?)(?:\.git)?\/?$/.exec(u.pathname);
    return m ? { host: `127.0.0.1:${u.port}`, repo: `${m[1]}/${m[2]}`.toLowerCase() } : null;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== ACCESS_HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  const m = /^\/([A-Za-z0-9][\w.-]{0,38})\/([\w.-]{1,100}?)(?:\.git)?\/?$/.exec(u.pathname);
  return m ? { host: ACCESS_HOST, repo: `${m[1]}/${m[2]}`.toLowerCase() } : null;
}

type Entry = { host: string; repo: string; sealed: string; savedAt: string };

/** The ciphertext is bound to its repository: an entry moved to another repository by someone who can write the database no longer opens. */
const aadOf = (e: { host: string; repo: string }): string => `${e.host}/${e.repo}`;

async function readEntries(): Promise<Entry[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key_locale: { key: ACCESS_SETTING, locale: "" } } });
    const v = row ? JSON.parse(row.value) : null;
    const list = Array.isArray(v?.entries) ? v.entries : [];
    return list.filter((e: Entry) => e && typeof e.repo === "string" && typeof e.sealed === "string" && typeof e.host === "string");
  } catch { return []; }
}

async function writeEntries(entries: Entry[]): Promise<void> {
  if (!entries.length) { await prisma.setting.deleteMany({ where: { key: ACCESS_SETTING } }); return; }
  const json = JSON.stringify({ v: 1, entries });
  await prisma.setting.upsert({ where: { key_locale: { key: ACCESS_SETTING, locale: "" } }, create: { key: ACCESS_SETTING, locale: "", value: json }, update: { value: json } });
}

/** The code of that repository, or null (none saved, or sealed with another site secret). Only `git()` and the check of a new code call this. */
export async function accessCodeFor(url: string | null | undefined): Promise<string | null> {
  const t = accessTarget(url);
  if (!t) return null;
  const e = (await readEntries()).find((x) => x.host === t.host && x.repo === t.repo);
  const code = e ? unseal(PURPOSE, e.sealed, aadOf(e)) : null;
  return code && FINE_GRAINED_RE.test(code) ? code : null;
}

/** "configured": a code is saved and readable. "reenter": one is saved but cannot be read (a backup restored on another server). "none": nothing. */
export type AccessState = { state: "none" | "configured" | "reenter"; repo?: string; savedAt?: string };
export async function accessState(url: string | null | undefined): Promise<AccessState> {
  const t = accessTarget(url);
  if (!t) return { state: "none" };
  const e = (await readEntries()).find((x) => x.host === t.host && x.repo === t.repo);
  if (!e) return { state: "none", repo: t.repo };
  return { state: unseal(PURPOSE, e.sealed, aadOf(e)) ? "configured" : "reenter", repo: t.repo, savedAt: e.savedAt };
}

/** True when at least one code is saved (a cheap test before looking at the `origin` of a checkout). */
export async function hasAnyAccess(): Promise<boolean> { return (await readEntries()).length > 0; }

/** The saved repositories, without any secret (for a summary line). */
export async function listAccess(): Promise<{ repo: string; savedAt: string; readable: boolean }[]> {
  return (await readEntries()).map((e) => ({ repo: e.repo, savedAt: e.savedAt, readable: !!unseal(PURPOSE, e.sealed, aadOf(e)) }));
}

/** Stores (or replaces) the code of one repository, sealed. The caller has already checked that the code works. */
export async function storeAccess(url: string, code: string): Promise<boolean> {
  const t = accessTarget(url);
  if (!t || checkCodeFormat(code) !== "ok") return false;
  const rest = (await readEntries()).filter((e) => !(e.host === t.host && e.repo === t.repo));
  await writeEntries([...rest, { host: t.host, repo: t.repo, sealed: seal(PURPOSE, code.trim(), `${t.host}/${t.repo}`), savedAt: new Date().toISOString() }].sort((a, b) => (a.repo < b.repo ? -1 : 1)));
  return true;
}

export async function removeAccess(url: string): Promise<boolean> {
  const t = accessTarget(url);
  if (!t) return false;
  const all = await readEntries();
  const rest = all.filter((e) => !(e.host === t.host && e.repo === t.repo));
  if (rest.length === all.length) return false;
  await writeEntries(rest);
  return true;
}

/**
 * The environment that makes git send the code to ONE repository address (and to nothing else). `url` is the address exactly as git will use it; both spellings
 * (with and without `.git`) are scoped, because git matches the path on whole segments. The value is `Authorization: Basic base64("x-access-token:<code>")`.
 */
export function accessEnv(url: string, code: string, inherited: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const base = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${code}`).toString("base64")}`;
  const scopes = [base, `${base}.git`];
  // Entries of the environment (GIT_CONFIG_COUNT/KEY/VALUE) are kept: ours are added after them.
  const n = Math.max(0, Math.min(64, Number.parseInt(inherited.GIT_CONFIG_COUNT ?? "0", 10) || 0));
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(n + scopes.length) };
  scopes.forEach((s, i) => { env[`GIT_CONFIG_KEY_${n + i}`] = `http.${s}.extraheader`; env[`GIT_CONFIG_VALUE_${n + i}`] = header; });
  return env;
}

/**
 * Text of a git failure with the code removed: the code itself, its encoded forms, and anything that looks like a GitHub code or an Authorization header. Nothing
 * else is touched (commit ids, paths and long words stay readable in the operator's logs).
 */
export function scrub(text: unknown, code?: string | null): string {
  let s = typeof text === "string" ? text : text instanceof Error ? text.message : String(text ?? "");
  if (code) {
    const b64 = Buffer.from(`x-access-token:${code}`).toString("base64");
    for (const secret of [code, b64, encodeURIComponent(code)]) if (secret) s = s.split(secret).join("[masked]");
  }
  return s
    .replace(/\b(github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9]{16,})/g, "[masked]")
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)[A-Za-z0-9+/=._~-]+/gi, "$1[masked]")
    .replace(/(x-access-token:)[^\s@/]+/gi, "$1[masked]")
    .slice(0, 4000);
}

/** A refusal by the host: wrong or expired code, no access, or no such repository (GitHub answers "not found" for a private one: the two read the same on purpose). */
export function isAccessRefusal(stderr: string): boolean {
  return /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Repository not found|returned error: (401|403|404)|HTTP Basic: Access denied|Invalid username or password|Permission denied|access denied/i.test(stderr);
}

/** Thrown by `git()` for a refusal by the host. Carries no text from git. */
export class GitAccessError extends Error {
  /** A translation key: code paths that hand `error.code` to the page (module updates) show the right sentence. */
  readonly code = "modules.error.access";
  constructor() { super("git: access refused or repository not found"); this.name = "GitAccessError"; }
}
export const isGitAccessError = (e: unknown): e is GitAccessError => e instanceof GitAccessError || (e as { code?: string } | null)?.code === "modules.error.access";
