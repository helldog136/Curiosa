import { redirect } from "next/navigation";
import { LOGIN_HREF } from "@/core/adminLinks";
import { AuthShell } from "@/components/admin/AuthShell";
import { getAdminTranslator } from "@/core/i18n/request";
import { isMailConfigured } from "@/core/services/mail";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { askLinkAction } from "./actions";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("forgot.title"));
}

/** Ask for a link to choose a new password. Only exists when the site can send e-mail (otherwise back to the sign-in page). */
export default async function ForgotPasswordPage() {
  if (!(await isMailConfigured().catch(() => false))) redirect(LOGIN_HREF);
  const { t } = await getAdminTranslator();
  return (
    <AuthShell title={t("forgot.title")} intro={t("forgot.intro")} backLabel={t("forgot.back")} testid="forgot-password">
      <ActionForm action={askLinkAction} submitLabel={t("forgot.submit")} pendingLabel={t("progress.sending")}>
        <TextField name="email" type="email" label={t("field.email")} required example={t("users.emailExample")} autoComplete="username" />
      </ActionForm>
    </AuthShell>
  );
}
