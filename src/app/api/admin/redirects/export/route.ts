import { currentUser, hasRole } from "@/core/permissions";
import { redirectsCsv } from "@/core/redirects";
import { siteTimezone } from "@/core/siteTime";
import { makeTranslator } from "@/core/i18n/dictionary";
import { resolveAdminLocale } from "@/core/i18n/request";

export const dynamic = "force-dynamic";

/** Export de la liste des liens courts en tableur (CSV lisible par Excel, LibreOffice, Numbers). Équipe connectée seulement. */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (!user) return new Response("Unauthorized", { status: 401, headers });
  if (!hasRole(user, "editor")) return new Response("Forbidden", { status: 403, headers });
  const t = makeTranslator(await resolveAdminLocale(user.locale));
  const csv = await redirectsCsv({
    header: ["redirects.csv.address", "redirects.csv.target", "redirects.csv.state", "redirects.csv.end", "redirects.csv.total", "redirects.csv.month", "redirects.csv.created"].map((k) => t(k)),
    stateLabels: { active: t("redirects.state.active"), ended: t("redirects.state.ended"), off: t("redirects.state.off") },
    tz: await siteTimezone(),
  });
  return new Response(csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="liens-courts.csv"' } });
}
