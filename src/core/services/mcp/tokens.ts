import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { getSetting, setSetting } from "@/core/settings";
import { parseGrants, type Grants, type Scope } from "./access";

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
  const ids = await urlAccessIds();
  if (ids.includes(id) === enabled) return;
  await setSetting(URL_ACCESS_KEY, enabled ? [...ids, id] : ids.filter((x) => x !== id));
}

/** Crée un jeton. Le texte en clair n'est renvoyé qu'ici : seul son hash est conservé. */
export async function createToken(name: string, scope: TokenScope, createdBy: string, options: { byUrl?: boolean; grants?: Grants } = {}): Promise<string> {
  const token = `vit_${crypto.randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiToken.create({ data: { name: name.slice(0, 80), hash: hashOf(token), prefix: token.slice(0, 8), scope, createdBy, ...(options.grants ? { grants: JSON.stringify(options.grants) } : {}) } });
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
}

export type AuthedToken = { id: string; name: string; scope: TokenScope; grants: Grants };

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
  if (byUrl && !(await isUrlAccessEnabled(row.id))) return null;
  // Mise à jour discrète : une erreur ici ne doit jamais empêcher la requête.
  prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  // Les accès sont relus en base à CHAQUE requête : modifier les droits d'un jeton est immédiat, sans le régénérer.
  return { id: row.id, name: row.name, scope: row.scope === "write" ? "write" : "read", grants: parseGrants(row.grants) };
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

export async function getTokenGrants(id: string): Promise<{ scope: TokenScope; grants: Grants } | null> {
  const row = await prisma.apiToken.findUnique({ where: { id } });
  return row && !row.revokedAt ? { scope: row.scope === "write" ? "write" : "read", grants: parseGrants(row.grants) } : null;
}

export async function saveTokenGrants(id: string, grants: Grants): Promise<void> {
  await prisma.apiToken.updateMany({ where: { id, revokedAt: null }, data: { grants: JSON.stringify(grants) } });
}
