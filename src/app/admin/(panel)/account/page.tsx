import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Select, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { changePassword, signOutEverywhere, updateProfile } from "./actions";

export default async function AccountPage() {
  const { t, user, config } = await adminCtx("editor");
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
      <section className={`${ui.card} space-y-3`} data-testid="sessions-card">
        <h2 className="text-lg font-semibold">{t("account.sessions")}</h2>
        <p className="text-sm text-muted">{t("account.sessionsHelp")}</p>
        <form action={signOutEverywhere}><ConfirmButton message={t("account.sessionsConfirm")}>{t("account.sessionsButton")}</ConfirmButton></form>
      </section>
    </div>
  );
}
