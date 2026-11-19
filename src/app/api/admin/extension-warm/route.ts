import { NextResponse } from "next/server";
import { currentUser, hasRole } from "@/core/permissions";
import { can } from "@/core/auth/access";
import { warmFiche } from "@/core/modules/previewServe";

export const dynamic = "force-dynamic";

/**
 * Réchauffe la fiche d'une extension (voir `warmFiche`) : appelée au survol du bouton « Voir le détail et installer », répond tout de suite (204).
 * Réservée à l'administration, comme la fiche. N'écrit rien et n'installe rien : elle lit seulement le dépôt, comme la fiche le ferait.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !hasRole(user, "admin")) return new NextResponse(null, { status: 404 });
  const stored = can(user, "core:modules.install");   // a private repository is read only for who holds the right that guards its access code
  const q = new URL(request.url).searchParams;
  const id = q.get("id"), repo = q.get("repo");
  if (id && id.length <= 60) void warmFiche({ id }, stored);
  else if (repo && repo.length <= 300) void warmFiche({ repo }, stored);
  else return new NextResponse(null, { status: 400 });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
