import crypto from "node:crypto";
import { hasRole } from "@/core/auth/access";
import { makeTranslator } from "@/core/i18n/dictionary";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { renderSample, sampleHeaders } from "@/core/overlays/sample";
import { inlineSkinFonts } from "@/core/overlays/skinFontData";
import { skinPayload } from "@/core/overlays/skinLoad";
import { currentUser } from "@/core/permissions";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

/** The sample scene of an installed overlay skin (`common` = the common style), read by the administration only: no secret, no data, no cache. */
export async function GET(request: Request, { params }: { params: Promise<{ skin: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!hasRole(user, OVERLAY_NEED)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const { skin } = await params;
  const loaded = skin === "common" ? null : await skinPayload(skin).catch(() => null);
  if (skin !== "common" && !loaded) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const config = await getSiteConfig();
  const asked = new URL(request.url).searchParams.get("lang") ?? "";
  const lang = config.locales.includes(asked) ? asked : config.defaultLocale;
  const nonce = crypto.randomBytes(16).toString("base64");
  // (0.47.0) a skin with fonts: its sample carries them as data addresses (the sample frame has no origin to fetch them from)
  const inline = loaded?.fonts?.length ? inlineSkinFonts(loaded.css, loaded.fonts) : null;
  const payload = loaded && inline ? { ...loaded, css: inline.css } : loaded;
  return new Response(renderSample(payload, makeTranslator(lang), lang, nonce), { status: 200, headers: sampleHeaders(nonce, !!inline?.inlined) });
}
