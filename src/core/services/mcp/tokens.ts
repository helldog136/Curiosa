import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { getSetting, setSetting } from "@/core/settings";
import { forgetListSeen } from "./listSeen";
import { parseGrants, type Grants, type Scope } from "./access";
import { fullPowersIds, setFullPowers } from "./fullPowers";
import { INERT_STATE, type OwnerState } from "./ownerCeiling";
import { resolveOwner } from "./ownerResolver";

export type TokenScope = Scope;

const hashOf = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function isMcpEnabled(): Promise<boolean> {
  return (await getSetting<boolean>("mcp.enabled")) ?? true;
}

/**
 * Jetons autorisés à se connecter par adresse secrète (`/api/mcp/<jeton>`) : réglage du cœur, liste d'identifiants de jeton.
 * Désactivé par défaut, jeton par jeton ; pas de colonne en base, donc pas de migration.
 */
const URL_ACCESS_KEY = "mcp.urlTokens";

export async function urlAccessIds(): Promise<string[]> {
  const v = await getSetting<unknown>(URL_ACCESS_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function isUrlAccessEnabled(id: string): Promise<boolean> {
  return (await urlAccessIds()).includes(id);
}

/** Active ou retire la connexion par adresse secrète d'un jeton. L'appelant vérifie que l'utilisateur est le propriétaire. */
export async function setUrlAccess(id: string, enabled: boolean): Promise<void> {
  // A personal AI never connects by a secret address (core 0.46.0): turning it on for an access that has an owner does nothing.
  if (enabled && (await isPersonalToken(id))) return;
  const ids = await urlAccessIds();
  if (ids.includes(id) === enabled) return;
  await setSetting(URL_ACCESS_KEY, enabled ? [...ids, id] : ids.filter((x) => x !== id));
}

/** Crée un jeton. Le texte en clair n'est renvoyé qu'ici : seul son hash est conservé. */
export async function createToken(name: string, scope: TokenScope, createdBy: string, options: { byUrl?: boolean; grants?: Grants; /** (0.46.0) The user who owns this access (a personal AI): never combined with the secret address. */ ownerId?: string } = {}): Promise<string> {
  const token = `vit_${crypto.randomBytes(32).toString("base64url")}`;
  if (options.ownerId && options.byUrl) throw new Error("a personal access cannot use a secret address");
  const row = await prisma.apiToken.create({ data: { name: name.slice(0, 80), hash: hashOf(token), prefix: token.slice(0, 8), scope, createdBy, ...(options.ownerId ? { ownerId: options.ownerId } : {}), ...(options.grants ? { grants: JSON.stringify(options.grants) } : {}) } });
  if (options.byUrl) await setUrlAccess(row.id, true);
  return token;
}

/** Identifiant d'un jeton à partir de son texte (juste après sa création). */
export async function findTokenId(token: string): Promise<string | null> {
  return (await prisma.apiToken.findUnique({ where: { hash: hashOf(token) }, select: { id: true } }))?.id ?? null;
}

export async function revokeToken(id: string): Promise<void> {
  await prisma.apiToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  await setUrlAccess(id, false);
  await setFullPowers(id, false);
  await forgetListSeen(id);
}

export type AuthedToken = {
  id: string; name: string; scope: TokenScope; grants: Grants; /** Full powers (fullPowers.ts): read from the database on every request, like the grants. */ fullPowers: boolean;
  /** (0.46.0) Only for a personal AI: its owner as seen on THIS request (rights, policy, paused...). Absent for an independent access. */
  personal?: OwnerState; ownerId?: string; /** (0.47.0) Coarse ceiling for undeclared module tools (an access that existed before owners were mandatory). */ coarse?: boolean;
};

/** Is this access a personal AI (does it belong to a user)? */
export async function isPersonalToken(id: string): Promise<boolean> {
  const row = await prisma.apiToken.findUnique({ where: { id }, select: { ownerId: true } });
  return !!row?.ownerId;
}

/** A personal AI that is NOT a legacy access (`coarseCeiling` off): it follows the site policy for "act without asking" and never holds full powers or a secret address. */
export async function isStrictPersonalToken(id: string): Promise<boolean> {
  const row = await prisma.apiToken.findUnique({ where: { id }, select: { ownerId: true, coarseCeiling: true } });
  return !!row?.ownerId && !row.coarseCeiling;
}

/** The user who owns this access, or null for an independent one (read from the access row). */
export async function ownerOfToken(id: string): Promise<string | null> {
  return (await prisma.apiToken.findUnique({ where: { id }, select: { ownerId: true } }))?.ownerId ?? null;
}

/** The owner of a personal access as seen now, with the access's own pause. Never throws: any failure is an inert owner. */
async function personalState(row: { ownerId: string; pausedAt: Date | null }): Promise<OwnerState> {
  if (row.pausedAt) return INERT_STATE(row.ownerId, "paused");
  return resolveOwner(row.ownerId);
}

const TOKEN_FORMAT = /^vit_[A-Za-z0-9_-]{20,}$/;

/** Authentification par en-tête : `Authorization: Bearer vit_…`. */
export async function authenticate(header: string | null): Promise<AuthedToken | null> {
  const match = /^Bearer (vit_[A-Za-z0-9_-]{20,})$/.exec(header ?? "");
  return match ? authenticateValue(match[1]!, false) : null;
}

/**
 * Authentification par adresse secrète : le jeton est le dernier segment de `/api/mcp/<jeton>`. Seuls les jetons dont
 * l'administrateur a activé cette option sont acceptés ; un jeton inconnu, mal formé, révoqué ou non autorisé par adresse
 * donne le même résultat (null) : rien ne permet de deviner lequel.
 */
export async function authenticateByUrl(value: string | null): Promise<AuthedToken | null> {
  return value && TOKEN_FORMAT.test(value) ? authenticateValue(value, true) : null;
}

async function authenticateValue(token: string, byUrl: boolean): Promise<AuthedToken | null> {
  const row = await prisma.apiToken.findUnique({ where: { hash: hashOf(token) } });
  if (!row || row.revokedAt) return null;
  // A secret address works only for an access that existed before owners were mandatory (coarseCeiling) or has no owner yet; a new access never has one.
  if (byUrl && ((row.ownerId && !row.coarseCeiling) || !(await isUrlAccessEnabled(row.id)))) return null;
  // Mise à jour discrète : une erreur ici ne doit jamais empêcher la requête.
  prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  // Les accès sont relus en base à CHAQUE requête : modifier les droits d'un jeton est immédiat, sans le régénérer.
  const scope: TokenScope = row.scope === "write" ? "write" : "read";
  // A personal AI (0.46.0): never full powers; its owner is resolved on every request (fail closed).
  if (row.ownerId) return { id: row.id, name: row.name, scope, grants: parseGrants(row.grants), fullPowers: row.coarseCeiling && scope === "write" && (await fullPowersIds()).includes(row.id), ownerId: row.ownerId, coarse: row.coarseCeiling, personal: await personalState({ ownerId: row.ownerId, pausedAt: row.pausedAt }) };
  return { id: row.id, name: row.name, scope, grants: parseGrants(row.grants), fullPowers: scope === "write" && (await fullPowersIds()).includes(row.id) };
}

// Limitation de débit en mémoire : 120 requêtes / minute / jeton.
const hits = new Map<string, number[]>();
export function rateLimited(tokenId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(tokenId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(tokenId, recent);
  return recent.length > 120;
}

export async function getTokenGrants(id: string): Promise<{ scope: TokenScope; grants: Grants; fullPowers: boolean; personal?: OwnerState; ownerId?: string; coarse?: boolean } | null> {
  const row = await prisma.apiToken.findUnique({ where: { id } });
  if (!row || row.revokedAt) return null;
  const scope: TokenScope = row.scope === "write" ? "write" : "read";
  if (row.ownerId) return { scope, grants: parseGrants(row.grants), fullPowers: false, ownerId: row.ownerId, coarse: row.coarseCeiling, personal: await personalState({ ownerId: row.ownerId, pausedAt: row.pausedAt }) };
  return { scope, grants: parseGrants(row.grants), fullPowers: scope === "write" && (await fullPowersIds()).includes(id) };
}

/** Sets the LEVEL of an access (scope and grants together). Any level change also turns full powers off: a level is a fresh start, never a level plus leftover powers. */
export async function saveTokenLevel(id: string, scope: TokenScope, grants: Grants): Promise<void> {
  await prisma.apiToken.updateMany({ where: { id, revokedAt: null }, data: { scope, grants: JSON.stringify(grants) } });
  await setFullPowers(id, false);
}

export async function saveTokenGrants(id: string, grants: Grants): Promise<void> {
  await prisma.apiToken.updateMany({ where: { id, revokedAt: null }, data: { grants: JSON.stringify(grants) } });
}
