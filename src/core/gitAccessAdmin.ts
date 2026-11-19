/**
 * Save and remove the access code of a private repository (core 0.42.0; the rules are in gitAccess.ts). A code is stored ONLY after it has been tried against the
 * repository itself: a code that does not work is never kept. The audit lines name the repository, never the code. Owner only (right `core:modules.install`):
 * the callers are the admin pages, never the assistant (MCP) — no tool of the assistant reaches this file.
 */
import { audit } from "./permissions";
import { accessState, accessTarget, checkCodeFormat, removeAccess, storeAccess, type AccessState } from "./gitAccess";
import { gitCheckAccess } from "./modules/installer";
import { isGitAccessError } from "./gitAccess";

/** `error` is a translation key under `access.error.*`. */
export type SaveAccessResult = { ok: true; repo: string } | { ok: false; error: "empty" | "broad" | "format" | "address" | "refused" | "unreachable" };

export async function saveAccessCode(url: string, code: string, actor: string): Promise<SaveAccessResult> {
  const target = accessTarget(url);
  if (!target) return { ok: false, error: "address" };
  const format = checkCodeFormat(code);
  if (format !== "ok") return { ok: false, error: format };
  try {
    await gitCheckAccess(url, code.trim());
  } catch (error) {
    return { ok: false, error: isGitAccessError(error) ? "refused" : "unreachable" };
  }
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
