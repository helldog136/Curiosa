/**
 * ACCESS TO A PRIVATE REPOSITORY (core 0.42.0) : the owner pastes a read-only access code (a GitHub fine-grained token limited to ONE repository) so that a
 * skin or a custom module can be installed and updated from a private repository. Rules that never bend:
 *   - ONE code per repository (`owner/repo` on github.com), never one for a whole account or host;
 *   - the code is stored SEALED (AES-256-GCM, key from the site secret) in the setting `git.secret.access` (the key name makes the readable backup summary mask it;
 *     the backup carries only the ciphertext, and the site secret is not in the backup, so a restore on another server asks for the code again);
 *   - it reaches git ONLY through the environment of the child process, inside the single `git()` helper (modules/installer.ts): never in a URL, never in argv,
 *     never in `.git/config` (the checkout of a module stays on disk and its code can read it), never in a log, a journal line, an error, an MCP answer or a page;
 *   - the header is scoped to the exact repository address (`http.<url>.extraheader`), so a redirect to another host or another path does not carry it.
 * This file holds no network code: the check that a code works is in gitAccessAdmin.ts.
 */
import { prisma } from "./db";
import { seal, unseal } from "./seal";
import { redactSecrets } from "./maintenance/redact";

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
export function accessTarget(url: string | null | undefined): { host: string; repo: string } | null {
  let u: URL;
  try { u = new URL(String(url ?? "")); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== ACCESS_HOST || u.username || u.password || u.search) return null;
  const m = /^\/([A-Za-z0-9][\w.-]{0,38})\/([\w.-]{1,100}?)(?:\.git)?\/?$/.exec(u.pathname);
  return m ? { host: ACCESS_HOST, repo: `${m[1]}/${m[2]}`.toLowerCase() } : null;
}

type Entry = { host: string; repo: string; sealed: string; savedAt: string };

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
  const code = e ? unseal(PURPOSE, e.sealed) : null;
  return code && FINE_GRAINED_RE.test(code) ? code : null;
}

/** "configured": a code is saved and readable. "reenter": one is saved but cannot be read (a backup restored on another server). "none": nothing. */
export type AccessState = { state: "none" | "configured" | "reenter"; repo?: string; savedAt?: string };
export async function accessState(url: string | null | undefined): Promise<AccessState> {
  const t = accessTarget(url);
  if (!t) return { state: "none" };
  const e = (await readEntries()).find((x) => x.host === t.host && x.repo === t.repo);
  if (!e) return { state: "none", repo: t.repo };
  return { state: unseal(PURPOSE, e.sealed) ? "configured" : "reenter", repo: t.repo, savedAt: e.savedAt };
}

/** The saved repositories, without any secret (for a summary line). */
export async function listAccess(): Promise<{ repo: string; savedAt: string; readable: boolean }[]> {
  return (await readEntries()).map((e) => ({ repo: e.repo, savedAt: e.savedAt, readable: !!unseal(PURPOSE, e.sealed) }));
}

/** Stores (or replaces) the code of one repository, sealed. The caller has already checked that the code works. */
export async function storeAccess(url: string, code: string): Promise<boolean> {
  const t = accessTarget(url);
  if (!t || checkCodeFormat(code) !== "ok") return false;
  const rest = (await readEntries()).filter((e) => !(e.host === t.host && e.repo === t.repo));
  await writeEntries([...rest, { host: t.host, repo: t.repo, sealed: seal(PURPOSE, code.trim()), savedAt: new Date().toISOString() }].sort((a, b) => (a.repo < b.repo ? -1 : 1)));
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

/** Text of a git failure with the code (and its encoded form) removed, whatever else it holds. */
export function scrub(text: unknown, code?: string | null): string {
  let s = typeof text === "string" ? text : text instanceof Error ? text.message : String(text ?? "");
  if (code) {
    const b64 = Buffer.from(`x-access-token:${code}`).toString("base64");
    for (const secret of [code, b64, encodeURIComponent(code)]) if (secret) s = s.split(secret).join("[masked]");
  }
  return redactSecrets(s, 4000);
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
