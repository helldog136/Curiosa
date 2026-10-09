import { providersOf } from "@/core/services/topics";
import { SOCIAL_TOPIC } from "@/core/social";
import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { getSettingByLocale, getSetting } from "@/core/settings";
import { KNOWN_LOCALES, localeName } from "@/core/i18n/locales";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { HeaderLayoutPicker } from "@/components/admin/HeaderLayoutPicker";
import { ImageField } from "@/components/admin/ImageField";
import { ShowWhen } from "@/components/admin/ShowWhen";
import { Tabs } from "@/components/admin/Tabs";
import { ThemePicker } from "@/components/admin/ThemePicker";
import { ui } from "@/components/admin/ui";
import { hasRole } from "@/core/permissions";
import { getMailConfig } from "@/core/services/mail";
import { saveSettings } from "./actions";

/** Exemple affiché tant qu'aucune description personnalisée n'est enregistrée : le format est décrit dans docs/BACKGROUND.md. */
const BG_EXAMPLE = JSON.stringify([
  { type: "radial", x: 50, y: 0, w: 80, h: 50, stops: [{ color: "accent", a: 22 }, { color: "accent", at: 100, a: 0 }] },
  { type: "grid", color: "fg", gap: 48, opacity: 6, side: "top", span: 80 },
], null, 2);
import { saveMail, sendTestMail } from "./mail-actions";

const TRANSLATABLE = ["site.name", "site.tagline", "site.about", "footer.text", "header.secondaryLabel", "header.buttonLabel", "privacy.extra"] as const;

/** Une couche de l'arrière-plan : numéro (du bas vers le haut), titre, ce qu'elle fait, puis ses réglages. */
function LayerRow({ n, title, note, children }: { n: number; title: string; note: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-muted">{n}</span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="font-medium">{title}</p>
          <p className={ui.help}>{note}</p>
        </div>
        {children}
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const { t, config, advanced, user } = await adminCtx("admin");
  const socialCount = (await providersOf(SOCIAL_TOPIC)).length;
  const mail = await getMailConfig();
  const values: Record<string, Record<string, unknown>> = {};
  for (const key of TRANSLATABLE) values[key] = await getSettingByLocale(key);
  const logo = await getSetting<string>("site.logo");
  const blockAiBots = (await getSetting<boolean>("seo.blockAiBots")) !== false;

  return (
    <div className="space-y-6">
      <header><h1 className={ui.pageTitle}>{advanced ? t("nav.settings") : t("nav.settings.simple")}</h1>{!advanced && <p className={ui.pageIntro}>{t("settings.intro.simple")}</p>}</header>
      <Tabs tabs={[{ id: "site", label: t("settings.identity") }, { id: "languages", label: t("settings.languages") }, { id: "appearance", label: t("settings.appearance") }, { id: "privacy", label: t("settings.privacy") }, ...(hasRole(user, "owner") ? [{ id: "mail", label: t("settings.mail") }] : [])]}>
      <div data-tab="site languages appearance privacy">
      <ActionForm action={saveSettings} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-8" submitTabs="site languages appearance privacy">
        {advanced && <input type="hidden" name="__adv" value="1" />}
        <section data-tab="site" className="space-y-5">
          <p className={ui.help}>{t("settings.identityIntro")}</p>
          <div className={`${ui.card} space-y-5`}>
            <h3 className="font-semibold">{t("settings.who")}</h3>
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
            {advanced && <Checkbox name="blockAiBots" label={t("settings.blockAiBots")} help={t("settings.blockAiBotsHelp")} defaultChecked={blockAiBots} />}
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
          <h2 className="text-lg font-semibold">{t("settings.appearance")}</h2>
          <div className={`${ui.card} space-y-4`}>
            <h3 className="font-semibold">{t("settings.header")}</h3>
            <p className={ui.help}>{t("settings.headerHelp")}</p>
            <HeaderLayoutPicker name="headerLayout" value={config.header.layout}
              labels={{ classic: { title: t("settings.header.classic"), help: t("settings.header.classicHelp") }, twoRows: { title: t("settings.header.twoRows"), help: t("settings.header.twoRowsHelp") },
                centered: { title: t("settings.header.centered"), help: t("settings.header.centeredHelp") }, minimal: { title: t("settings.header.minimal"), help: t("settings.header.minimalHelp") } }} />
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
          <div className={`${ui.card} space-y-4`}>
          <h3 className="font-semibold">{t("settings.colors")}</h3>
          <ThemePicker background={config.background} accent={config.accent} advanced={advanced}
            labels={{ background: t("settings.background"), accent: t("settings.accent") }}
            names={{ night: t("theme.night"), ocean: t("theme.ocean"), forest: t("theme.forest"), rose: t("theme.rose"), violet: t("theme.violet"), daylight: t("theme.daylight"), paper: t("theme.paper"), custom: t("theme.custom") }} />
          {advanced && (
            <Select name="font" label={t("settings.font")} defaultValue={config.font}
              options={[{ value: "sans", label: "Sans-serif" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Monospace" }]} />
          )}
          </div>
          <div className={`${ui.card} space-y-5`} data-testid="bg-layers">
            <div>
              <h3 className="font-semibold">{t("settings.layers")}</h3>
              <p className={ui.help}>{t("settings.layersHelp")}</p>
            </div>
            <ol className="space-y-5">
              <LayerRow n={1} title={t("settings.layer.color")} note={t("settings.layer.colorNote")}>
                <span className="inline-flex items-center gap-2 text-sm"><span aria-hidden="true" className="h-5 w-5 rounded-md border border-line" style={{ background: config.background }} />{config.background}</span>
              </LayerRow>
              <LayerRow n={2} title={t("settings.layer.glow")} note={t("settings.layer.glowNote")}>
          <Select name="glow" label={t("settings.glow")} defaultValue={config.glow.level}
            options={[
              { value: "none", label: t("settings.glow.none") }, { value: "soft", label: t("settings.glow.soft") }, { value: "strong", label: t("settings.glow.strong") },
              ...(advanced ? [{ value: "custom", label: t("settings.glow.custom") }] : []),
            ]} />
          {advanced && (
            <ShowWhen field="glow" equals="custom" initial={config.glow.level}>
            <fieldset className="space-y-3 rounded-2xl border border-line p-4">
              <legend className="px-2 text-sm font-medium">{t("settings.glow.tuning")}</legend>
              <p className={ui.help}>{t("settings.glow.tuningHelp")}</p>
              <div className="space-y-2">
                <Checkbox name="glow_followAccent" label={t("settings.glow.followAccent")} defaultChecked={!config.glow.custom.color} />
                <TextField name="glow_color" type="color" label={t("settings.glow.color")} help={t("settings.glow.colorHelp")} defaultValue={config.glow.custom.color || config.accent} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="glow_count" type="number" label={t("settings.glow.count")} help={t("settings.glow.countHelp")} defaultValue={String(config.glow.custom.count)} />
                <TextField name="glow_size" type="number" label={t("settings.glow.size")} help={t("settings.glow.sizeHelp")} defaultValue={String(config.glow.custom.size)} />
                <TextField name="glow_variance" type="number" label={t("settings.glow.variance")} help={t("settings.glow.varianceHelp")} defaultValue={String(config.glow.custom.variance)} />
                <TextField name="glow_hue" type="number" label={t("settings.glow.hue")} help={t("settings.glow.hueHelp")} defaultValue={String(config.glow.custom.hue)} />
                <TextField name="glow_intensity" type="number" label={t("settings.glow.intensity")} help={t("settings.glow.intensityHelp")} defaultValue={String(config.glow.custom.intensity)} />
                <TextField name="glow_seed" type="number" label={t("settings.glow.seed")} help={t("settings.glow.seedHelp")} defaultValue={String(config.glow.custom.seed)} />
              </div>
            </fieldset>
            </ShowWhen>
          )}
              </LayerRow>
              <LayerRow n={3} title={t("settings.layer.image")} note={t("settings.layer.imageNote")}>
          <ImageField name="bgImage" label={t("settings.bgImage")} defaultValue={config.bg.image} uploadLabel={t("action.upload")} />
              </LayerRow>
              <LayerRow n={4} title={t("settings.layer.pattern")} note={t("settings.layer.patternNote")}>
          <Select name="bgPreset" label={t("settings.bg")} defaultValue={config.bg.preset}
            options={[
              { value: "none", label: t("settings.bg.none") }, { value: "dusk", label: t("settings.bg.dusk") }, { value: "grid", label: t("settings.bg.grid") },
              ...(advanced ? [{ value: "svg", label: t("settings.bg.svg") }, { value: "custom", label: t("settings.bg.custom") }] : []),
            ]} />
          {advanced && (
            <ShowWhen field="bgPreset" equals="svg" initial={config.bg.preset}>
              <div className="space-y-3">
                <TextArea name="bgSvg" label={t("settings.bgSvg")} help={t("settings.bgSvgHelp")} rows={12} mono defaultValue={config.bg.svg.markup} />
                <Select name="bgSvgFit" label={t("settings.bgSvgFit")} defaultValue={config.bg.svg.fit}
                  options={[{ value: "cover", label: t("settings.bgSvgFit.cover") }, { value: "contain", label: t("settings.bgSvgFit.contain") }, { value: "tile", label: t("settings.bgSvgFit.tile") }]} />
                <Select name="bgSvgAlign" label={t("settings.bgSvgAlign")} help={t("settings.bgSvgAlignHelp")} defaultValue={config.bg.svg.align}
                  options={[{ value: "center", label: t("settings.bgSvgAlign.center") }, { value: "left", label: t("settings.bgSvgAlign.left") }, { value: "right", label: t("settings.bgSvgAlign.right") }]} />
                <ShowWhen field="bgSvgFit" equals="tile" initial={config.bg.svg.fit}>
                  <TextField name="bgSvgTile" type="number" label={t("settings.bgSvgTile")} help={t("settings.bgSvgTileHelp")} defaultValue={String(config.bg.svg.tile)} />
                </ShowWhen>
              </div>
            </ShowWhen>
          )}
          {advanced && (
            <ShowWhen field="bgPreset" equals="custom" initial={config.bg.preset}>
            <TextArea name="bgCustom" label={t("settings.bgCustom")} help={t("settings.bgCustomHelp")} rows={10} mono defaultValue={config.bg.custom || BG_EXAMPLE} />
            </ShowWhen>
          )}
              </LayerRow>
            </ol>
          </div>
          {advanced && <p className={ui.help}>{t("settings.appearanceHelp")}</p>}
        </section>
      </ActionForm>
      </div>

      {hasRole(user, "owner") && (
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
            <ActionForm action={sendTestMail} submitLabel={t("settings.mailTest")} className="space-y-3">{null}</ActionForm>
          )}
        </section>
      )}
      </Tabs>
    </div>
  );
}
