import crypto from "node:crypto";
import { can, effectiveLevel, loadAdminUserById } from "@/core/auth/access";
import { INERT_STATE, type OwnerState } from "@/core/services/mcp/ownerCeiling";
import { registerOwnerResolver } from "@/core/services/mcp/ownerResolver";
import { getPersonalPolicy, PERSONAL_AI_RIGHT, personalAiAllowed } from "./policy";

/**
 * The owner of a personal AI as seen NOW, on every request (core 0.46.0). Fail closed, in this order: the person must exist; the master switch and the policy must allow
 * them; the account must not be locked (temporary password to replace, two-factor required and missing). Only then do the person's CURRENT level and rights count.
 * Nothing is cached across requests: a demotion, a withdrawn right or a switched-off policy applies to the very next call.
 */
export async function resolvePersonalOwner(ownerId: string): Promise<OwnerState> {
  const policy = await getPersonalPolicy();
  const found = await loadAdminUserById(ownerId);
  if (!found) return INERT_STATE(ownerId, "owner_missing");
  const { user, personalAi } = found;
  if (!policy.enabled) return INERT_STATE(ownerId, "policy_off");
  // `can` is false for a locked account (temporary password, two-factor required and missing): the AI is then inert, restorable.
  if (user.mustChangePassword || user.needsTwoFactor) return INERT_STATE(ownerId, "owner_locked");
  if (!personalAiAllowed(policy, personalAi, can(user, PERSONAL_AI_RIGHT))) return INERT_STATE(ownerId, "not_allowed");
  const tier = effectiveLevel(user);
  if (tier === "none" && user.rights.size === 0) return INERT_STATE(ownerId, "not_allowed");
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([tier, [...user.rights].sort(), personalAi, policy])).digest("hex").slice(0, 16);
  return { ownerId, active: true, tier, rights: user.rights, fingerprint };
}

registerOwnerResolver(resolvePersonalOwner);
