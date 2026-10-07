import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { getSetting } from "@/core/settings";

export type TokenScope = "read" | "write";

const hashOf = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function isMcpEnabled(): Promise<boolean> {
  return (await getSetting<boolean>("mcp.enabled")) ?? true;
}

/** Crée un jeton. Le texte en clair n'est renvoyé qu'ici : seul son hash est conservé. */
export async function createToken(name: string, scope: TokenScope, createdBy: string): Promise<string> {
  const token = `vit_${crypto.randomBytes(32).toString("base64url")}`;
  await prisma.apiToken.create({ data: { name: name.slice(0, 80), hash: hashOf(token), prefix: token.slice(0, 8), scope, createdBy } });
  return token;
}

export async function revokeToken(id: string): Promise<void> {
  await prisma.apiToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export type AuthedToken = { id: string; name: string; scope: TokenScope };

export async function authenticate(header: string | null): Promise<AuthedToken | null> {
  const match = /^Bearer (vit_[A-Za-z0-9_-]{20,})$/.exec(header ?? "");
  if (!match) return null;
  const row = await prisma.apiToken.findUnique({ where: { hash: hashOf(match[1]!) } });
  if (!row || row.revokedAt) return null;
  // Mise à jour discrète : une erreur ici ne doit jamais empêcher la requête.
  prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: row.id, name: row.name, scope: row.scope === "write" ? "write" : "read" };
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
