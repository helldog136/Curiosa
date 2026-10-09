import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Select, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { TwoFactorPanel } from "@/components/admin/TwoFactorPanel";
import { remainingRecoveryCodes } from "@/core/auth/twoFactor";
import { getSetting } from "@/core/settings";
import { changePassword, confirmTwoFactor, disableMyTwoFactor, regenerateMyRecoveryCodes, signOutEverywhere, startTwoFactor, updateProfile } from "./actions";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ need2fa?: string }> }) {
  const { t, user, config } = await adminCtx("editor", { allowUnenrolled: true });
  const { need2fa } = await searchParams;
  const enforced = (await getSetting<boolean>("security.require2fa")) === true;
  const remaining = user.twoFactor ? await remainingRecoveryCodes(user.id) : 0;
  const options = [
    { value: "", label: `${t("account.siteDefault")}` },
    ...[...new Set([...UI_LOCALES, ...config.locales])].map((l) => ({ value: l, label: `${localeName(l)}${UI_LOCALES.includes(l) ? "" : ` (${t("settings.fallbackEn")})`}` })),
  ];
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t("nav.myAccount")}</h1>
      <section className={`${ui.card} space-y-4`}>
        <ActionForm action={updateProfile} submitLabel={t("action.save")}>
          <TextField name="name" label={t("field.name")} defaultValue={user.name} required />
          <Select name="locale" label={t("account.language")} help={t("account.languageHelp")} defaultValue={user.locale ?? ""} options={options} />
        </ActionForm>
      </section>
      <section className={`${ui.card} space-y-4`}>
        <h2 className="text-lg font-semibold">{t("account.password")}</h2>
        <ActionForm action={changePassword} submitLabel={t("action.save")}>
          <TextField name="current" type="password" label={t("account.currentPassword")} required autoComplete="current-password" />
          <TextField name="next" type="password" label={t("account.newPassword")} required autoComplete="new-password" help={t("users.passwordHelp")} />
        </ActionForm>
      </section>
      <TwoFactorPanel
        enabled={user.twoFactor} remaining={remaining} enforced={enforced} needed={user.needsTwoFactor || need2fa === "1"}
        start={startTwoFactor} confirm={confirmTwoFactor} disable={disableMyTwoFactor} regenerate={regenerateMyRecoveryCodes}
        labels={{ title: t("account.twofa.title"), help: t("account.twofa.help"), enable: t("account.twofa.enable"), scan: t("account.twofa.scan"), key: t("account.twofa.key"), confirm: t("account.twofa.confirm"), confirmButton: t("account.twofa.confirmButton"), codesTitle: t("account.twofa.codesTitle"), codesHelp: t("account.twofa.codesHelp"), codesDone: t("account.twofa.codesDone"), enabled: t("account.twofa.enabled"), remaining: t("account.twofa.remaining"), disable: t("account.twofa.disable"), disableHelp: t("account.twofa.disableHelp"), password: t("field.password"), code: t("login.code"), regen: t("account.twofa.regen"), regenHelp: t("account.twofa.regenHelp"), required: t("account.twofa.required"), need: t("account.twofa.need"), cancel: t("floating.discard"), print: t("account.twofa.print") }}
      />
      <section className={`${ui.card} space-y-3`} data-testid="sessions-card">
        <h2 className="text-lg font-semibold">{t("account.sessions")}</h2>
        <p className="text-sm text-muted">{t("account.sessionsHelp")}</p>
        <form action={signOutEverywhere}><ConfirmButton message={t("account.sessionsConfirm")}>{t("account.sessionsButton")}</ConfirmButton></form>
      </section>
    </div>
  );
}
