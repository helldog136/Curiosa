import { prisma } from "@/core/db";
import { setSetting } from "@/core/settings";
import { PERSONAL_AI_RIGHT } from "@/core/auth/rights";

/**
 * POLICY OF PERSONAL AI ASSISTANTS (core 0.46.0): who may have an AI that belongs to them.
 *
 *   allowed(person) = override is not "deny"  AND  (override is "allow"  OR  the person holds the right `core:ai.personal`)
 *
 * (0.47.0) Every AI access belongs to a person, so the old master switch ("personal assistants on/off") is gone: the global AI switch is `mcp.enabled` (setMcpEnabled). The stored
 * `enabled` flag is ignored and always read as true; only `allowDirect` is still a real option.
 * - `core:ai.personal` is a delegable right of the roles system (administrators, the coordinator and the owner hold it; editors do not; a custom role can carry it).
 * - The per-person override is the column `User.personalAi` (`inherit` | `allow` | `deny`). "allow" never raises the rights of the person: the ceiling still bounds the AI.
 * - `allowDirect` (default off): a person may choose "act without asking" for their own AI only when the policy allows it.
 * Stored as ONE core setting, `mcp.personalPolicy`, read straight from the database (never from the cache): a change is effective on the next request, in any process.
 * Changed only by holders of `core:mcp.tokens` (the admin actions check it; no MCP tool can).
 */
export const PERSONAL_POLICY_KEY = "mcp.personalPolicy";
export type PersonalPolicy = { enabled: boolean; allowDirect: boolean };
export const DEFAULT_POLICY: PersonalPolicy = { enabled: true, allowDirect: false };
export type Override = "inherit" | "allow" | "deny";
export const isOverride = (v: unknown): v is Override => v === "inherit" || v === "allow" || v === "deny";

/** Anything unreadable gives the safe default (switched off). Only the literal `true` switches a flag on. */
export async function getPersonalPolicy(): Promise<PersonalPolicy> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: PERSONAL_POLICY_KEY, locale: "" } } });
  if (!row) return { ...DEFAULT_POLICY };
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" && !Array.isArray(v) ? { enabled: true, allowDirect: v.allowDirect === true } : { ...DEFAULT_POLICY };
  } catch { return { ...DEFAULT_POLICY }; }
}

/** The caller (an admin action) has checked `core:mcp.tokens`. */
export async function setPersonalPolicy(patch: Partial<PersonalPolicy>): Promise<PersonalPolicy> {
  const now = await getPersonalPolicy();
  const next: PersonalPolicy = { enabled: true, allowDirect: patch.allowDirect === undefined ? now.allowDirect : patch.allowDirect === true };
  await setSetting(PERSONAL_POLICY_KEY, next);
  return next;
}

/** Pure: may this person have a personal AI under this policy? `holdsRight`: the person holds `core:ai.personal` (and is not locked: see `can`). */
export function personalAiAllowed(policy: PersonalPolicy, override: string, holdsRight: boolean): boolean {
  if (override === "deny") return false;
  return override === "allow" || holdsRight;
}

export { PERSONAL_AI_RIGHT };

/** Per-person override (a holder of `core:mcp.tokens` decides; the caller checked it). Unknown person: false. */
export async function setPersonOverride(userId: string, value: Override): Promise<boolean> {
  if (!isOverride(value)) return false;
  const r = await prisma.user.updateMany({ where: { id: String(userId ?? "") }, data: { personalAi: value } });
  return r.count === 1;
}
