import { adminCtx } from "@/core/admin";
import { getSettingByLocale, getSetting } from "@/core/settings";
import { KNOWN_LOCALES, localeName } from "@/core/i18n/locales";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ImageField } from "@/components/admin/ImageField";
import { ThemePicker } from "@/components/admin/ThemePicker";
import { ui } from "@/components/admin/ui";
import { hasRole } from "@/core/permissions";
import { getMailConfig } from "@/core/services/mail";
import { saveSettings } from "./actions";

/** Exemple affiché tant qu'aucune description personnalisée n'est enregistrée : le format est décrit dans docs/BACKGROUND.md. */
const BG_EXAMPLE = JSON.stringify([
  { type: "linear", angle: 90, stops: [{ color: "bg", at: 20 }, { color: "accent", at: 100, a: 38 }] },
  { type: "dots", color: "#ffffff", size: 2, gap: 28, opacity: 85, side: "left", span: 40 },
], null, 2);
import { saveMail, sendTestMail } from "./mail-actions";

const TRANSLATABLE = ["site.name", "site.tagline", "site.about", "footer.text"] as const;

export default async function SettingsPage() {
  const { t, config, advanced, user } = await adminCtx("admin");
  const mail = await getMailConfig();
  const values: Record<string, Record<string, unknown>> = {};
  for (const key of TRANSLATABLE) values[key] = await getSettingByLocale(key);
  const logo = await getSetting<string>("site.logo");
  const blockAiBots = (await getSetting<boolean>("seo.blockAiBots")) !== false;

  return (
    <div className="space-y-6">
      <header><h1 className={ui.pageTitle}>{t("nav.settings")}</h1>{!advanced && <p className={ui.pageIntro}>{t("settings.intro.simple")}</p>}</header>
      <ActionForm action={saveSettings} submitLabel={t("action.save")} className="space-y-8">
        {advanced && <input type="hidden" name="__adv" value="1" />}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.languages")}</h2>
          <p className="text-sm text-muted">{t("settings.languagesHelp")}</p>
          <Select name="defaultLocale" label={t("settings.defaultLocale")} defaultValue={config.defaultLocale}
            options={Object.entries(KNOWN_LOCALES).map(([c, n]) => ({ value: c, label: n }))} />
          {/* Version simple : une seule langue suffit à la plupart des sites ; les autres sont repliées (et restent envoyées au formulaire). */}
          <details open={advanced || config.locales.length > 1} className={advanced ? "" : "rounded-xl border border-line bg-bg px-4 py-3"}>
            <summary className={`cursor-pointer ${advanced ? "hidden" : "text-[15px] font-medium"}`}>{t("settings.moreLanguages")}</summary>
            <fieldset className={advanced ? "" : "mt-3"}>
              <legend className={ui.label}>{t("settings.enabledLocales")}</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {Object.entries(KNOWN_LOCALES).map(([code, name]) => (
                  <Checkbox key={code} name="enabledLocales" value={code} label={name} defaultChecked={config.locales.includes(code)} />
                ))}
              </div>
            </fieldset>
          </details>
          {advanced && <Select name="adminLocale" label={t("settings.adminLocale")} help={t("settings.adminLocaleHelp")} defaultValue={config.adminLocale ?? config.defaultLocale}
            options={Object.keys(KNOWN_LOCALES).map((c) => ({ value: c, label: `${localeName(c)}${UI_LOCALES.includes(c) ? "" : ` (${t("settings.fallbackEn")})`}` }))} />}
          {advanced && <Checkbox name="blockAiBots" label={t("settings.blockAiBots")} help={t("settings.blockAiBotsHelp")} defaultChecked={blockAiBots} />}
          {advanced && <Checkbox name="autoDetect" label={t("settings.autoDetect")} help={t("settings.autoDetectHelp")} defaultChecked={config.autoDetect} />}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.identity")}</h2>
          {config.locales.map((l) => (
            <fieldset key={l} className={`${ui.card} space-y-4`}>
              {(advanced || config.locales.length > 1) && <legend className="px-2 text-sm font-medium">{localeName(l)}</legend>}
              <TextField name={`site.name__${l}`} label={t("settings.siteName")} defaultValue={String(values["site.name"]?.[l] ?? "")} />
              <TextField name={`site.tagline__${l}`} label={t("settings.tagline")} defaultValue={String(values["site.tagline"]?.[l] ?? "")} />
              <TextArea name={`site.about__${l}`} label={t("settings.about")} help={t("settings.aboutHelp")} rows={4} defaultValue={String(values["site.about"]?.[l] ?? "")} />
              {advanced && <TextField name={`footer.text__${l}`} label={t("settings.footerText")} defaultValue={String(values["footer.text"]?.[l] ?? "")} />}
            </fieldset>
          ))}
          <ImageField name="logo" label={t("settings.logo")} defaultValue={logo} uploadLabel={t("action.upload")} />
          {advanced && <TextField name="contactEmail" type="email" label={t("settings.contactEmail")} defaultValue={config.contactEmail} />}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.appearance")}</h2>
          <ThemePicker background={config.background} accent={config.accent} advanced={advanced}
            labels={{ background: t("settings.background"), accent: t("settings.accent") }}
            names={{ night: t("theme.night"), ocean: t("theme.ocean"), forest: t("theme.forest"), rose: t("theme.rose"), violet: t("theme.violet"), daylight: t("theme.daylight"), paper: t("theme.paper") }} />
          <Select name="glow" label={t("settings.glow")} help={t("settings.glowHelp")} defaultValue={config.glow.level}
            options={[
              { value: "none", label: t("settings.glow.none") }, { value: "soft", label: t("settings.glow.soft") }, { value: "strong", label: t("settings.glow.strong") },
              ...(advanced ? [{ value: "custom", label: t("settings.glow.custom") }] : []),
            ]} />
          {advanced && (
            <fieldset className="space-y-3 rounded-2xl border border-line p-4">
              <legend className="px-2 text-sm font-medium">{t("settings.glow.tuning")}</legend>
              <p className={ui.help}>{t("settings.glow.tuningHelp")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="glow_count" type="number" label={t("settings.glow.count")} help={t("settings.glow.countHelp")} defaultValue={String(config.glow.custom.count)} />
                <TextField name="glow_size" type="number" label={t("settings.glow.size")} help={t("settings.glow.sizeHelp")} defaultValue={String(config.glow.custom.size)} />
                <TextField name="glow_variance" type="number" label={t("settings.glow.variance")} help={t("settings.glow.varianceHelp")} defaultValue={String(config.glow.custom.variance)} />
                <TextField name="glow_hue" type="number" label={t("settings.glow.hue")} help={t("settings.glow.hueHelp")} defaultValue={String(config.glow.custom.hue)} />
                <TextField name="glow_intensity" type="number" label={t("settings.glow.intensity")} help={t("settings.glow.intensityHelp")} defaultValue={String(config.glow.custom.intensity)} />
                <TextField name="glow_seed" type="number" label={t("settings.glow.seed")} help={t("settings.glow.seedHelp")} defaultValue={String(config.glow.custom.seed)} />
              </div>
            </fieldset>
          )}
          <Select name="bgPreset" label={t("settings.bg")} help={t("settings.bgHelp")} defaultValue={config.bg.preset}
            options={[
              { value: "none", label: t("settings.bg.none") }, { value: "dots", label: t("settings.bg.dots") }, { value: "dusk", label: t("settings.bg.dusk") }, { value: "grid", label: t("settings.bg.grid") },
              ...(advanced ? [{ value: "custom", label: t("settings.bg.custom") }] : []),
            ]} />
          <ImageField name="bgImage" label={t("settings.bgImage")} defaultValue={config.bg.image} uploadLabel={t("action.upload")} />
          {advanced && (
            <TextArea name="bgCustom" label={t("settings.bgCustom")} help={t("settings.bgCustomHelp")} rows={10} mono defaultValue={config.bg.custom || BG_EXAMPLE} />
          )}
          {advanced && (
            <Select name="font" label={t("settings.font")} defaultValue={config.font}
              options={[{ value: "sans", label: "Sans-serif" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Monospace" }]} />
          )}
          {advanced && <p className={ui.help}>{t("settings.appearanceHelp")}</p>}
        </section>
      </ActionForm>

      {hasRole(user, "owner") && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("settings.mail")}</h2>
          <p className="text-sm text-muted">{t("settings.mailHelp")}</p>
          <p className={ui.help}>{mail ? t("settings.mailStatusOn") : t("settings.mailStatusOff")}</p>
          <ActionForm action={saveMail} submitLabel={t("settings.mailSave")} className="space-y-3">
            <TextField name="mailHost" label={t("settings.mailHost")} defaultValue={mail?.host ?? ""} placeholder="smtp.example.com" autoComplete="off" />
            <TextField name="mailPort" type="number" label={t("settings.mailPort")} defaultValue={mail?.port ?? 587} />
            <Checkbox name="mailSecure" label={t("settings.mailSecure")} defaultChecked={mail?.secure ?? false} />
            <TextField name="mailUser" label={t("settings.mailUser")} defaultValue={mail?.user ?? ""} autoComplete="off" />
            <TextField name="mailPass" type="password" label={t("settings.mailPass")} help={t("settings.mailPassHelp")} autoComplete="new-password" />
            <TextField name="mailFrom" label={t("settings.mailFrom")} help={t("settings.mailFromHelp")} defaultValue={mail?.from ?? ""} />
          </ActionForm>
          {mail && (
            <ActionForm action={sendTestMail} submitLabel={t("settings.mailTest")} className="space-y-3">{null}</ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
