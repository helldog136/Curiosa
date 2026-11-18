import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { HomeMenuHeader } from "@/components/admin/HomeMenuHeader";
import { PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { getSetting, getSettingByLocale } from "@/core/settings";
import { saveHeaderLinks } from "../actions";

export const dynamic = "force-dynamic";

/** The "Link and button" tab: one link and one button at the very top of every page, next to the menu. */
export default async function HeaderLinksPage() {
  const { t, config } = await adminCtx("admin");
  const secondaryLabels = await getSettingByLocale("header.secondaryLabel");
  const buttonLabels = await getSettingByLocale("header.buttonLabel");
  const secondaryHref = String((await getSetting<string>("header.secondaryHref")) ?? "");
  const buttonHref = String((await getSetting<string>("header.buttonHref")) ?? "");
  const lang = (l: string) => (config.locales.length > 1 ? ` — ${localeName(l)}` : "");
  return (
    <div className="space-y-6">
      <HomeMenuHeader t={t} current="header" />
      <PageHeader level={2} title={t("homemenu.tab.header")} intro={t("navigation.headerIntro")} />
      <ActionForm action={saveHeaderLinks} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={`${ui.card} space-y-3`}>
            <h3 className="font-semibold">{t("settings.header.secondary")}</h3>
            {config.locales.map((l) => <TextField key={l} name={`header.secondaryLabel__${l}`} label={`${t("settings.header.label")}${lang(l)}`} defaultValue={String(secondaryLabels[l] ?? "")} />)}
            <TextField name="headerSecondaryHref" label={t("settings.header.href")} placeholder="/contact" defaultValue={secondaryHref} />
          </div>
          <div className={`${ui.card} space-y-3`}>
            <h3 className="font-semibold">{t("settings.header.button")}</h3>
            {config.locales.map((l) => <TextField key={l} name={`header.buttonLabel__${l}`} label={`${t("settings.header.label")}${lang(l)}`} defaultValue={String(buttonLabels[l] ?? "")} />)}
            <TextField name="headerButtonHref" label={t("settings.header.href")} placeholder="https://…" defaultValue={buttonHref} />
          </div>
        </div>
        <p className={ui.help}>{t("settings.header.linksHelp")}</p>
      </ActionForm>
    </div>
  );
}
