import { relativeLocation } from "@/core/publicOrigin";
import { getAdminTranslator } from "@/core/i18n/request";
import { adminBugReportUrl } from "@/core/bugReport";
import { currentUser } from "@/core/permissions";
import { LOGIN_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

/**
 * Redirige vers le signalement de bug avec les informations de version préremplies. Sert à la page d'erreur de l'admin, qui ne peut pas les calculer elle-même.
 * Réservé aux personnes connectées ; l'adresse construite ne contient aucune donnée du site (voir core/bugReport.ts).
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 302, headers: { Location: relativeLocation(LOGIN_HREF), "Cache-Control": "no-store" } });
  const { t } = await getAdminTranslator(user.locale);
  return new Response(null, { status: 302, headers: { Location: await adminBugReportUrl(t), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
