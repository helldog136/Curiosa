import { hasRole } from "@/core/auth/access";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { PLACEHOLDER_SVG, catalogueSkinPreview } from "@/core/overlays/skinPreview";
import { currentUser } from "@/core/permissions";

export const dynamic = "force-dynamic";

/** The preview image of a catalogue overlay skin (administration only). Unavailable: a neutral placeholder, with a short cache so the next try can succeed. */
export async function GET(_request: Request, { params }: { params: Promise<{ skin: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!hasRole(user, OVERLAY_NEED)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const bytes = await catalogueSkinPreview((await params).skin);
  const common = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" };
  if (bytes) return new Response(new Uint8Array(bytes), { status: 200, headers: { ...common, "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600" } });
  return new Response(PLACEHOLDER_SVG, { status: 200, headers: { ...common, "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=30" } });
}
