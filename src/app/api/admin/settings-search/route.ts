import { currentUser } from "@/core/permissions";
import { getAdminTranslator } from "@/core/i18n/request";
import { getSiteConfig } from "@/core/settings";
import { searchEntriesFor } from "@/core/modules/placeSearchLoad";

export const dynamic = "force-dynamic";

/**
 * (core 0.33.0) The settings search index of the signed-in person: sections and settings with their breadcrumb and deep link (never a value). The admin downloads it once
 * (first focus of the search box) and filters it in the browser. Private, never cached. Only people with an admin sign-in get it; what they may reach decides the content.
 */
export async function GET(): Promise<Response> {
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers });
  const { t, locale } = await getAdminTranslator(user.locale);
  const config = await getSiteConfig();
  const entries = await searchEntriesFor(user, t, locale, config.defaultLocale, user.advanced);
  return Response.json({ entries }, { headers });
}
