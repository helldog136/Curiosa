import bcrypt from "bcryptjs";
import { prisma } from "@/core/db";
import { listMcpToolCatalogue } from "@/core/platform";
import { applyProfile, type AccessProfile } from "@/core/services/mcp/profiles";
import { isGranted, parseGrants, withinCeiling, type Grants } from "@/core/services/mcp/access";
import { ownerCeilingAllows } from "@/core/services/mcp/ownerCeiling";
import { createToken, findTokenId, revokeToken, saveTokenGrants } from "@/core/services/mcp/tokens";
import { getApprovalMode, setApprovalMode } from "@/core/maintenance/settings";
import { expirePendingOf } from "@/core/maintenance/requests";
import { resolvePersonalOwner } from "./owner";
import { getPersonalPolicy } from "./policy";

/**
 * PERSONAL AI ASSISTANTS: the service layer (core 0.46.0, no screen yet). Every function takes the user id of the SIGNED-IN person (read from the session by the caller,
 * never from a form) and acts only on THAT person's own access. Rules, all enforced here and not in a page:
 *   - one active personal AI per person;
 *   - creation and resuming need the person's password again; the access code is returned ONCE and only its hash is stored;
 *   - never a secret address, never full powers; the grants are always clipped to what the owner can do now (the runtime ceiling is the real gate, canUse in access.ts);
 *   - the journal gets names and counts, never a code.
 */
export type PersonalFailure = "not_allowed" | "password" | "limited" | "exists" | "missing" | "direct_off";
export type PersonalResult<T = object> = ({ ok: true } & T) | { ok: false; reason: PersonalFailure };

async function journal(actor: string, action: string, target: string): Promise<void> {
  await prisma.auditLog.create({ data: { actor, actorKind: "person", action, target: target.slice(0, 300) } }).catch(() => {});
}

/* Password re-entry: at most 5 wrong answers per person per 15 minutes (in memory), so that this cannot be used to guess a password. */
const WINDOW = 15 * 60_000;
const MAX_WRONG = 5;
const wrong = ((globalThis as unknown as { curiosaPersonalWrong?: Map<string, number[]> }).curiosaPersonalWrong ??= new Map<string, number[]>());
export function resetPersonalPasswordLimits(): void { wrong.clear(); }

async function checkPassword(user: { id: string; passwordHash: string }, password: unknown): Promise<"ok" | "password" | "limited"> {
  const now = Date.now();
  const recent = (wrong.get(user.id) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX_WRONG) return "limited";
  const good = typeof password === "string" && password.length > 0 && (await bcrypt.compare(password, user.passwordHash));
  if (!good) { recent.push(now); wrong.set(user.id, recent); return "password"; }
  wrong.delete(user.id);
  return "ok";
}

/** The active personal access of a person, if any (one at most). */
export async function activePersonalAccess(userId: string) {
  return prisma.apiToken.findFirst({ where: { ownerId: String(userId ?? ""), revokedAt: null }, orderBy: { createdAt: "asc" } });
}

/**
 * Clips grants to the ceiling: a grant to a tool the owner cannot use now is dropped (a grant that turns a tool OFF is always kept). Defence in depth: `canUse` re-checks on every request.
 */
export async function clipGrantsToOwner(ownerId: string, grants: Grants, scope: "read" | "write"): Promise<Grants> {
  const owner = await resolvePersonalOwner(ownerId);
  const catalogue = await listMcpToolCatalogue();
  const out: Grants = {};
  for (const [name, on] of Object.entries(grants)) {
    if (on === false) { out[name] = false; continue; }
    const tool = catalogue.find((t) => t.name === name);
    if (tool && ownerCeilingAllows(tool, owner) && withinCeiling(tool, scope)) out[name] = true;
  }
  return out;
}

/**
 * Creates the personal AI of this person. Returns the access code, to be shown ONCE (it cannot be read again). `profile`: the starting point (default `read`: looks only);
 * the grants of `assistant` and `full` are clipped to what the person can do.
 */
export async function createPersonalAccess(userId: string, input: { password: unknown; profile?: AccessProfile }): Promise<PersonalResult<{ code: string; id: string | null; name: string }>> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") } });
  if (!user) return { ok: false, reason: "missing" };
  const owner = await resolvePersonalOwner(user.id);
  if (!owner.active) return { ok: false, reason: "not_allowed" };
  const pw = await checkPassword(user, input.password);
  if (pw !== "ok") return { ok: false, reason: pw };
  if (await activePersonalAccess(user.id)) return { ok: false, reason: "exists" };
  const profile: AccessProfile = input.profile === "assistant" || input.profile === "full" ? input.profile : "read";
  const scope = profile === "read" ? "read" : "write";
  const catalogue = await listMcpToolCatalogue();
  const wanted = applyProfile(profile, catalogue.filter((t) => !t.instanceOptedOut), {}, scope).grants;
  const grants = await clipGrantsToOwner(user.id, wanted, scope);
  const taken = new Set((await prisma.apiToken.findMany({ where: { revokedAt: null }, select: { name: true } })).map((r) => r.name));
  let name = `${user.name}, assistant`.slice(0, 76);
  for (let n = 2; taken.has(name); n++) name = `${`${user.name}, assistant`.slice(0, 70)} (${n})`;
  const code = await createToken(name, scope, user.email, { grants, ownerId: user.id });
  await journal(user.email, "mcp.personal.create", `${name} (profile ${profile})`);
  return { ok: true, code, id: await findTokenId(code), name };
}

/** The person removes their own AI (it is revoked for good; they may create a new one if still allowed). */
export async function revokeOwnPersonalAccess(userId: string): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await activePersonalAccess(user.id) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  await revokeToken(row.id);
  await expirePendingOf(user.id);
  await journal(user.email, "mcp.personal.revoke", row.name);
  return { ok: true };
}

/** Pause (no password needed: stopping is always safe). */
export async function pauseOwnPersonalAccess(userId: string): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await activePersonalAccess(user.id) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!row.pausedAt) await prisma.apiToken.update({ where: { id: row.id }, data: { pausedAt: new Date() } });
  await journal(user.email, "mcp.personal.pause", row.name);
  return { ok: true };
}

/** Resume: needs the password again (a pause may come from a compromise signal) and an owner who is still allowed. */
export async function resumeOwnPersonalAccess(userId: string, password: unknown): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") } });
  const row = user ? await activePersonalAccess(user.id) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!(await resolvePersonalOwner(user.id)).active) return { ok: false, reason: "not_allowed" };
  const pw = await checkPassword(user, password);
  if (pw !== "ok") return { ok: false, reason: pw };
  await prisma.apiToken.update({ where: { id: row.id }, data: { pausedAt: null } });
  await journal(user.email, "mcp.personal.resume", row.name);
  return { ok: true };
}

/** The person changes the rights of their own AI: clipped to what they can do now. Returns how many are on after clipping. */
export async function setOwnPersonalGrants(userId: string, grants: Grants): Promise<PersonalResult<{ on: number }>> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await activePersonalAccess(user.id) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!(await resolvePersonalOwner(user.id)).active) return { ok: false, reason: "not_allowed" };
  const clean = Object.fromEntries(Object.entries(grants ?? {}).slice(0, 500).filter(([, v]) => typeof v === "boolean")) as Grants;
  const clipped = await clipGrantsToOwner(user.id, clean, row.scope === "write" ? "write" : "read");
  await saveTokenGrants(row.id, clipped);
  await journal(user.email, "mcp.personal.rights", `${row.name}: ${Object.values(clipped).filter(Boolean).length} on`);
  return { ok: true, on: Object.values(clipped).filter(Boolean).length };
}

/** "Ask me first" (default) or "act without asking": the second only when the site policy allows it. */
export async function setOwnPersonalApproval(userId: string, mode: "human" | "direct"): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true } });
  const row = user ? await activePersonalAccess(user.id) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (mode === "direct" && !(await getPersonalPolicy()).allowDirect) return { ok: false, reason: "direct_off" };
  await setApprovalMode(row.id, mode === "direct" ? "direct" : "human");
  return { ok: true };
}

/** What the person's own AI is, for a screen or a test: no secret. */
export async function ownPersonalState(userId: string) {
  const row = await activePersonalAccess(userId);
  if (!row) return null;
  const owner = await resolvePersonalOwner(userId);
  return { id: row.id, name: row.name, scope: row.scope, paused: !!row.pausedAt, active: owner.active && !row.pausedAt, inert: owner.inert ?? (row.pausedAt ? "paused" : undefined), approval: await getApprovalMode(row.id), grants: parseGrants(row.grants), lastUsedAt: row.lastUsedAt };
}

/** A grant is "on" for the tool by default or explicitly (used by tests and screens to list what the AI really has). */
export const grantedOn = isGranted;

/** Journal: the owner of each assistant name, resolved from the access ROW (never from text sent by a client). Names that belong to no personal access are absent. */
export async function ownersOfAssistantNames(names: string[]): Promise<Map<string, string>> {
  const rows = await prisma.apiToken.findMany({ where: { name: { in: [...new Set(names)].slice(0, 200) }, ownerId: { not: null } }, select: { name: true, ownerId: true } });
  return new Map(rows.map((r) => [r.name, r.ownerId!]));
}

/** An owner or an administrator holding `core:mcp.tokens` removes a personal access by its id (the caller checked who is asking). */
export async function revokePersonalAccessById(tokenId: string, actorEmail: string): Promise<boolean> {
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId ?? "") } });
  if (!row || !row.ownerId || row.revokedAt) return false;
  await revokeToken(row.id);
  await expirePendingOf(row.ownerId);
  await journal(actorEmail, "mcp.personal.revoke", row.name);
  return true;
}
