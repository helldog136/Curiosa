import { getAdminTranslator } from "@/core/i18n/request";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { AuthShell } from "@/components/admin/AuthShell";
import { ResetPasswordForm } from "@/components/admin/ResetPasswordForm";
import { saveNewPasswordAction, peekLinkAction } from "./actions";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("reset.title"));
}

/** Public page of a reset link (token in the address fragment; no-store and no-referrer headers come from next.config.mjs). */
export default async function ResetPasswordPage() {
  const { t } = await getAdminTranslator();
  const labels = {
    loading: t("invite.accept.loading"), missing: t("reset.missing"), invalid: t("reset.invalid"), rate: t("invite.accept.rate"),
    password: t("account.newPassword"), confirm: t("choosePassword.confirm"), help: t("choosePassword.help", { n: MIN_PASSWORD_LENGTH }), submit: t("reset.submit"), pending: t("progress.saving"),
  };
  return (
    <AuthShell title={t("reset.title")} backLabel={t("forgot.back")} testid="reset-password">
      <ResetPasswordForm peek={peekLinkAction} action={saveNewPasswordAction} labels={labels} minLength={MIN_PASSWORD_LENGTH} intro={t("reset.intro")} />
    </AuthShell>
  );
}
