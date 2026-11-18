import { Blocks } from "@/components/site/Blocks";
import * as adminKit from "@/components/site/adminKit";
import type { Translator } from "@/core/i18n/dictionary";
import type { AdminUser } from "@/core/auth/access";
import { hasRole } from "@/core/auth/access";
import { buildTheme } from "@/core/color";
import { instanceHref } from "@/core/adminLinks";
import { instanceSettingKey } from "@/core/modules/context";
import { choiceAdminView, isChoiceField, viewCountsAsFilled, type ChoiceView } from "@/core/modules/choice";
import { FILLED_MARK } from "@/core/modules/choiceValues";
import { missingSettings } from "@/core/modules/missingSettings";
import { loadSectionBlocks } from "@/core/modules/placesLoad";
import type { IndexedSection } from "@/core/modules/places";
import type { ActiveInstance } from "@/core/modules/registry";
import { getSettingByLocale, getSiteConfig, themeExtraOf } from "@/core/settings";
import type { SettingField } from "@/core/modules/types";
import { savePlaceSection } from "@/app/admin/(panel)/instances/actions";
import { fieldNamespace } from "@/core/modules/placeScope";
import { ActionForm } from "./ActionForm";
import { PlaceReturnProvider } from "./PlaceReturn";
import { floatingLabels } from "./floating";
import { HelpTip } from "./HelpTip";
import { ModuleSettings } from "./ModuleSettings";
import { ui } from "./ui";

export type SiteConfigLite = { defaultLocale: string; locales: string[] };

/** What a section shows once loaded: null = nothing to show for this person (no setting and no block). */
export type LoadedSection = { section: IndexedSection; active: ActiveInstance; state: "ok" | "failed" | "timeout"; blocks: Awaited<ReturnType<typeof loadSectionBlocks>>["blocks"]; fields: SettingField[] };

/** Loads one section (blocks within the time budget, the setting fields this person may change). Never throws. */
export async function loadPlaceSection(section: IndexedSection, active: ActiveInstance, user: AdminUser, opts: { locale: string; advanced: boolean; query: Record<string, string> }): Promise<LoadedSection | null> {
  const got = await loadSectionBlocks(active, section.section, user, opts);
  const keys = new Set(section.section.settings);
  // Simple mode: the technical settings stay hidden, as on the module page (they change only in advanced mode).
  const fields = hasRole(user, "admin") ? active.mod.manifest.settings.filter((f) => keys.has(f.key) && (opts.advanced || !f.advanced)) : [];
  if (got.state === "ok" && got.blocks.length === 0 && fields.length === 0) return null;
  return { section, active, state: got.state, blocks: got.blocks, fields };
}

/**
 * One section of a place page: a card with its title, its origin when it helps (R14), then the module's blocks and the declared settings rendered by the core.
 * Two disclosure levels at most: the basic settings, then ONE "Advanced settings" fold (rare + advanced). Each section saves on its own (its own form, its own
 * transaction); the page has one floating "Save" bar that saves every modified section (ActionForm).
 */
export async function PlaceSectionCard({ loaded, t, locale, config, advanced, showOrigin, base }: {
  loaded: LoadedSection; t: Translator; locale: string; config: SiteConfigLite; advanced: boolean; showOrigin: boolean;
  /** (0.33.0) Address of the page that shows the section (`/admin/live/alerts`, or the core page that hosts it): the module's actions come back to it. */
  base: string;
}) {
  const { section, active } = loaded;
  const anchor = section.anchor;
  const titleId = `${anchor}-title`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const origin = section.siblings ? `${section.moduleName} · ${section.instanceLabel}` : section.moduleName;
  const originTip = [t("places.origin.tip", { module: section.moduleName, version: active.mod.manifest.version }), advanced ? `${t("instances.technicalId")} ${section.instanceKey}` : ""].filter(Boolean).join(" · ");
  // An advanced section is folded in simple mode, unless it could not show: the "unavailable" line must be seen.
  const folded = section.section.level === "advanced" && !advanced && loaded.state === "ok";
  const summary = section.section.summary ? (/^fr/i.test(locale) ? section.section.summary.fr : section.section.summary.en) : null;
  return (
    <section id={anchor} aria-labelledby={titleId} className="scroll-mt-20" data-testid="place-section" data-section={anchor}>
      <details open={!folded} className={`${ui.card} group`}>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block text-sm text-muted transition-transform group-open:rotate-90">▶</span>
          <h2 id={titleId} className="text-lg font-semibold">{section.title}</h2>
          {summary && <span className="text-sm text-muted group-open:hidden">{summary}</span>}
        </summary>
        {(showOrigin || section.section.level === "advanced") && (
          <p className="mt-1 flex items-center gap-1 text-[13px] text-muted" data-testid="place-origin">
            {/* R14: when the card is already titled with the module's name, the origin is not repeated; the tooltip and the link stay. */}
            {showOrigin && section.title !== origin && <span>{t("places.origin", { origin })}</span>}
            {showOrigin && <HelpTip always help={originTip} name={origin} />}
            {showOrigin && <a href={instanceHref(section.instanceId)} className="ml-2 underline hover:text-accent">{t("places.openModule")} →</a>}
          </p>
        )}
        <div className="mt-4 space-y-6 [&_[data-section]>div]:rounded-none [&_[data-section]>div]:border-0 [&_[data-section]>div]:bg-transparent [&_[data-section]>div]:p-0 [&_[data-section]>div]:shadow-none">
          {loaded.state !== "ok" && (
            <p role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="place-section-unavailable">
              {t("places.unavailable", { module: section.moduleName })} <a href={instanceHref(section.instanceId)} className="font-medium underline">{t("places.openModule")} →</a>
            </p>
          )}
          {loaded.blocks.length > 0 && <PlaceReturnProvider value={base}><Blocks blocks={loaded.blocks} locale={locale} kit={adminKit} adminInstanceId={section.instanceId} /></PlaceReturnProvider>}
          {loaded.fields.length > 0 && <SectionSettings loaded={loaded} t={t} locale={locale} config={config} advanced={advanced} />}
        </div>
      </details>
    </section>
  );
}

/** The declared settings of the section: the basic ones, then one "Advanced settings" fold. Rendered by the core settings form (ModuleSettings). */
async function SectionSettings({ loaded, t, locale, config, advanced }: { loaded: LoadedSection; t: Translator; locale: string; config: SiteConfigLite; advanced: boolean }) {
  const { active, section } = loaded;
  const { mod, instance } = active;
  const manifest = mod.manifest;
  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of manifest.settings) stored[f.key] = await getSettingByLocale(instanceSettingKey(instance.id, f.key));
  const choices: Record<string, ChoiceView> = {};
  for (const f of loaded.fields) if (isChoiceField(f)) choices[f.key] = await choiceAdminView({ mod, instance }, f, { locale, actor: "" });
  const fillable: Record<string, Record<string, unknown>> = { ...stored };
  for (const [key, view] of Object.entries(choices)) fillable[key] = viewCountsAsFilled(view) ? { "": FILLED_MARK } : {};
  const grouped = new Set((manifest.optionalGroups ?? []).flatMap((g) => g.fields));
  const missing = new Set(missingSettings(manifest.settings, grouped, fillable).map((f) => f.key));
  const site = await getSiteConfig();
  const theme = buildTheme(site.background, site.accent, site.font, themeExtraOf(site));
  const siteByLocale = Object.fromEntries(await Promise.all(config.locales.map(async (l) => { const c = await getSiteConfig(l); return [l, { name: c.name, tagline: c.tagline }] as const; })));
  // One fold only: what the manifest calls rare or advanced. Inside, the flags are dropped so that ModuleSettings does not fold them a second time.
  const isFolded = (f: SettingField) => f.rare === true || f.advanced === true;
  const flat = (f: SettingField): SettingField => ({ ...f, rare: undefined, advanced: undefined, group: undefined });
  const basic = loaded.fields.filter((f) => !isFolded(f)).map(flat);
  const more = loaded.fields.filter(isFolded).map(flat);
  const common = { t, locale, defaultLocale: config.defaultLocale, locales: config.locales, allFields: manifest.settings, groups: manifest.optionalGroups ?? [], stored, siteByLocale, theme, missing, instanceId: instance.id, choices, advanced, tabbed: true, ns: fieldNamespace(instance.key, section.section.id) } as const;
  const anyMoreSet = more.some((f) => Object.values(stored[f.key] ?? {}).some((v) => v !== undefined && v !== ""));
  return (
    <ActionForm action={savePlaceSection} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-6 [&>div[aria-hidden]]:hidden">
      <input type="hidden" name="id" value={instance.id} />
      <input type="hidden" name="__section" value={section.section.id} />
      {advanced && <input type="hidden" name="__adv" value="1" />}
      {basic.length > 0 && <ModuleSettings {...common} fields={basic} />}
      {more.length > 0 && (
        <details open={advanced || anyMoreSet || basic.length === 0} className="group/adv rounded-xl border border-line p-4" data-testid="place-advanced">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block text-sm text-muted transition-transform group-open/adv:rotate-90">▶</span>{t("places.advanced")}
          </summary>
          <div className="mt-4"><ModuleSettings {...common} fields={more} /></div>
        </details>
      )}
    </ActionForm>
  );
}
