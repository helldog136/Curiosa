import { getAdminTranslator } from "@/core/i18n/request";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { ResetPasswordForm } from "@/components/admin/ResetPasswordForm";
import { saveNewPasswordAction, peekLinkAction } from "./actions";

export const dynamic = "force-dynamic";

/** Public page of a reset link (token in the address fragment; no-store and no-referrer headers come from next.config.mjs). */
export default async function ResetPasswordPage() {
  const { t } = await getAdminTranslator();
  const labels = {
    loading: t("invite.accept.loading"), missing: t("reset.missing"), invalid: t("reset.invalid"), rate: t("invite.accept.rate"), title: t("reset.title"), intro: t("reset.intro"),
    password: t("account.newPassword"), confirm: t("choosePassword.confirm"), help: t("choosePassword.help", { n: MIN_PASSWORD_LENGTH }), submit: t("reset.submit"), pending: t("progress.saving"),
  };
  return (
    <main className="mx-auto mt-12 max-w-sm space-y-6 px-4 pb-12 sm:mt-24" data-testid="reset-password">
      <ResetPasswordForm peek={peekLinkAction} action={saveNewPasswordAction} labels={labels} minLength={MIN_PASSWORD_LENGTH} />
    </main>
  );
}
