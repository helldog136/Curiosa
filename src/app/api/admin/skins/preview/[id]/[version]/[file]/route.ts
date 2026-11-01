import { NextResponse } from "next/server";
import { currentUser, hasRole } from "@/core/permissions";
import { SKIN_ID_RE } from "@/core/skins/allowlist";
import { readInstalledPreview } from "@/core/skins/service";
import { SEMVER_RE } from "@/core/skins/semver";

/**
 * Image d'aperçu d'un skin INSTALLÉ (`previews/<fichier>.webp`), pour la page Apparence seulement : réservée aux personnes qui peuvent régler l'apparence,
 * jamais servie aux visiteurs (les aperçus ne sont pas dans la route publique des ressources, docs/SKINS.md §21.7). Le nom du fichier est contrôlé par `readInstalledPreview`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string; file: string }> }) {
  const user = await currentUser();
  if (!user || !hasRole(user, "admin")) return new NextResponse(null, { status: 404 });
  const { id, version, file } = await params;
  if (!SKIN_ID_RE.test(id) || !SEMVER_RE.test(version) || !/^[a-z0-9][a-z0-9._-]{0,63}\.webp$/.test(file)) return new NextResponse(null, { status: 404 });
  const bytes = readInstalledPreview(id, version, `previews/${file}`);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
