import { currentUser } from "@/core/permissions";
import { hasRole } from "@/core/auth/access";
import { getAdminTranslator } from "@/core/i18n/request";
import { getSiteConfig } from "@/core/settings";
import { searchContentEntries } from "@/core/content/adminSearch";

export const dynamic = "force-dynamic";

/** (core 0.41.0) Content entries matching `?q=` (titles only, 20 at most) for the global search. Private, never cached; editors and above, like the entries list. */
export async function GET(req: Request): Promise<Response> {
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers });
  if (!hasRole(user, "editor")) return Response.json({ entries: [] }, { headers });
  const { locale } = await getAdminTranslator(user.locale);
  const config = await getSiteConfig();
  const entries = await searchContentEntries(new URL(req.url).searchParams.get("q"), locale, config.defaultLocale);
  return Response.json({ entries }, { headers });
}
