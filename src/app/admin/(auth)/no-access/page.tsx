import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { currentUser, isMember } from "@/core/permissions";
import { getAdminTranslator } from "@/core/i18n/request";
import { ui } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

/**
 * Une personne connectée dont le compte n'a encore AUCUN accès (aucun rôle utile, par exemple un rôle personnalisé vidé de ses droits) arrive ici,
 * hors du menu d'admin : un refus « /admin?denied=1 » la renverrait sinon en boucle. Rien n'est montré du site ; elle peut se déconnecter.
 */
export default async function NoAccessPage() {
  const user = await currentUser({ allowForced: true });
  if (!user) redirect("/admin/login");
  if (isMember(user)) redirect("/admin");
  const { t } = await getAdminTranslator(user.locale);
  return (
    <main className="mx-auto mt-12 max-w-sm space-y-6 px-4 pb-12 sm:mt-24" data-testid="no-access">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("noAccess.title")}</h1>
        <p className="text-sm leading-6 text-muted">{t("noAccess.intro", { name: user.name })}</p>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/admin/login" });
        }}
        className="border-t border-line pt-4"
      >
        <p className="mb-2 text-xs text-muted">{t("choosePassword.signedInAs", { email: user.email })}</p>
        <button className={ui.btn}>{t("nav.logout")}</button>
      </form>
    </main>
  );
}
