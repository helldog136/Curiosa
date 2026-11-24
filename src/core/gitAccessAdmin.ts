/**
 * Save and remove the access code of a private repository (core 0.42.0; the rules are in gitAccess.ts). A code is stored ONLY after it has been tried against the
 * repository itself: a code that does not work is never kept. The audit lines name the repository, never the code. Owner only (right `core:modules.install`):
 * the callers are the admin pages, never the assistant (MCP) — no tool of the assistant reaches this file.
 */
import { audit } from "./permissions";
import { accessState, accessTarget, checkCodeFormat, removeAccess, storeAccess, type AccessState } from "./gitAccess";
import { gitCheckAccess } from "./modules/installer";
import { failureOf } from "./gitAccess";
import type { GitFailureKind } from "./gitFailure";

/**
 * `error` is a translation key under `access.error.*`. One cause per key (core 0.47.0): the owner reads what to change. `address` (of "redirectTo") is the only
 * variable of a message, and only a plain repository address that passed `accessTarget`.
 */
export type SaveAccessError = "empty" | "broad" | "format" | "address" | "notFound" | "rejected" | "tooOld" | "unreachable" | "redirect" | "redirectTo" | "unknown";
export type SaveAccessResult = { ok: true; repo: string } | { ok: false; error: SaveAccessError; address?: string };

/** Where a renamed or moved repository now lives, read WITHOUT any code (a plain request, redirect not followed), or undefined. Shown only when it is a repository address. */
async function movedTo(url: string): Promise<string | undefined> {
  try {
    const first = `${url.replace(/\/+$/, "").replace(/\.git$/, "")}/info/refs?service=git-upload-pack`;
    const r = await fetch(first, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": "curiosa" } });
    const loc = r.headers.get("location");
    if (!loc || r.status < 300 || r.status > 399) return undefined;
    const next = new URL(loc, first);
    const candidate = `${next.origin}${next.pathname.replace(/\/+$/, "").replace(/\/info\/refs$/, "").replace(/\.git$/, "")}`;
    return accessTarget(candidate) ? candidate : undefined;
  } catch { return undefined; }
}

const KEY_OF: Record<Exclude<GitFailureKind, "redirect">, SaveAccessError> = { address: "address", notFound: "notFound", rejected: "rejected", tooOld: "tooOld", unreachable: "unreachable", unknown: "unknown" };

/** Tries a code on the repository WITHOUT keeping it (same answers as `saveAccessCode`). The code stays in memory for this one test. */
export async function verifyAccessCode(url: string, code: string, actor: string): Promise<SaveAccessResult> {
  const target = accessTarget(url);
  if (!target) return { ok: false, error: "address" };
  const format = checkCodeFormat(code);
  if (format !== "ok") return { ok: false, error: format };
  try {
    await gitCheckAccess(url, code.trim());
  } catch (error) {
    const failure = failureOf(error);
    // The journal gets the repository and the KIND of failure (a word), never what git printed.
    await audit(actor, "git.access.failed", `${target.repo} ${failure.kind}`, { level: "warn" });
    if (failure.kind !== "redirect") return { ok: false, error: KEY_OF[failure.kind] };
    const address = (failure.location && accessTarget(failure.location) ? failure.location : undefined) ?? await movedTo(url);
    const plain = (x: string) => x.replace(/\/+$/, "").replace(/\.git$/, "");
    return address && plain(address) !== plain(url) ? { ok: false, error: "redirectTo", address } : { ok: false, error: "redirect" };
  }
  return { ok: true, repo: target.repo };
}

export async function saveAccessCode(url: string, code: string, actor: string): Promise<SaveAccessResult> {
  const target = accessTarget(url);
  const checked = await verifyAccessCode(url, code, actor);
  if (!checked.ok || !target) return checked;
  if (!(await storeAccess(url, code))) return { ok: false, error: "format" };
  await audit(actor, "git.access.set", target.repo);
  return { ok: true, repo: target.repo };
}

export async function removeAccessCode(url: string, actor: string): Promise<{ ok: boolean }> {
  const target = accessTarget(url);
  if (!target || !(await removeAccess(url))) return { ok: false };
  await audit(actor, "git.access.remove", target.repo);
  return { ok: true };
}

export { accessState, type AccessState };
