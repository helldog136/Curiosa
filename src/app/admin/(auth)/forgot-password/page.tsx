import Link from "next/link";
import { redirect } from "next/navigation";
import { LOGIN_HREF } from "@/core/adminLinks";
import { getAdminTranslator } from "@/core/i18n/request";
import { isMailConfigured } from "@/core/services/mail";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { askLinkAction } from "./actions";

export const dynamic = "force-dynamic";

/** Ask for a link to choose a new password. Only exists when the site can send e-mail (otherwise back to the sign-in page). */
export default async function ForgotPasswordPage() {
  if (!(await isMailConfigured().catch(() => false))) redirect(LOGIN_HREF);
  const { t } = await getAdminTranslator();
  return (
    <main className="mx-auto mt-12 max-w-sm space-y-6 px-4 pb-12 sm:mt-24" data-testid="forgot-password">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("forgot.title")}</h1>
        <p className="text-sm leading-6 text-muted">{t("forgot.intro")}</p>
      </div>
      <ActionForm action={askLinkAction} submitLabel={t("forgot.submit")} pendingLabel={t("progress.sending")}>
        <TextField name="email" type="email" label={t("field.email")} required example={t("users.emailExample")} autoComplete="username" />
      </ActionForm>
      <p className="text-sm"><Link href={LOGIN_HREF} className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">{t("forgot.back")}</Link></p>
    </main>
  );
}
