import { Suspense } from "react";
import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { floatingLabels } from "@/components/admin/floating";
import { ActionForm } from "@/components/admin/ActionForm";
import { Select, TextArea, TextField, Checkbox } from "@/components/admin/Field";
import { HeaderLayoutPicker } from "@/components/admin/HeaderLayoutPicker";
import { ImageField } from "@/components/admin/ImageField";
import { ShowWhen } from "@/components/admin/ShowWhen";
import { ui } from "@/components/admin/ui";
import { CUSTOM_PALETTE, THEME_PRESETS } from "@/core/palettes";
import { can } from "@/core/permissions";
import { loadAppearanceView } from "@/core/skins/appearanceView";
import { listCatalogue } from "@/core/skins/service";
import { AppearanceLabelsProvider } from "./AppearanceLabels";
import { CatalogueCard, type CatalogueCardModel } from "./CatalogueCard";
import { ColorSection } from "./ColorSection";
import { ManageSkin, type ManagedSkin } from "./ManageSkin";
import { PersonalRepo } from "./PersonalRepo";
import { SkinCards, SwatchTile } from "./SkinCards";
import { PreviewButton, type PreviewPage } from "./PreviewDialog";
import { appearanceLabels } from "./labels";
import { resetSkinAction, saveAppearance, saveOptionsAction, undoSkinAction } from "./actions";

/** Exemple affiché tant qu'aucune description personnalisée n'est enregistrée : le format est décrit dans docs/BACKGROUND.md. */
const BG_EXAMPLE = JSON.stringify([
  { type: "radial", x: 50, y: 0, w: 80, h: 50, stops: [{ color: "accent", a: 22 }, { color: "accent", at: 100, a: 0 }] },
  { type: "grid", color: "fg", gap: 48, opacity: 6, side: "top", span: 80 },
], null, 2);

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

/** Le catalogue officiel des skins : lu à part (flux) pour que la page s'affiche tout de suite même si le dépôt est lent. */
async function Catalogue({ locale, canInstall }: { locale: "fr" | "en"; canInstall: boolean }) {
  const { t } = await adminCtx("admin");
  const list = await listCatalogue();
  const items: CatalogueCardModel[] = list.items.slice(0, 60).map((i) => ({
    id: i.id, name: i.name[locale], description: i.description[locale], author: i.author, modes: i.modes, version: i.version, installed: i.installed, installedVersion: i.installedVersion,
    updateAvailable: i.updateAvailable, compatible: i.compatible, needsNewerCore: i.needsNewerCore, origin: i.origin,
  }));
  return (
    <div className="space-y-3" data-testid="catalogue">
      {list.unreachable && <p role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{list.message?.[locale] ?? t("skins.error.catalogue")}</p>}
      {!list.unreachable && items.length === 0 && <p className={ui.help}>{t("appearance.catalogue.empty")}</p>}
      {!canInstall && items.length > 0 && <p className={ui.help}>{t("appearance.ownerOnly")}</p>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((i) => <CatalogueCard key={i.id} item={i} locale={locale} canInstall={canInstall} />)}
      </ul>
    </div>
  );
}

const FLASH = { updated: "appearance.updatedOk", reverted: "appearance.revertedOk", removed: "appearance.removedOk", removedActive: "appearance.removedActive" } as const;

export default async function AppearancePage({ searchParams }: { searchParams?: Promise<{ done?: string; v?: string }> }) {
  const sp = (await searchParams) ?? {};
  const flashKey = Object.hasOwn(FLASH, String(sp.done)) ? FLASH[sp.done as keyof typeof FLASH] : null;
  const flashVersion = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(sp.v)) ? String(sp.v) : "";
  const { t, config, advanced, user, locale: rawLocale } = await adminCtx("admin");
  const locale: "fr" | "en" = rawLocale === "fr" ? "fr" : "en";
  // « isOwner » : peut installer des extensions (droit `core:modules.install` : propriétaire, coordinateur technique).
  const isOwner = can(user, "core:modules.install");
  const view = await loadAppearanceView();
  const legacy = view.activeId === "basic";
  const labels = appearanceLabels(t);

  // Pages que l'aperçu peut montrer : l'accueil, puis les premières pages du menu (adresses du site seulement).
  const pages: PreviewPage[] = [{ label: t("appearance.preview.home"), path: "/" }];
  for (const n of config.nav) if (n.href.startsWith("/") && !n.href.startsWith("//") && pages.length < 6) pages.push({ label: n.label[locale] ?? n.label[config.defaultLocale] ?? n.href, path: n.href });

  const headerLayout = (view.raw.headerLayout ?? (legacy ? config.header.layout : view.skinDefaults.headerLayout)) as typeof config.header.layout;
  const glowLevel = legacy ? config.glow.level : (view.raw.glow ?? "skin");
  const bgPreset = legacy ? config.bg.preset : (view.raw.bgPreset ?? "skin");
  const font = legacy ? config.font : (view.raw.font ?? "");
  const baseValues = (m: "light" | "dark" | undefined) => view.skinColors[m ?? "dark"];
  const pickerLabels = {
    background: t("settings.background"), accent: t("settings.accent"), accent2: t("settings.accent2"), surface: t("settings.surface"), text: t("settings.text"),
    addSecond: t("settings.accent2.add"), removeSecond: t("settings.accent2.remove"), optionalHint: t("settings.colorOptionalHint"), invalid: t("settings.colorInvalid"),
    warnText: t("settings.contrast.text"), warnAccent: t("settings.contrast.accent"), warnAccent2: t("settings.contrast.accent2"),
    resetField: t("appearance.resetField"), details: t("appearance.details.short"),
  };
  const names = Object.fromEntries([...THEME_PRESETS.map((p) => p.id), CUSTOM_PALETTE].map((id) => [id, t(`theme.${id}`)]));
  // Les champs « un seul mode » montrent la sauvegarde du site (comme avant les skins) sur basic, les valeurs effectives sinon.
  const single = legacy ? { background: config.background, accent: config.accent, accent2: config.accent2, surface: config.surface, text: config.textColor } : view.single;
  const formKey = JSON.stringify([view.activeId, view.retouches, view.palette, view.raw]);

  const managed: ManagedSkin[] = view.cards.filter((c) => c.source !== "basic").map((c) => ({ id: c.id, name: c.name[locale], version: c.version, source: c.source as "catalogue" | "personal", active: c.active, previousVersion: c.previousVersion, updateKnown: false, status: c.status }));

  return (
    <AppearanceLabelsProvider labels={labels}>
      <div className="space-y-8">
        <header>
          <h1 className={ui.pageTitle}>{t("nav.appearance")}</h1>
          <p className={ui.pageIntro}>{t("appearance.intro")}</p>
        </header>

        {flashKey && <p role="status" data-testid="flash" className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-sm text-emerald-700">{t(flashKey, { version: flashVersion })}</p>}
        {view.activeProblem && <p role="alert" data-testid="active-problem" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">{t("appearance.activeProblem")}</p>}
        {view.notices.length > 0 && (
          <div role="status" data-testid="adjusted-notice" className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium">{t("appearance.adjusted")}</p>
            <ul className="list-disc pl-5">{view.notices.map((n, i) => <li key={i}>{n[locale]}</li>)}</ul>
            {view.retouched && <p>{t("appearance.adjusted.hint")}</p>}
          </div>
        )}
        {view.snapshot && (
          <div role="status" data-testid="undo-banner" className="space-y-2 rounded-xl border border-line bg-surface p-4 text-sm">
            <p>{view.snapshot.kind === "choose" ? t("appearance.undo.choose", { name: view.snapshot.fromName?.[locale] ?? t("appearance.undo.unknown") }) : t("appearance.undo.reset")}</p>
            <ActionForm action={undoSkinAction} submitLabel={t("appearance.undo.button")} secondary pendingLabel={t("appearance.undo.doing")} className="space-y-1"><input type="hidden" name="what" value="undo" /></ActionForm>
          </div>
        )}

        <section aria-labelledby="current-title" className={`${ui.card} space-y-4`} data-testid="current-skin">
          <h2 id="current-title" className="text-lg font-semibold">{t("appearance.current.title")}</h2>
          <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
            {view.active.previews[0]
              // eslint-disable-next-line @next/next/no-img-element -- aperçu servi par l'administration (route réservée)
              ? <img src={`/api/admin/skins/preview/${view.active.id}/${view.active.version}/${view.active.previews[0].file.replace(/^previews\//, "")}`} alt={view.active.previews[0].alt[locale]} className="h-28 w-full rounded-xl border border-line object-cover object-top" />
              : <SwatchTile swatches={view.active.swatches} />}
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">{view.active.name[locale]}</h3>
              <p className="text-sm text-muted">{view.active.description[locale]}</p>
              <p className="text-[13px] text-muted">
                {view.active.source === "basic" ? t("appearance.byCuriosa") : view.active.author ? t("appearance.by", { author: view.active.author }) : ""}
                {view.active.license ? ` · ${t("appearance.license", { license: view.active.license })}` : ""}
                {` · ${view.active.modes.length === 2 ? t("appearance.modes.both") : t(`appearance.modes.${view.active.modes[0] ?? "dark"}Only`)}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href="#choose-skin" className={`${ui.btnPrimary} min-h-11`}>{t("appearance.change")}</a>
                <PreviewButton skinId={view.active.id} skinName={view.active.name[locale]} bothModes={view.active.modes.length === 2} pages={pages} canChoose={false} active />
              </div>
            </div>
          </div>
        </section>

        <section id="choose-skin" aria-labelledby="choose-title" className="space-y-3 scroll-mt-4">
          <h2 id="choose-title" className="text-lg font-semibold">{t("appearance.choose.title")}</h2>
          <p className={ui.help}>{t("appearance.choose.help")}</p>
          <SkinCards cards={view.cards} locale={locale} pages={pages} canChoose />
        </section>

        <section aria-labelledby="add-title" className="space-y-3">
          <h2 id="add-title" className="text-lg font-semibold">{t("appearance.add.title")}</h2>
          <p className={ui.help}>{t("appearance.add.help")}</p>
          <Suspense fallback={<p role="status" className={ui.help}>{t("appearance.catalogue.loading")}</p>}>
            <Catalogue locale={locale} canInstall={isOwner} />
          </Suspense>
          {isOwner && <PersonalRepo locale={locale} />}
        </section>

        <section aria-labelledby="touch-title" className="space-y-4" data-testid="retouches">
          <div>
            <h2 id="touch-title" className="text-lg font-semibold">{t("appearance.touch.title")}</h2>
            <p className={ui.help}>{legacy ? t("appearance.touch.helpBasic") : t("appearance.touch.help", { name: view.active.name[locale] })}</p>
          </div>
          <ActionForm key={formKey} action={saveAppearance} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-6">
            {advanced && <input type="hidden" name="__adv" value="1" />}
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("settings.header")}</h3>
              <p className={ui.help}>{t("settings.headerHelp")}</p>
              <HeaderLayoutPicker name="headerLayout" value={headerLayout}
                labels={{ classic: { title: t("settings.header.classic"), help: t("settings.header.classicHelp") }, twoRows: { title: t("settings.header.twoRows"), help: t("settings.header.twoRowsHelp") },
                  centered: { title: t("settings.header.centered"), help: t("settings.header.centeredHelp") }, minimal: { title: t("settings.header.minimal"), help: t("settings.header.minimalHelp") } }} />
              <p className={ui.help}>{t("appearance.header.links", { page: advanced ? t("nav.settings") : t("nav.settings.simple") })}</p>
            </div>
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("settings.colors")}</h3>
              <ColorSection locale={locale} modes={view.modes} palette={view.palette} legacy={legacy} advanced={advanced} single={single}
                both={{ light: view.both.light, dark: view.both.dark }} skinColors={{ light: baseValues("light"), dark: baseValues("dark") }}
                skinBackgrounds={{ light: view.skinColors.light?.background, dark: view.skinColors.dark?.background }} names={names} labels={pickerLabels} />
              {advanced && (
                <Select name="font" label={t("settings.font")} defaultValue={font}
                  options={[...(legacy ? [] : [{ value: "", label: t("appearance.fromSkin") }]), { value: "sans", label: "Sans-serif" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Monospace" }]} />
              )}
            </div>
            <div className={`${ui.card} space-y-5`} data-testid="bg-layers">
              <div>
                <h3 className="font-semibold">{t("settings.layers")}</h3>
                <p className={ui.help}>{t("settings.layersHelp")}</p>
              </div>
              <ol className="space-y-5">
                <LayerRow n={1} title={t("settings.layer.color")} note={t("settings.layer.colorNote")}>
                  <span className="inline-flex items-center gap-2 text-sm"><span aria-hidden="true" className="h-5 w-5 rounded-md border border-line" style={{ background: single.background }} />{single.background}</span>
                </LayerRow>
                <LayerRow n={2} title={t("settings.layer.glow")} note={t("settings.layer.glowNote")}>
                  <Select name="glow" label={t("settings.glow")} defaultValue={glowLevel}
                    options={[
                      ...(legacy ? [] : [{ value: "skin", label: t("appearance.fromSkin") }]),
                      { value: "none", label: t("settings.glow.none") }, { value: "soft", label: t("settings.glow.soft") }, { value: "strong", label: t("settings.glow.strong") },
                      ...(advanced ? [{ value: "custom", label: t("settings.glow.custom") }] : []),
                    ]} />
                  {advanced && (
                    <ShowWhen field="glow" equals="custom" initial={glowLevel}>
                      <fieldset className="space-y-3 rounded-2xl border border-line p-4">
                        <legend className="px-2 text-sm font-medium">{t("settings.glow.tuning")}</legend>
                        <p className={ui.help}>{t("settings.glow.tuningHelp")}</p>
                        <div className="space-y-2">
                          <Checkbox name="glow_followAccent" label={t("settings.glow.followAccent")} defaultChecked={!config.glow.custom.color} />
                          <TextField name="glow_color" type="color" label={t("settings.glow.color")} help={t("settings.glow.colorHelp")} defaultValue={config.glow.custom.color || single.accent} />
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
                  <Select name="bgPreset" label={t("settings.bg")} defaultValue={bgPreset}
                    options={[
                      ...(legacy ? [] : [{ value: "skin", label: t("appearance.fromSkin") }]),
                      { value: "none", label: t("settings.bg.none") }, { value: "dusk", label: t("settings.bg.dusk") }, { value: "grid", label: t("settings.bg.grid") },
                      ...(advanced ? [{ value: "svg", label: t("settings.bg.svg") }, { value: "custom", label: t("settings.bg.custom") }] : []),
                    ]} />
                  {advanced && (
                    <ShowWhen field="bgPreset" equals="svg" initial={bgPreset}>
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
                    <ShowWhen field="bgPreset" equals="custom" initial={bgPreset}>
                      <TextArea name="bgCustom" label={t("settings.bgCustom")} help={t("settings.bgCustomHelp")} rows={10} mono defaultValue={config.bg.custom || BG_EXAMPLE} />
                    </ShowWhen>
                  )}
                </LayerRow>
              </ol>
            </div>
            {advanced && <p className={ui.help}>{t("settings.appearanceHelp")}</p>}
          </ActionForm>

          {!legacy && (
            <div className={`${ui.card} space-y-3`} data-testid="reset-card">
              <h3 className="font-semibold">{t("appearance.reset.title")}</h3>
              <p className={ui.help}>{view.retouched ? t("appearance.reset.help", { name: view.active.name[locale] }) : t("appearance.reset.none", { name: view.active.name[locale] })}</p>
              {view.retouched && <ActionForm action={resetSkinAction} submitLabel={t("appearance.reset.button")} secondary pendingLabel={t("appearance.reset.doing")} confirm={t("appearance.reset.confirm", { name: view.active.name[locale] })} className="space-y-1"><input type="hidden" name="what" value="reset" /></ActionForm>}
            </div>
          )}
        </section>

        {view.options.length > 0 && (
          <section aria-labelledby="opt-title" className={`${ui.card} space-y-4`} data-testid="skin-options">
            <h2 id="opt-title" className="text-lg font-semibold">{t("appearance.options.title", { name: view.active.name[locale] })}</h2>
            <ActionForm action={saveOptionsAction} submitLabel={t("action.save")} className="space-y-4">
              {view.options.map((o) => (
                <Select key={o.id} name={`option_${o.id}`} label={o.label[locale]} defaultValue={o.chosen} options={o.values.map((v) => ({ value: v.id, label: v.label[locale] }))} />
              ))}
            </ActionForm>
          </section>
        )}

        <section aria-labelledby="visitors-title" className={`${ui.card} space-y-2`} data-testid="visitor-switch">
          <h2 id="visitors-title" className="text-lg font-semibold">{t("appearance.visitors.title")}</h2>
          <p className="text-sm" data-switch={view.switchAvailable ? "on" : "off"}>{view.switchAvailable ? t("appearance.visitors.on") : view.modes.length === 2 ? t("appearance.visitors.offOneMode") : t("appearance.visitors.offSkin")}</p>
          <p className={ui.help}>{t("appearance.visitors.help")}</p>
          {view.switchAvailable && (
            <div aria-hidden="true" className="inline-flex overflow-hidden rounded-xl border border-line text-xs">
              {(["auto", "light", "dark"] as const).map((m) => <span key={m} className={`px-3 py-2 ${m === "auto" ? "bg-accent text-accent-fg" : "bg-surface"}`}>{t(`appearance.mode.${m}`)}</span>)}
            </div>
          )}
        </section>

        {isOwner && managed.length > 0 && (
          <section aria-labelledby="manage-title" className="space-y-3" data-testid="manage-skins">
            <h2 id="manage-title" className="text-lg font-semibold">{t("appearance.manage.title")}</h2>
            <p className={ui.help}>{t("appearance.manage.help")}</p>
            <div className="space-y-2">{managed.map((m) => <ManageSkin key={m.id} skin={m} />)}</div>
          </section>
        )}

        {view.credits.length > 0 && (
          <section aria-labelledby="credits-title" className="space-y-2">
            <details className="rounded-2xl border border-line bg-surface">
              <summary id="credits-title" className="min-h-11 cursor-pointer px-5 py-3 text-[15px] font-medium">{t("appearance.credits.title")}</summary>
              <ul className="space-y-1 px-5 pb-4 text-sm">
                {view.credits.map((c) => <li key={c.file}><span className="font-mono text-[13px]">{c.file}</span> · {c.license ?? "?"}{c.author ? ` · ${c.author}` : ""}{c.source ? <> · <span className="break-all text-muted">{c.source}</span></> : null}</li>)}
              </ul>
            </details>
          </section>
        )}

        <p className={ui.help}><Link href="/admin/settings" className="text-accent hover:underline">{t("appearance.toSettings")}</Link></p>
      </div>
    </AppearanceLabelsProvider>
  );
}
