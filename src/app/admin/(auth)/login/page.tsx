import { redirect } from "next/navigation";
import { getAdminTranslator } from "@/core/i18n/request";
import { currentUser } from "@/core/permissions";
import { countUsers } from "@/core/content/service";
import { LoginForm } from "@/components/admin/LoginForm";
import { ADMIN_HREF, FORGOT_PASSWORD_HREF, SETUP_HREF } from "@/core/adminLinks";
import { isMailConfigured } from "@/core/services/mail";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("login.title"));
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if ((await countUsers()) === 0) redirect(SETUP_HREF);
  if (await currentUser({ allowForced: true })) redirect(ADMIN_HREF); // connecté, même avec un mot de passe temporaire à remplacer : /admin sait où l'envoyer
  const { t } = await getAdminTranslator();
  const { changed } = await searchParams;
  // Forgot password only exists when the site can send e-mail: without it, the link would lead nowhere.
  const canReset = await isMailConfigured().catch(() => false);
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-2xl font-bold">{t("login.title")}</h1>
      {changed === "1" && <p role="status" className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">{t("login.changed")}</p>}
      <LoginForm labels={{ email: t("field.email"), password: t("field.password"), submit: t("login.submit"), code: t("login.code"), codeHelp: t("login.codeHelp"), codeSubmit: t("login.codeSubmit"), back: t("login.back"), passkey: t("login.passkey"), passkeyOr: t("login.passkeyOr"), passkeyCancelled: t("login.passkeyCancelled") }} />
      {canReset && <p className="text-sm"><a href={FORGOT_PASSWORD_HREF} data-testid="forgot-link" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">{t("forgot.link")}</a></p>}
    </div>
  );
}
