import { adminCtx } from "@/core/admin";
import { getSettingByLocale, getSetting } from "@/core/settings";
import { KNOWN_LOCALES, localeName } from "@/core/i18n/locales";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextField } from "@/components/admin/Field";
import { ImageField } from "@/components/admin/ImageField";
import { ui } from "@/components/admin/ui";
import { saveSettings } from "./actions";

const TRANSLATABLE = ["site.name", "site.tagline", "hero.title", "hero.text", "footer.text"] as const;

export default async function SettingsPage() {
  const { t, config } = await adminCtx("admin");
  const values: Record<string, Record<string, unknown>> = {};
  for (const key of TRANSLATABLE) values[key] = await getSettingByLocale(key);
  const logo = await getSetting<string>("site.logo");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("nav.settings")}</h1>
      <ActionForm action={saveSettings} submitLabel={t("action.save")} className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.languages")}</h2>
          <p className="text-sm text-muted">{t("settings.languagesHelp")}</p>
          <Select name="defaultLocale" label={t("settings.defaultLocale")} defaultValue={config.defaultLocale}
            options={Object.entries(KNOWN_LOCALES).map(([c, n]) => ({ value: c, label: n }))} />
          <fieldset>
            <legend className={ui.label}>{t("settings.enabledLocales")}</legend>
            <div className="grid gap-1 sm:grid-cols-3">
              {Object.entries(KNOWN_LOCALES).map(([code, name]) => (
                <Checkbox key={code} name="enabledLocales" label={name} defaultChecked={config.locales.includes(code)} />
              ))}
            </div>
          </fieldset>
          <Select name="adminLocale" label={t("settings.adminLocale")} help={t("settings.adminLocaleHelp")} defaultValue={config.adminLocale ?? config.defaultLocale}
            options={Object.keys(KNOWN_LOCALES).map((c) => ({ value: c, label: `${localeName(c)}${UI_LOCALES.includes(c) ? "" : ` (${t("settings.fallbackEn")})`}` }))} />
          <Checkbox name="autoDetect" label={t("settings.autoDetect")} help={t("settings.autoDetectHelp")} defaultChecked={config.autoDetect} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.identity")}</h2>
          {config.locales.map((l) => (
            <fieldset key={l} className={`${ui.card} space-y-3`}>
              <legend className="px-2 text-sm font-medium">{localeName(l)}</legend>
              <TextField name={`site.name__${l}`} label={t("settings.siteName")} defaultValue={String(values["site.name"]?.[l] ?? "")} />
              <TextField name={`site.tagline__${l}`} label={t("settings.tagline")} defaultValue={String(values["site.tagline"]?.[l] ?? "")} />
              <TextField name={`hero.title__${l}`} label={t("settings.heroTitle")} defaultValue={String(values["hero.title"]?.[l] ?? "")} />
              <TextField name={`hero.text__${l}`} label={t("settings.heroText")} defaultValue={String(values["hero.text"]?.[l] ?? "")} />
              <TextField name={`footer.text__${l}`} label={t("settings.footerText")} defaultValue={String(values["footer.text"]?.[l] ?? "")} />
            </fieldset>
          ))}
          <ImageField name="logo" label={t("settings.logo")} defaultValue={logo} uploadLabel={t("action.upload")} />
          <TextField name="contactEmail" type="email" label={t("settings.contactEmail")} defaultValue={config.contactEmail} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.appearance")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField name="background" type="color" label={t("settings.background")} defaultValue={config.background} />
            <TextField name="accent" type="color" label={t("settings.accent")} defaultValue={config.accent} />
            <Select name="font" label={t("settings.font")} defaultValue={config.font}
              options={[{ value: "sans", label: "Sans-serif" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Monospace" }]} />
          </div>
          <p className={ui.help}>{t("settings.appearanceHelp")}</p>
        </section>
      </ActionForm>
    </div>
  );
}
