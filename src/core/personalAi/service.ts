import bcrypt from "bcryptjs";
import { prisma } from "@/core/db";
import { listMcpToolCatalogue } from "@/core/platform";
import { applyProfile, type AccessProfile } from "@/core/services/mcp/profiles";
import { MAINTENANCE_PROFILE } from "@/core/services/mcp/access";
import { isGranted, parseGrants, withinCeiling, type Grants } from "@/core/services/mcp/access";
import { ownerCeilingAllows } from "@/core/services/mcp/ownerCeiling";
import { createToken, findTokenId, revokeToken, saveTokenGrants } from "@/core/services/mcp/tokens";
import { setApprovalMode } from "@/core/maintenance/settings";
import { expirePendingOf } from "@/core/maintenance/requests";
import { resolvePersonalOwner } from "./owner";
import { getPersonalPolicy } from "./policy";

/**
 * AI ACCESSES THAT BELONG TO A PERSON: the service layer (core 0.46.0; screens 0.47.0). Every function takes the user id of the SIGNED-IN person (read from the session by the caller,
 * never from a form) and acts only on accesses THAT person owns. Rules, all enforced here and not in a page:
 *   - a person may own several accesses, each with its own level (look only, look and prepare, upkeep), never above what the person can do;
 *   - creation and resuming need the person's password again; the access code is returned ONCE and only its hash is stored;
 *   - never a secret address, never full powers; the grants are always clipped to what the owner can do now (the runtime ceiling is the real gate, canUse in access.ts);
 *   - the journal gets names and counts, never a code.
 */
export type PersonalFailure = "not_allowed" | "password" | "limited" | "missing" | "direct_off";
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

/** The active accesses a person owns, oldest first (a person may own several). */
export async function ownedAccesses(userId: string) {
  return prisma.apiToken.findMany({ where: { ownerId: String(userId ?? ""), revokedAt: null }, orderBy: { createdAt: "asc" } });
}
/** One access of this person (never another person's: the owner is part of the query). */
async function ownAccess(userId: string, tokenId: string) {
  return prisma.apiToken.findFirst({ where: { id: String(tokenId ?? ""), ownerId: String(userId ?? ""), revokedAt: null } });
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

/** The levels of permission an access can have, in plain order: look only, look and prepare, upkeep of the site. */
export const ACCESS_LEVELS = ["read", "assistant", "maintenance"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const isAccessLevel = (v: unknown): v is AccessLevel => (ACCESS_LEVELS as readonly string[]).includes(v as string);

/** The levels this person may offer themselves: never above what they can do now (upkeep needs the admin tier). */
export async function levelsFor(userId: string): Promise<AccessLevel[]> {
  const owner = await resolvePersonalOwner(userId);
  if (!owner.active) return [];
  const upkeep = owner.tier === "admin" || owner.tier === "coordinator" || owner.tier === "owner";
  return upkeep ? [...ACCESS_LEVELS] : ["read", "assistant"];
}

/** The level an access has, read from its row (a migrated access with custom rights shows as its scope). */
export function levelOfRow(row: { scope: string; grants: string }): AccessLevel {
  if (row.scope !== "write") return "read";
  return parseGrants(row.grants)[MAINTENANCE_PROFILE] === true ? "maintenance" : "assistant";
}

async function grantsForLevel(userId: string, level: AccessLevel, profileOverride?: AccessProfile): Promise<{ scope: "read" | "write"; grants: Grants }> {
  if (level === "maintenance") return { scope: "write", grants: { [MAINTENANCE_PROFILE]: true } };
  // `profileOverride`: the "full" starting point of the earlier API (publishing, installs by request), still clipped to what the owner can do.
  const profile: AccessProfile = profileOverride ?? (level === "assistant" ? "assistant" : "read");
  const scope = profile === "read" ? "read" : "write";
  const catalogue = await listMcpToolCatalogue();
  const wanted = applyProfile(profile, catalogue.filter((t) => !t.instanceOptedOut), {}, scope).grants;
  return { scope, grants: await clipGrantsToOwner(userId, wanted, scope) };
}

const NAME_MAX = 80;
async function freeName(base: string, ignoreId?: string): Promise<string> {
  const clean = base.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  const taken = new Set((await prisma.apiToken.findMany({ where: { revokedAt: null, ...(ignoreId ? { id: { not: ignoreId } } : {}) }, select: { name: true } })).map((r) => r.name));
  let name = clean;
  for (let n = 2; taken.has(name); n++) name = `${clean.slice(0, NAME_MAX - 5)} (${n})`;
  return name;
}

/**
 * Creates an access OWNED by this person (the signed-in one, read from the session by the caller). Several are allowed. Returns the access code, shown ONCE (only its hash is stored).
 * `level`: look only (default), look and prepare, or upkeep of the site: never above what the person can do now. Never a secret address, never full powers.
 */
export async function createPersonalAccess(userId: string, input: { password: unknown; name?: unknown; level?: unknown; profile?: AccessProfile }): Promise<PersonalResult<{ code: string; id: string | null; name: string }>> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") } });
  if (!user) return { ok: false, reason: "missing" };
  const owner = await resolvePersonalOwner(user.id);
  if (!owner.active) return { ok: false, reason: "not_allowed" };
  const pw = await checkPassword(user, input.password);
  if (pw !== "ok") return { ok: false, reason: pw };
  const level: AccessLevel = isAccessLevel(input.level) ? input.level : input.profile === "assistant" || input.profile === "full" ? "assistant" : "read";
  if (!(await levelsFor(user.id)).includes(level)) return { ok: false, reason: "not_allowed" };
  const { scope, grants } = await grantsForLevel(user.id, level, input.profile === "full" ? "full" : undefined);
  const asked = typeof input.name === "string" ? input.name.trim() : "";
  const name = await freeName(asked || `${user.name}, assistant`);
  const code = await createToken(name, scope, user.email, { grants, ownerId: user.id });
  await journal(user.email, "mcp.personal.create", `${name} (level ${level})`);
  return { ok: true, code, id: await findTokenId(code), name };
}

/** The person removes one of their own accesses (revoked for good). Pending requests of THAT access expire. */
export async function revokeOwnPersonalAccess(userId: string, tokenId: string): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await ownAccess(user.id, tokenId) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  await revokeToken(row.id);
  await expirePendingOf(user.id);
  await journal(user.email, "mcp.personal.revoke", row.name);
  return { ok: true };
}

/** Renames one of the person's own accesses (names are unique among live accesses). */
export async function renameOwnPersonalAccess(userId: string, tokenId: string, name: unknown): Promise<PersonalResult<{ name: string }>> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await ownAccess(user.id, tokenId) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  const asked = typeof name === "string" ? name.trim() : "";
  if (!asked) return { ok: false, reason: "missing" };
  const next = await freeName(asked, row.id);
  await prisma.apiToken.update({ where: { id: row.id }, data: { name: next } });
  await journal(user.email, "mcp.personal.rename", `${row.name} -> ${next}`);
  return { ok: true, name: next };
}

/** Changes the level of one of the person's own accesses, within what they can do now. The rights of the new level replace the old ones. */
export async function setOwnAccessLevel(userId: string, tokenId: string, level: unknown): Promise<PersonalResult<{ level: AccessLevel }>> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await ownAccess(user.id, tokenId) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!isAccessLevel(level) || !(await levelsFor(user.id)).includes(level)) return { ok: false, reason: "not_allowed" };
  const { scope, grants } = await grantsForLevel(user.id, level);
  await prisma.apiToken.update({ where: { id: row.id }, data: { scope, grants: JSON.stringify(grants) } });
  await journal(user.email, "mcp.personal.rights", `${row.name}: level ${level}`);
  return { ok: true, level };
}

/** Pause (no password needed: stopping is always safe). */
export async function pauseOwnPersonalAccess(userId: string, tokenId: string): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await ownAccess(user.id, tokenId) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!row.pausedAt) await prisma.apiToken.update({ where: { id: row.id }, data: { pausedAt: new Date() } });
  await journal(user.email, "mcp.personal.pause", row.name);
  return { ok: true };
}

/** Resume: needs the password again (a pause may come from a compromise signal) and an owner who is still allowed. */
export async function resumeOwnPersonalAccess(userId: string, tokenId: string, password: unknown): Promise<PersonalResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") } });
  const row = user ? await ownAccess(user.id, tokenId) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!(await resolvePersonalOwner(user.id)).active) return { ok: false, reason: "not_allowed" };
  const pw = await checkPassword(user, password);
  if (pw !== "ok") return { ok: false, reason: pw };
  await prisma.apiToken.update({ where: { id: row.id }, data: { pausedAt: null } });
  await journal(user.email, "mcp.personal.resume", row.name);
  return { ok: true };
}

/** The person changes the rights of one of their own accesses: clipped to what they can do now. Returns how many are on after clipping. */
export async function setOwnPersonalGrants(userId: string, tokenId: string, grants: Grants): Promise<PersonalResult<{ on: number }>> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, email: true } });
  const row = user ? await ownAccess(user.id, tokenId) : null;
  if (!user || !row) return { ok: false, reason: "missing" };
  if (!(await resolvePersonalOwner(user.id)).active) return { ok: false, reason: "not_allowed" };
  const clean = Object.fromEntries(Object.entries(grants ?? {}).slice(0, 500).filter(([, v]) => typeof v === "boolean")) as Grants;
  const clipped = await clipGrantsToOwner(user.id, clean, row.scope === "write" ? "write" : "read");
  await saveTokenGrants(row.id, clipped);
  await journal(user.email, "mcp.personal.rights", `${row.name}: ${Object.values(clipped).filter(Boolean).length} on`);
  return { ok: true, on: Object.values(clipped).filter(Boolean).length };
}

/** "Ask me first" (default) or "act without asking": the second only when the site policy allows it. */
export async function setOwnPersonalApproval(userId: string, tokenId: string, mode: "human" | "direct"): Promise<PersonalResult> {
  const row = await ownAccess(userId, tokenId);
  if (!row) return { ok: false, reason: "missing" };
  if (mode === "direct" && !(await getPersonalPolicy()).allowDirect) return { ok: false, reason: "direct_off" };
  await setApprovalMode(row.id, mode === "direct" ? "direct" : "human");
  return { ok: true };
}

/** What a person's accesses are, for a screen or a test: no secret. `state`: the plain-word state (paused, inert when the owner may no longer have one, or active). */
export async function ownAccessStates(userId: string) {
  const rows = await ownedAccesses(userId);
  const owner = await resolvePersonalOwner(userId);
  return rows.map((row) => ({ id: row.id, name: row.name, level: levelOfRow(row), paused: !!row.pausedAt, active: owner.active && !row.pausedAt, state: row.pausedAt ? ("paused" as const) : owner.active ? ("active" as const) : ("inert" as const), lastUsedAt: row.lastUsedAt, createdAt: row.createdAt }));
}

/** A grant is "on" for the tool by default or explicitly (used by tests and screens to list what the AI really has). */
export const grantedOn = isGranted;

/** Journal: the owner of each assistant name, resolved from the access ROW (never from text sent by a client). Names that belong to no personal access are absent. */
export async function ownersOfAssistantNames(names: string[]): Promise<Map<string, string>> {
  const rows = await prisma.apiToken.findMany({ where: { name: { in: [...new Set(names)].slice(0, 200) }, ownerId: { not: null } }, select: { name: true, ownerId: true } });
  return new Map(rows.map((r) => [r.name, r.ownerId!]));
}

/** A holder of `core:mcp.tokens` pauses an owned access (stopping is always safe). Resuming stays with the owner, who types the password again. */
export async function pausePersonalAccessById(tokenId: string, actorEmail: string): Promise<boolean> {
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId ?? "") } });
  if (!row || !row.ownerId || row.revokedAt) return false;
  if (!row.pausedAt) await prisma.apiToken.update({ where: { id: row.id }, data: { pausedAt: new Date() } });
  await journal(actorEmail, "mcp.personal.pause", row.name);
  return true;
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
