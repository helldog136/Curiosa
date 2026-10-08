import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { currentUser } from "@/core/permissions";

/**
 * Les routes de sauvegarde sont des routes HTTP « nues » (pas des actions serveur) : Next.js n'y ajoute aucune protection
 * contre les requêtes envoyées depuis un AUTRE site avec les cookies de l'administrateur. On l'ajoute ici :
 * la requête doit venir de ce même site (en-tête Origin = hôte de la requête), et d'un propriétaire connecté.
 */
export function isSameOrigin(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host.split(",")[0]!.trim(); } catch { return false; }
}

/** `null` = autorisé ; sinon la réponse d'erreur à renvoyer. Les sauvegardes contiennent tout le site : propriétaire seulement. */
export async function guardOwner(request: Request): Promise<Response | null> {
  if (!isSameOrigin(request.headers)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (user.role !== "owner") return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  return null;
}

export const MAX_UPLOAD = 1024 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Garde de l'assistant de première installation : restaurer une sauvegarde est une AUTRE façon de configurer un site neuf.
 * Autorisé seulement tant qu'AUCUN compte n'existe (sinon n'importe qui pourrait remplacer un site en service), depuis ce même
 * site, et — comme l'assistant — avec le jeton d'installation (en-tête `x-setup-token`) quand SETUP_TOKEN est défini.
 */
export async function guardFresh(request: Request, deps: { countUsers?: () => Promise<number>; setupToken?: string | undefined } = {}): Promise<Response | null> {
  if (!isSameOrigin(request.headers)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const count = deps.countUsers ?? (() => prisma.user.count());
  if ((await count()) > 0) return Response.json({ ok: false, error: "already-configured" }, { status: 403 });
  const required = "setupToken" in deps ? deps.setupToken : process.env.SETUP_TOKEN;
  if (required && !safeEqual(request.headers.get("x-setup-token") ?? "", required)) return Response.json({ ok: false, error: "invalid-token" }, { status: 403 });
  return null;
}
