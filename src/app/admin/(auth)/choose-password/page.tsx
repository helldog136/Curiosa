import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { choosePassword, signOutForced } from "./actions";

export const dynamic = "force-dynamic";

/** Seule page accessible tant que le mot de passe est temporaire : la personne y choisit le sien (ou se déconnecte). Rien d'autre de l'admin ne s'ouvre avant. */
export default async function ChoosePasswordPage() {
  const { t, user } = await adminCtx("member", { allowForced: true, allowUnenrolled: true });
  if (!user.mustChangePassword) redirect("/admin");
  return (
    <main className="mx-auto mt-12 max-w-sm space-y-6 px-4 pb-12 sm:mt-24" data-testid="choose-password">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("choosePassword.title")}</h1>
        <p className="text-sm leading-6 text-muted">{t("choosePassword.intro", { name: user.name })}</p>
      </div>
      <ActionForm action={choosePassword} submitLabel={t("choosePassword.submit")}>
        <TextField name="next" type="password" label={t("account.newPassword")} required autoComplete="new-password" help={t("choosePassword.help", { n: MIN_PASSWORD_LENGTH })} />
        <TextField name="confirm" type="password" label={t("choosePassword.confirm")} required autoComplete="new-password" />
      </ActionForm>
      <form action={signOutForced} className="border-t border-line pt-4">
        <p className="mb-2 text-xs text-muted">{t("choosePassword.signedInAs", { email: user.email })}</p>
        <button className={ui.btn}>{t("nav.logout")}</button>
      </form>
    </main>
  );
}
