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
