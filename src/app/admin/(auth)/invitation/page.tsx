import { getAdminTranslator } from "@/core/i18n/request";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { InviteAccept } from "@/components/admin/InviteAccept";
import { acceptInvitationAction, peekInvitationAction } from "./actions";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("invite.accept.title"));
}

/** Public page of an invitation. The token is in the address fragment (never sent to the server); headers (no-store, no-referrer) are set in next.config.mjs. */
export default async function InvitationPage() {
  const { t } = await getAdminTranslator();
  const labels = {
    loading: t("invite.accept.loading"), missing: t("invite.accept.missing"), invalid: t("invite.accept.invalid"), rate: t("invite.accept.rate"), title: t("invite.accept.title"),
    intro: t("invite.accept.intro", { role: "{role}" }), account: t("invite.accept.account", { email: "{email}" }), name: t("invite.accept.name"), nameExample: t("invite.accept.nameExample"),
    password: t("invite.accept.password"), confirm: t("invite.accept.confirm"), help: t("choosePassword.help", { n: MIN_PASSWORD_LENGTH }), submit: t("invite.accept.submit"), pending: t("progress.creating"),
  };
  return (
    <main className="mx-auto mt-12 max-w-sm space-y-6 px-4 pb-12 sm:mt-24" data-testid="invitation">
      <InviteAccept peek={peekInvitationAction} action={acceptInvitationAction} labels={labels} minLength={MIN_PASSWORD_LENGTH} />
    </main>
  );
}
