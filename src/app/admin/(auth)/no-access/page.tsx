import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { currentUser, isMember } from "@/core/permissions";
import { getAdminTranslator } from "@/core/i18n/request";
import { AuthShell } from "@/components/admin/AuthShell";
import { PendingButton } from "@/components/admin/PendingButton";
import { ADMIN_HREF, LOGIN_HREF } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("noAccess.title"));
}

/**
 * Une personne connectée dont le compte n'a encore AUCUN accès (aucun rôle utile, par exemple un rôle personnalisé vidé de ses droits) arrive ici,
 * hors du menu d'admin : un refus « /admin?denied=1 » la renverrait sinon en boucle. Rien n'est montré du site ; elle peut se déconnecter.
 */
export default async function NoAccessPage() {
  const user = await currentUser({ allowForced: true });
  if (!user) redirect(LOGIN_HREF);
  if (isMember(user)) redirect(ADMIN_HREF);
  const { t } = await getAdminTranslator(user.locale);
  return (
    <AuthShell title={t("noAccess.title")} intro={t("noAccess.intro", { name: user.name })} testid="no-access">
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: LOGIN_HREF });
        }}
        className="border-t border-line pt-4"
      >
        <p className="mb-2 text-xs text-muted">{t("choosePassword.signedInAs", { email: user.email })}</p>
        <PendingButton pendingLabel={t("progress.signingOut")}>{t("nav.logout")}</PendingButton>
      </form>
    </AuthShell>
  );
}
