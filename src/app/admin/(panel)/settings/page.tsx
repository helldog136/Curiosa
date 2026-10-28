import { providersOf } from "@/core/services/topics";
import { SOCIAL_TOPIC } from "@/core/social";
import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { getSettingByLocale, getSetting } from "@/core/settings";
import { systemTimezone, TIMEZONE_SETTING } from "@/core/siteTime";
import { KNOWN_LOCALES, localeName } from "@/core/i18n/locales";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ImageField } from "@/components/admin/ImageField";
import { Tabs } from "@/components/admin/Tabs";
import { ui } from "@/components/admin/ui";
import { hasRole } from "@/core/permissions";
import { getMailConfig } from "@/core/services/mail";
import { getAiBlocking, getSiteEntity, isLlmsTxtEnabled } from "@/core/seoSettings";
import { saveSettings } from "./actions";

import { saveMail, sendTestMail } from "./mail-actions";
import { retryRawgHandover } from "./rawg-actions";
import { providerInstance } from "@/core/modules/dependencies";
import { COVERS_MODULE, COVERS_SERVICE, ensureRawgHandover, handoverPending } from "@/core/services/rawgHandover";
import { trackRawgJob } from "@/core/services/rawgNote";
import Link from "next/link";

const TRANSLATABLE = ["site.name", "site.tagline", "site.about", "footer.text", "header.secondaryLabel", "header.buttonLabel", "privacy.extra"] as const;

export default async function SettingsPage() {
  const { t, config, advanced, user } = await adminCtx("admin");
  const socialCount = (await providersOf(SOCIAL_TOPIC)).length;
  const mail = await getMailConfig();
  const isOwner = hasRole(user, "owner");
  // Jaquettes de jeux (voir services/rawgHandover.ts) : la clé et les corrections se règlent dans le module « Jaquettes de jeux ». Si le cœur garde encore celles de l'ancien service
  // (reprise pas faite : catalogue injoignable…), la reprise est retentée ici (espacée, en arrière-plan) et la carte l'explique.
  const rawgModule = isOwner ? await providerInstance(COVERS_SERVICE, COVERS_MODULE) : null;
  const rawgPending = isOwner && (await handoverPending());
  if (rawgPending) trackRawgJob(ensureRawgHandover({ install: true }));
  const values: Record<string, Record<string, unknown>> = {};
  for (const key of TRANSLATABLE) values[key] = await getSettingByLocale(key);
  const logo = await getSetting<string>("site.logo");
  const timezoneSaved = String((await getSetting<string>(TIMEZONE_SETTING)) ?? "");
  const ai = await getAiBlocking();
  const llmsTxt = await isLlmsTxtEnabled();
  const entity = await getSiteEntity();

  return (
    <div className="space-y-6">
      <header><h1 className={ui.pageTitle}>{advanced ? t("nav.settings") : t("nav.settings.simple")}</h1>{!advanced && <p className={ui.pageIntro}>{t("settings.intro.simple")}</p>}</header>
      <Tabs tabs={[{ id: "site", label: t("settings.identity") }, { id: "languages", label: t("settings.languages") }, { id: "appearance", label: t("settings.appearanceTab") }, { id: "privacy", label: t("settings.privacy") }, ...(hasRole(user, "owner") ? [{ id: "mail", label: t("settings.mail") }, ...(rawgModule || rawgPending ? [{ id: "services", label: t("settings.services") }] : [])] : [])]}>
      <div data-tab="site languages appearance privacy">
      <ActionForm action={saveSettings} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-8" submitTabs="site languages appearance privacy">
        {advanced && <input type="hidden" name="__adv" value="1" />}
        <section data-tab="site" className="space-y-5">
          <p className={ui.help}>{t("settings.identityIntro")}</p>
          <div className={`${ui.card} space-y-5`}>
            <h3 className="font-semibold">{t("settings.who")}</h3>
            <Select name="entityType" label={t("settings.entity")} help={t("settings.entityHelp")} defaultValue={entity}
              options={[{ value: "organization", label: t("settings.entity.organization") }, { value: "person", label: t("settings.entity.person") }]} />
            {config.locales.map((l) => (
              <fieldset key={l} className="space-y-4">
                {config.locales.length > 1 && <legend className="mb-2 text-sm font-medium text-muted">{localeName(l)}</legend>}
                <TextField name={`site.name__${l}`} label={t("settings.siteName")} defaultValue={String(values["site.name"]?.[l] ?? "")} />
                <TextField name={`site.tagline__${l}`} label={t("settings.tagline")} help={t("settings.taglineHelp")} defaultValue={String(values["site.tagline"]?.[l] ?? "")} />
                <TextArea name={`site.about__${l}`} label={t("settings.about")} help={t("settings.aboutHelp")} rows={4} defaultValue={String(values["site.about"]?.[l] ?? "")} />
              </fieldset>
            ))}
          </div>
          <div className={`${ui.card} space-y-4`}>
            <div>
              <h3 className="font-semibold">{t("settings.logos")}</h3>
              <p className={ui.help}>{t("settings.logosHelp")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1"><ImageField svg name="logoWide" label={t("settings.logoWide")} defaultValue={config.logos.wide} uploadLabel={t("action.upload")} /><p className={ui.help}>{t("settings.logoWideHelp")}</p></div>
              <div className="space-y-1"><ImageField svg name="logo" label={t("settings.logoSquare")} defaultValue={logo} uploadLabel={t("action.upload")} /><p className={ui.help}>{t("settings.logoSquareHelp")}</p></div>
              <div className="space-y-1"><ImageField svg name="favicon" label={t("settings.favicon")} defaultValue={config.favicon} uploadLabel={t("action.upload")} /><p className={ui.help}>{t("settings.faviconHelp")}</p></div>
              <div className="space-y-1"><ImageField name="logoShare" label={t("settings.logoShare")} defaultValue={config.logos.share} uploadLabel={t("action.upload")} /><p className={ui.help}>{t("settings.logoShareHelp")}</p></div>
            </div>
            <details className="rounded-xl border border-line p-3" open={!!(config.logos.wideDark || config.logos.squareDark)}>
              <summary className="cursor-pointer text-sm font-medium">{t("settings.logosDark")}</summary>
              <p className={`${ui.help} mt-2`}>{t("settings.logosDarkHelp")}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <ImageField svg name="logoWideDark" label={t("settings.logoWideDark")} defaultValue={config.logos.wideDark} uploadLabel={t("action.upload")} />
                <ImageField svg name="logoDark" label={t("settings.logoSquareDark")} defaultValue={config.logos.squareDark} uploadLabel={t("action.upload")} />
              </div>
            </details>
          </div>
          {advanced && (
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("settings.contactCard")}</h3>
              <TextField name="contactEmail" type="email" label={t("settings.contactEmail")} help={t("settings.contactEmailHelp")} defaultValue={config.contactEmail} />
              <TextField name="timezone" label={t("settings.timezone")} help={t("settings.timezoneHelp", { zone: systemTimezone() })} defaultValue={timezoneSaved} placeholder="Europe/Brussels" autoComplete="off" />
              {config.locales.map((l) => (
                <TextField key={l} name={`footer.text__${l}`} label={`${t("settings.footerText")}${config.locales.length > 1 ? ` — ${localeName(l)}` : ""}`} defaultValue={String(values["footer.text"]?.[l] ?? "")} />
              ))}
            </div>
          )}
        </section>

        <section data-tab="languages" className="space-y-5">
          <p className={ui.help}>{t("settings.languagesHelp")}</p>
          <div className={`${ui.card} space-y-5`}>
            <Select name="defaultLocale" label={t("settings.defaultLocale")} defaultValue={config.defaultLocale}
              options={Object.entries(KNOWN_LOCALES).map(([c, n]) => ({ value: c, label: n }))} />
            {/* Version simple : une seule langue suffit à la plupart des sites ; les autres sont repliées (et restent envoyées au formulaire). */}
            <details open={advanced || config.locales.length > 1} className={advanced ? "" : "rounded-xl border border-line bg-bg px-4 py-3"}>
              <summary className={`cursor-pointer ${advanced ? "hidden" : "text-[15px] font-medium"}`}>{t("settings.moreLanguages")}</summary>
              <fieldset className={advanced ? "" : "mt-3"}>
                <legend className={ui.label}>{t("settings.enabledLocales")}</legend>
                <p className={`${ui.help} mb-2`}>{t("settings.enabledLocalesHelp")}</p>
                <div className="grid gap-1 sm:grid-cols-3">
                  {Object.entries(KNOWN_LOCALES).map(([code, name]) => (
                    <Checkbox key={code} name="enabledLocales" value={code} label={name} defaultChecked={config.locales.includes(code)} />
                  ))}
                </div>
              </fieldset>
            </details>
          </div>
          {advanced && (
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("settings.languagesMore")}</h3>
              <Select name="adminLocale" label={t("settings.adminLocale")} help={t("settings.adminLocaleHelp")} defaultValue={config.adminLocale ?? config.defaultLocale}
                options={Object.keys(KNOWN_LOCALES).map((c) => ({ value: c, label: `${localeName(c)}${UI_LOCALES.includes(c) ? "" : ` (${t("settings.fallbackEn")})`}` }))} />
              <Checkbox name="autoDetect" label={t("settings.autoDetect")} help={t("settings.autoDetectHelp")} defaultChecked={config.autoDetect} />
            </div>
          )}
        </section>

        <section data-tab="privacy" className="space-y-5">
          <p className={ui.help}>{t("settings.privacyHelp")}</p>
          <div className={`${ui.card} space-y-4`}>
            <h3 className="font-semibold">{t("settings.privacyVisits")}</h3>
            <Checkbox name="statsEnabled" label={t("settings.stats")} help={t("settings.statsHelp")} defaultChecked={config.statsEnabled} />
            <Checkbox name="newsToggle" label={t("settings.newsToggle")} help={t("settings.newsToggleHelp")} defaultChecked={config.newsToggle} />
          </div>
          <div className={`${ui.card} space-y-4`} id="ai-robots" data-testid="ai-settings">
            <input type="hidden" name="__ai" value="1" />
            <div>
              <h3 className="font-semibold">{t("settings.aiCard")}</h3>
              <p className={ui.help}>{t("settings.aiExplain")}</p>
            </div>
            {ai.fromLegacy && ai.blockAnswers && <p role="note" className="rounded-lg border border-line bg-bg p-3 text-sm" data-testid="ai-legacy-note">{t("settings.aiLegacyNote")}</p>}
            <Select name="aiTraining" label={t("settings.aiTraining")} help={t("settings.aiTrainingHelp")} defaultValue={ai.blockTraining ? "block" : "allow"}
              options={[{ value: "block", label: t("settings.aiBlocked") }, { value: "allow", label: t("settings.aiAllowed") }]} />
            <Select name="aiAnswers" label={t("settings.aiAnswers")} help={t("settings.aiAnswersHelp")} defaultValue={ai.blockAnswers ? "block" : "allow"}
              options={[{ value: "allow", label: t("settings.aiAllowed") }, { value: "block", label: t("settings.aiBlocked") }]} />
            <Checkbox name="llmsTxt" label={t("settings.llmsTxt")} help={t("settings.llmsTxtHelp")} defaultChecked={llmsTxt} />
            <a href="/admin/ai-visibility" className="inline-block text-sm font-medium text-accent hover:underline">{t("settings.aiSeeChecks")}</a>
          </div>
          <div className={`${ui.card} space-y-4`}>
            <h3 className="font-semibold">{t("settings.privacyPage")}</h3>
            <p className={ui.help}>{t("settings.privacyPageHelp")}</p>
            {config.locales.map((l) => (
              <TextArea key={l} name={`privacy.extra__${l}`} label={`${t("settings.privacyExtra")}${config.locales.length > 1 ? ` — ${localeName(l)}` : ""}`} rows={6} defaultValue={String(values["privacy.extra"]?.[l] ?? "")} help={t("settings.privacyExtraHelp")} />
            ))}
            <a href="/privacy" target="_blank" rel="noopener" className="inline-block text-sm font-medium text-accent hover:underline">{t("settings.privacyView")} ↗</a>
          </div>
        </section>

        <section data-tab="appearance" className="space-y-6">
          <h2 className="text-lg font-semibold">{t("settings.appearanceTab")}</h2>
          <div className={`${ui.card} space-y-3`} data-testid="appearance-moved">
            <h3 className="font-semibold">{t("settings.appearanceMovedTitle")}</h3>
            <p className={ui.help}>{t("settings.appearanceMovedHelp")}</p>
            <Link href="/admin/appearance" className={`${ui.btnPrimary} min-h-11`}>{t("settings.appearanceOpen")}</Link>
          </div>
          <div className={`${ui.card} space-y-4`}>
            <h3 className="font-semibold">{t("settings.headerLinks")}</h3>
            {socialCount > 0
              ? <Checkbox name="headerSocials" label={t("settings.header.socials")} help={t("settings.header.socialsHelp", { count: socialCount })} defaultChecked={config.header.socials} />
              : <p className={ui.help}>{t("settings.header.socialsNone")}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm font-medium">{t("settings.header.secondary")}</p>
                {config.locales.map((l) => <TextField key={l} name={`header.secondaryLabel__${l}`} label={`${t("settings.header.label")}${config.locales.length > 1 ? ` — ${localeName(l)}` : ""}`} defaultValue={String(values["header.secondaryLabel"]?.[l] ?? "")} />)}
                <TextField name="headerSecondaryHref" label={t("settings.header.href")} placeholder="/contact" defaultValue={String((await getSetting<string>("header.secondaryHref")) ?? "")} />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">{t("settings.header.button")}</p>
                {config.locales.map((l) => <TextField key={l} name={`header.buttonLabel__${l}`} label={`${t("settings.header.label")}${config.locales.length > 1 ? ` — ${localeName(l)}` : ""}`} defaultValue={String(values["header.buttonLabel"]?.[l] ?? "")} />)}
                <TextField name="headerButtonHref" label={t("settings.header.href")} placeholder="https://…" defaultValue={String((await getSetting<string>("header.buttonHref")) ?? "")} />
              </div>
            </div>
            <p className={ui.help}>{t("settings.header.linksHelp")}</p>
          </div>
        </section>
      </ActionForm>
      </div>

      {isOwner && (
        <section data-tab="mail" className="space-y-5">
          <p className={ui.help}>{t("settings.mailHelp")}</p>
          <p><span className={mail ? ui.chipOk : ui.chipWarn}>{mail ? t("settings.mailStatusOn") : t("settings.mailStatusOff")}</span></p>
          <ActionForm action={saveMail} submitLabel={t("settings.mailSave")} className="space-y-5">
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("settings.mailServer")}</h3>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <TextField name="mailHost" label={t("settings.mailHost")} defaultValue={mail?.host ?? ""} placeholder="smtp.example.com" autoComplete="off" />
                <TextField name="mailPort" type="number" label={t("settings.mailPort")} defaultValue={mail?.port ?? 587} />
              </div>
              <Checkbox name="mailSecure" label={t("settings.mailSecure")} defaultChecked={mail?.secure ?? false} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="mailUser" label={t("settings.mailUser")} defaultValue={mail?.user ?? ""} autoComplete="off" />
                <TextField name="mailPass" type="password" label={t("settings.mailPass")} help={t("settings.mailPassHelp")} autoComplete="new-password" />
              </div>
            </div>
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("settings.mailSender")}</h3>
              <TextField name="mailFrom" label={t("settings.mailFrom")} help={t("settings.mailFromHelp")} defaultValue={mail?.from ?? ""} />
            </div>
          </ActionForm>
          {mail && (
            <ActionForm action={sendTestMail} submitLabel={t("settings.mailTest")} pendingLabel={t("progress.sending")} className="space-y-3">{null}</ActionForm>
          )}
        </section>
      )}
      {isOwner && (rawgModule || rawgPending) && (
        <section data-tab="services" className="space-y-5">
          <p className={ui.help}>{t("settings.servicesHelp")}</p>
          {rawgModule && (
            <div className={`${ui.card} space-y-4`} data-testid="rawg-moved-card">
              <div>
                <h3 className="font-semibold">{t("settings.rawgTitle")}</h3>
                <p className={ui.help}>{t("settings.rawgMoved")}</p>
              </div>
              <Link href={`/admin/instances/${rawgModule.instance.id}`} className={`${ui.btnPrimary} min-h-11`}>{t("settings.rawgMovedOpen")}</Link>
            </div>
          )}
          {!rawgModule && rawgPending && (
            <div className={`${ui.card} space-y-4`} data-testid="rawg-pending-card">
              <div>
                <h3 className="font-semibold">{t("settings.rawgTitle")}</h3>
                <p className={ui.help}>{t("settings.rawgPending")}</p>
              </div>
              <ActionForm action={retryRawgHandover} submitLabel={t("settings.rawgRetry")} pendingLabel={t("progress.checking")} className="space-y-3">{null}</ActionForm>
              <Link href={`/admin/extensions/add/details?id=${COVERS_MODULE}`} className={`${ui.btn} min-h-11`}>{t("settings.rawgOpenCatalogue")}</Link>
            </div>
          )}
        </section>
      )}
      </Tabs>
    </div>
  );
}
