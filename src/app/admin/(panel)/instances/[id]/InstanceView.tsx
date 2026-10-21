import { floatingLabels } from "@/components/admin/floating";
import { notFound, redirect } from "next/navigation";
import { can, deniedPath, hasRole, isOwner } from "@/core/auth/access";
import { auditDenied } from "@/core/permissions";
import { adminCtx } from "@/core/admin";
import { DISPLAYS, FEATURES, getInstanceById } from "@/core/instances";
import { localeName } from "@/core/i18n/locales";
import { buildContext, forViewer, instanceSettingKey } from "@/core/modules/context";
import { hasPage } from "@/core/modules/manifest";
import { overlayUrl } from "@/core/modules/overlayUrl";
import { defaultPlacement, placementSettingKey, placementsFor, resolvePlacement } from "@/core/modules/menuPlacement";
import { missingLinks, missingSettings } from "@/core/modules/missingSettings";
import { MissingBox } from "@/components/admin/MissingBox";
import { getModule } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { buildTheme } from "@/core/color";
import { getSetting, getSettingByLocale, getSiteConfig, themeExtraOf } from "@/core/settings";
import { effectiveSort, SORTS, sortSettingKey } from "@/core/content/sort";
import { mcpInstanceKey } from "@/core/modules/mcpProvider";
import { getInstanceLabeler } from "@/core/modules/labels";
import { Blocks } from "@/components/site/Blocks";
import { siteUrl } from "@/core/config";
import { effectiveType } from "@/core/modules/manifest";
import { getSources, providersOf } from "@/core/services/topics";
import { InstanceTabs } from "@/components/admin/InstanceTabs";
import { ActionForm } from "@/components/admin/ActionForm";
import { KeptData } from "@/components/admin/KeptData";
import { listRetired } from "@/core/modules/retired";
import { RemoveSection } from "@/components/admin/RemoveSection";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ModuleSettings } from "@/components/admin/ModuleSettings";
import { ui } from "@/components/admin/ui";
import { dataStatusOf } from "@/core/modules/dataMigrations";
import { taskStateOf } from "@/core/services/scheduler";
import { uninstallModuleAction } from "../../modules/actions";
import { removalScope } from "@/core/modules/removal";
import { deleteInstanceAction, retryMigrationAction, saveInstance, saveInstanceSettings, saveSources } from "../actions";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { SuggestNotices } from "@/components/admin/SuggestInstall";
import { choiceAdminView, isChoiceField, viewCountsAsFilled, type ChoiceView } from "@/core/modules/choice";
import { FILLED_MARK } from "@/core/modules/choiceValues";
import { PendingButton } from "@/components/admin/PendingButton";
import { PageTabs, TabPanel } from "@/components/admin/PageTabs";
import { initialTab, panelTab, planTabs, settingArea, settingTab, visibleTabs } from "@/core/modules/tabs";

const PLACE_LABEL = { menu: "placement.pin", integrations: "placement.park", overlays: "placement.parkOverlays" } as const;

/**
 * Les réglages d'une instance : la page entière (/admin/instances/<id>) et la fenêtre par-dessus Extensions (route interceptée) montrent EXACTEMENT ce contenu,
 * rangé en onglets (0.2.2 : Utiliser · Réglages · [onglets du module] · Sources · Général ; voir core/modules/tabs.ts et components/admin/PageTabs.tsx).
 * `query` : les paramètres d'adresse (le panneau d'un module peut en lire ; `tab` choisit l'onglet). `inModal` : affichée dans la fenêtre par-dessus une liste.
 */
export async function InstanceView({ id, query: sp, inModal = false }: { id: string; query: Record<string, string | string[] | undefined>; inModal?: boolean }) {
  // Entrée : tout accès ; puis le droit d'ouvrir CE module (`<module>:open` : tout administrateur l'a, comme avant ; un éditeur non).
  const { t, locale, config, user, advanced } = await adminCtx("member");
  const instance = await getInstanceById(id);
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!instance || !mod) notFound();
  if (!can(user, `${mod.manifest.id}:open`)) {
    await auditDenied(user, `${mod.manifest.id}:open`);
    redirect(deniedPath(user));
  }
  // Réglages, retrait, données gardées : administrateurs (comme avant). Un rôle personnalisé qui ouvre le module ne voit que son panneau.
  const manage = hasRole(user, "admin");
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const content = mod.manifest.content;
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const showNickname = labeler.hasSiblings(instance.moduleId);
  const moduleName = L(mod.manifest.name);
  // Le propriétaire qui retire la SEULE instance de son module retire le module lui-même ; sinon, seulement cette instance (le module reste installé).
  const scope = removalScope({ isOwner: isOwner(user), otherInstances: labeler.siblingsOf(instance).length });

  let panel: Awaited<ReturnType<NonNullable<typeof mod.def.adminPanel>>> = []; // blocs d'un panneau : chacun peut viser un onglet (`tab`, 0.2.5)
  if (mod.def.adminPanel) {
    try {
      const query = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
      panel = await mod.def.adminPanel(forViewer(await buildContext(mod, instance, locale), user), { query });
    } catch (error) {
      console.error(`[modules] ${instance.key} adminPanel failed:`, error);
    }
  }

  // Réglages « choix parmi » : ce que chacun montre (la conversion d'une valeur texte `fromText` se fait ici, à l'ouverture, au nom de la personne).
  const choices: Record<string, ChoiceView> = {};
  if (manage) {
    for (const f of mod.manifest.settings) if (isChoiceField(f)) choices[f.key] = await choiceAdminView({ mod, instance }, f, { locale, actor: user.email });
  }
  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of mod.manifest.settings) stored[f.key] = await getSettingByLocale(instanceSettingKey(id, f.key));
  // Pour « à configurer » : un choix compte comme rempli s'il est choisi, unique, remplacé, ou non vérifiable alors qu'une valeur existe (voir viewCountsAsFilled).
  const fillable: Record<string, Record<string, unknown>> = { ...stored };
  for (const [key, view] of Object.entries(choices)) fillable[key] = viewCountsAsFilled(view) ? { "": FILLED_MARK } : {};

  const mcpOn = (await getSetting<boolean>(mcpInstanceKey(instance.id))) !== false;
  const sort = effectiveSort(await getSetting(sortSettingKey(instance.id)), instance.display);
  const dataStatus = await dataStatusOf(instance.id);
  const taskRows = await Promise.all(Object.entries(mod.def.tasks ?? {}).map(async ([name, task]) => ({ name, every: task.everyMinutes, state: await taskStateOf(instance.id, name) })));
  const visibleSettings = mod.manifest.settings.filter((f) => advanced || !f.advanced);
  const siteConfig = await getSiteConfig();
  const theme = buildTheme(siteConfig.background, siteConfig.accent, siteConfig.font, themeExtraOf(siteConfig));

  const siteByLocale = Object.fromEntries(await Promise.all(config.locales.map(async (l) => { const c = await getSiteConfig(l); return [l, { name: c.name, tagline: c.tagline }] as const; })));

  // Un réglage à remplir (clé, adresse, identifiant… encore vide, sans valeur par défaut) : son onglet s'ouvre d'office plutôt que de le cacher.
  const grouped = new Set((mod.manifest.optionalGroups ?? []).flatMap((g) => g.fields));
  const missingFields = missingSettings(mod.manifest.settings, grouped, fillable);
  const missingItems = missingLinks(missingFields, (key) => L(mod.manifest.settings.find((f) => f.key === key)?.label ?? key));
  const placement = resolvePlacement(mod.manifest, await getSetting(placementSettingKey(id)));
  const placementIsDefault = placement === defaultPlacement(mod.manifest);

  // ── Onglets (0.2.2) : Utiliser · Réglages · [onglets du module] · Sources · Général ; un onglet sans contenu n'est pas affiché (voir core/modules/tabs.ts). ──
  const plan = planTabs(mod.manifest.tabs);
  // Les réglages réellement montrés (un « choix parmi » à une seule option est masqué en mode simple, comme dans ModuleSettings).
  const shownSettings = visibleSettings.filter((f) => !(f.type === "choice" && choices[f.key]?.mode === "only" && !advanced));
  const showSources = manage && advanced && (mod.manifest.consumes ?? []).length > 0;
  const overlayNode = mod.def.overlay ? (
    <p className="rounded-lg border border-line bg-surface p-3 text-sm">
      {t("instances.overlayUrl")}: <code className="break-all font-mono">{overlayUrl(siteUrl, instance.key)}</code>
    </p>
  ) : null;
  const filled = new Set<string>();
  if (overlayNode) filled.add("use");
  for (const b of panel) filled.add(panelTab(plan, b, manage)); // un bloc vise son onglet (`tab`) ; sans `tab` : Utiliser
  if (manage) {
    for (const f of shownSettings) filled.add(settingArea(f));
    if (showSources) filled.add("sources");
    filled.add("general");
  }
  const visible = visibleTabs(plan, filled);
  const tabLabel = (tab: (typeof visible)[number]) => (tab.label !== undefined ? L(tab.label) : t(`moduleTabs.${tab.id}`));
  const requested = typeof sp.tab === "string" ? sp.tab : null;
  const toFillTab = manage && missingFields[0] ? settingTab(plan, missingFields[0]) : null;
  const firstTab = initialTab(visible, { requested, toFill: toFillTab }) ?? "general";

  /** Les blocs du panneau qui s'affichent dans l'onglet `tab` (dans l'ordre du panneau), au-dessus du reste de l'onglet. */
  const panelFor = (tab: string) => {
    const mine = panel.filter((b) => panelTab(plan, b, manage) === tab);
    return mine.length > 0 ? <Blocks blocks={mine} locale={locale} adminInstanceId={instance.id} /> : null;
  };

  /** Les réglages du module affichés dans l'onglet `tab` : un formulaire par onglet (il n'enregistre que les siens), la barre « Enregistrer » les enregistre tous. */
  const settingsForm = (tab: string) => {
    const fields = shownSettings.filter((f) => settingTab(plan, f) === tab);
    if (!fields.length) return null;
    return (
      <ActionForm action={saveInstanceSettings} floating={floatingLabels(t)} key={`settings-${tab}`} submitLabel={t("action.save")} className="space-y-8 [&>div[aria-hidden]]:hidden">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="__tab" value={tab} />
        {advanced && <input type="hidden" name="__adv" value="1" />}
        <ModuleSettings t={t} locale={locale} defaultLocale={config.defaultLocale} locales={config.locales} fields={fields} allFields={mod.manifest.settings}
          groups={mod.manifest.optionalGroups ?? []} stored={stored} siteByLocale={siteByLocale} theme={theme} missing={new Set(missingFields.map((f) => f.key))}
          instanceId={instance.id} choices={choices} advanced={advanced} tabbed />
      </ActionForm>
    );
  };

  const sourcesForm = showSources && (
    <ActionForm action={saveSources} floating={floatingLabels(t)} key="sources" submitLabel={t("action.save")} className="space-y-4 [&>div[aria-hidden]]:hidden">
      <input type="hidden" name="id" value={id} />
      {advanced && <input type="hidden" name="__adv" value="1" />}
      <div>
        <h2 className="text-lg font-semibold">{t("sources.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("sources.intro")}</p>
      </div>
      {await Promise.all((mod.manifest.consumes ?? []).map(async (decl, i) => {
        const providers = await providersOf(decl.topic);
        const current = await getSources(id, decl.topic);
        return (
          <fieldset key={decl.topic} className={`${ui.card} space-y-3`}>
            <legend className="px-2 text-sm font-medium">{L(decl.label)}{advanced && <span className="ml-2 font-mono text-xs text-muted">{decl.topic}</span>}</legend>
            {providers.length === 0 && (
              <p className="text-sm text-muted">{t("sources.none")} <a href={EXTENSIONS_ADD_HREF} className="underline hover:text-accent">{t("sources.addModule")}</a></p>
            )}
            {providers.length > 0 && <p className="text-[13px] text-muted">{current.instances === null ? t("sources.allUsed") : t("sources.onlyChecked")}</p>}
            {providers.map((p) => (
              <Checkbox key={p.instance.key} name={`sources_${i}`} value={p.instance.key}
                label={`${p.mod.manifest.icon ?? "🧩"} ${labeler.label(p.instance)}${labeler.hasSiblings(p.instance.moduleId) ? ` (${L(p.mod.manifest.name)})` : ""}`}
                defaultChecked={current.instances === null || current.instances.includes(p.instance.key)} />
            ))}
            {advanced && decl.tags && (
              <details open={current.tags.length > 0} className="pt-1">
                <summary className="cursor-pointer text-sm font-medium">{t("sources.filter")}</summary>
                <div className="mt-3"><TextField name={`tags_${i}`} label={t("sources.tags")} help={t("sources.tagsHelp")} defaultValue={current.tags.join(", ")} /></div>
              </details>
            )}
          </fieldset>
        );
      }))}
    </ActionForm>
  );

  const generalForm = (
    <ActionForm action={saveInstance} floating={floatingLabels(t)} key="general" submitLabel={t("action.save")} className="space-y-8 [&>div[aria-hidden]]:hidden">
      <input type="hidden" name="id" value={id} />
      {advanced && <input type="hidden" name="__adv" value="1" />}
      <section className="space-y-3">
        <h2 className="sr-only">{t("instances.general")}</h2>
        <div className={`${ui.card} grid grid-cols-1 items-start gap-4 min-[1100px]:grid-cols-2`}>
          {/* Le surnom ne sert qu'à distinguer plusieurs instances du même module : superflu (donc absent) s'il n'y en a qu'une. */}
          {showNickname && (
            <TextField name="nickname" label={t("instances.nickname")} help={t("instances.nicknameAdminHelp", { module: L(mod.manifest.name) })} required defaultValue={instance.nickname ?? ""} />
          )}

          {advanced ? (
            <div className="space-y-3 min-[1100px]:col-span-2">
              {config.locales.map((l) => (
                <div key={l} className="grid gap-3 sm:grid-cols-2">
                  <TextField name={`name_${l}`} label={`${t("field.name")} — ${localeName(l)}`} defaultValue={instance.names[l] ?? ""} required={l === config.defaultLocale} />
                  <TextField name={`description_${l}`} label={`${t("field.description")} — ${localeName(l)}`} defaultValue={instance.descriptions[l] ?? ""} />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Version simple : un seul nom, dans la langue du site ; les traductions déjà saisies sont conservées telles quelles. */}
              <TextField name={`name_${config.defaultLocale}`} label={t("instances.displayName")} defaultValue={instance.names[config.defaultLocale] ?? ""} required />
              <input type="hidden" name={`description_${config.defaultLocale}`} value={instance.descriptions[config.defaultLocale] ?? ""} />
              {config.locales.filter((l) => l !== config.defaultLocale).map((l) => (
                <span key={l} className="hidden">
                  <input type="hidden" name={`name_${l}`} value={instance.names[l] ?? ""} />
                  <input type="hidden" name={`description_${l}`} value={instance.descriptions[l] ?? ""} />
                </span>
              ))}
            </>
          )}

          {hasPage(mod.manifest) && (
            <div className="flex flex-wrap gap-x-8 gap-y-2 min-[1100px]:col-span-2">
              <Checkbox name="showInNav" label={t("instances.showInNav")} defaultChecked={instance.showInNav} />
            </div>
          )}
          {/* Où la retrouver : dans le menu, ou rangée dans la page Intégrations (réglée une fois). Le choix l'emporte sur la règle par défaut. */}
          <input type="hidden" name="placement_was" value={placement} />
          <Select name="placement" label={t("placement.title")} help={placementIsDefault ? t("placement.helpDefault") : t("placement.helpChosen")} defaultValue={placement}
            options={placementsFor(mod.manifest).map((value) => ({ value, label: t(PLACE_LABEL[value]) }))} />
          {content && (
            <Select name="sort" label={t("instances.sort")} help={t("instances.sortHelp")} defaultValue={sort}
              options={SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))} />
          )}
          {advanced && (mod.manifest.mcp?.length || content) && (
            <div className="min-[1100px]:col-span-2"><Checkbox name="mcp" label={t("instances.mcp")} help={t("instances.mcpHelp")} defaultChecked={mcpOn} /></div>
          )}
          {hasPage(mod.manifest) && !advanced && (
            <p className="text-sm text-muted min-[1100px]:col-span-2">{t("instances.address")} : <code className="font-mono">/{instance.basePath}</code></p>
          )}
          {hasPage(mod.manifest) && advanced && (
            <div className="grid gap-4 sm:grid-cols-2 min-[1100px]:col-span-2">
              <TextField name="basePath" label={t("instances.basePath")} help={t("instances.basePathHelp")} defaultValue={instance.basePath ?? ""} />
              <TextField name="navOrder" type="number" label={t("instances.navOrder")} defaultValue={instance.navOrder} />
            </div>
          )}
        </div>
      </section>

      {content && advanced && (
        <>
          <h2 className="text-lg font-semibold">{t("instances.presentation")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select name="display" label={t("instances.display")} defaultValue={instance.display}
              options={DISPLAYS.map((d) => ({ value: d, label: t(`display.${d}`) }))} />
            <Select name="clickAction" label={t("instances.clickAction")} defaultValue={instance.clickAction}
              options={[{ value: "detail", label: t("click.detail") }, { value: "external", label: t("click.external") }]} />
          </div>
          <fieldset className={`${ui.card} space-y-2`}>
            <legend className="px-2 text-sm font-medium">{t("instances.features")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURES.map((f) => <Checkbox key={f} name={`feature_${f}`} label={t(`feature.${f}`)} defaultChecked={instance.features.includes(f)} />)}
            </div>
          </fieldset>
          <TextArea name="fieldSchema" label={t("instances.customFields")} help={t("instances.customFieldsHelp")} rows={4} mono
            defaultValue={instance.fieldSchema.map((f) => `${f.key} | ${f.label} | ${f.type === "ref" ? `ref:${f.topic}` : f.type}`).join("\n")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox name="fallbackToDefault" label={t("instances.fallback")} help={t("instances.fallbackHelp")} defaultChecked={instance.fallbackToDefault} />
            <Checkbox name="allowGoLinks" label={t("instances.goLinks")} help={t("instances.goLinksHelp")} defaultChecked={instance.allowGoLinks} />
            <Checkbox name="exposed" label={t("instances.exposed")} help={t("instances.exposedHelp")} defaultChecked={instance.exposed} />
          </div>
        </>
      )}
    </ActionForm>
  );

  const tasksNode = advanced && taskRows.length > 0 && (
    <div className={`${ui.card} space-y-1 text-sm`}>
      <p className="font-medium">{t("tasks.title")}</p>
      <ul className="space-y-0.5">
        {taskRows.map((r) => (
          <li key={r.name}>
            <code className="font-mono">{r.name}</code> · {t("tasks.every", { n: r.every })} ·{" "}
            {r.state ? <span className={r.state.status === "ok" ? "" : "text-red-500"}>{t(r.state.status === "ok" ? "tasks.ok" : "tasks.failed")} · {r.state.lastRun.slice(0, 16).replace("T", " ")} UTC{r.state.error ? ` · ${r.state.error}` : ""}</span> : t("tasks.never")}
          </li>
        ))}
      </ul>
    </div>
  );

  // Zone sensible : en bas de Général, dans un encadré à part (jamais dans l'onglet d'usage). Chaque action demande une confirmation en clair.
  const dangerZone = (
    <section className="space-y-4 border-t border-line pt-8" data-testid="danger-zone" aria-labelledby="danger-zone-title">
      <div>
        <h2 id="danger-zone-title" className="text-lg font-semibold text-red-700"><span aria-hidden>⚠ </span>{t("instances.dangerZone")}</h2>
        <p className="mt-1 text-sm text-muted">{t("instances.dangerZoneHelp")}</p>
      </div>
      <KeptData t={t} locale={locale} name={moduleName} kept={await listRetired(instance.moduleId)} />
      {scope === "module" ? (
        <RemoveSection t={t} title={t("remove.title")} intro={t("remove.introModule", { name: moduleName })} name={moduleName}
          keep={uninstallModuleAction.bind(null, mod.manifest.id, true)} erase={uninstallModuleAction.bind(null, mod.manifest.id, false)} />
      ) : (
        <RemoveSection t={t} title={t("remove.title")} intro={t(advanced ? "remove.introInstance" : "remove.introInstanceSimple", { name: labeler.label(instance) })} name={labeler.label(instance)}
          keep={deleteInstanceAction.bind(null, instance.id, true)} erase={deleteInstanceAction.bind(null, instance.id, false)} />
      )}
    </section>
  );

  /** Ce que montre l'onglet `tab` : les zones qui y aboutissent (un onglet par défaut retiré verse la sienne dans un autre), dans un ordre fixe. */
  const tabContent = (tab: string) => {
    const here = (area: string) => plan.target(area) === tab;
    const sourcesFirst = tab === "sources";
    return (
      <>
        {here("use") && overlayNode}
        {panelFor(tab)}
        {manage && sourcesFirst && here("sources") && sourcesForm}
        {manage && settingsForm(tab)}
        {manage && !sourcesFirst && here("sources") && sourcesForm}
        {manage && here("general") && <>{generalForm}{tasksNode}{dangerZone}</>}
      </>
    );
  };

  // Module à contenu : « Contenu » (la liste des entrées, une autre page) se place devant les onglets, dans la même rangée.
  const lead = content && manage ? { href: `/admin/entries?c=${instance.key}`, label: t("tabs.content") } : undefined;
  const tabsLabels = { modified: t("moduleTabs.modified"), error: t("moduleTabs.error"), leave: t("moduleTabs.leaveConfirm"), list: t("moduleTabs.list", { name: labeler.label(instance) }) };

  return (
    // `--tabs-top` : hauteur de ce qui reste collé au-dessus de la rangée d'onglets (barre du menu sur téléphone, barre « Fermer » d'une fenêtre).
    <div className={`space-y-8 ${inModal ? "[--tabs-top:3.8rem]" : "[--tabs-top:4.5rem] md:[--tabs-top:0px]"}`} data-testid="instance-view">
      <div className="space-y-3">
        <InstanceTabs t={t} id={instance.id} keyName={instance.key} name={labeler.label(instance)} icon={mod.manifest.icon ?? "🧩"} active="settings" content={!!content} canConfigure={manage} titleOnly />
        {(advanced || labeler.label(instance) !== L(mod.manifest.name)) && (
          <p className="text-sm text-muted">
            {L(mod.manifest.name)}{advanced && <> · {t(`type.${effectiveType(mod.manifest)}`)} · v{mod.manifest.version} · {t("instances.technicalId")} <span className="font-mono">{instance.key}</span></>}
          </p>
        )}
        <p className="max-w-[70ch]">{L(mod.manifest.description)}</p>
        {manage && <MissingBox title={t("missing.title")} items={missingItems} />}
        {manage && dataStatus && (
          <div role="alert" className="space-y-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">
            <p>{dataStatus.error === "floor" ? t("migration.floor", { from: dataStatus.from ?? "?", floor: dataStatus.floor ?? "?" }) : dataStatus.error === "timeout" ? t("migration.timeout") : t(dataStatus.status === "newer" ? "migration.newer" : "migration.failed")}</p>
            {dataStatus.error && dataStatus.error !== "floor" && dataStatus.error !== "timeout" && <p className="font-mono text-xs">{dataStatus.error}</p>}
            <form action={retryMigrationAction.bind(null, instance.id)}><PendingButton pendingLabel={t("progress.retrying")}>{t("migration.retry")}</PendingButton></form>
          </div>
        )}
        <SuggestNotices instanceId={instance.id} query={sp} t={t} isOwner={isOwner(user)} />
      </div>

      {visible.length > 1 || lead ? (
        <PageTabs tabs={visible.map((tab) => ({ id: tab.id, label: tabLabel(tab) }))} initial={firstTab} labels={tabsLabels} history={inModal ? "replace" : "push"} surface={inModal ? "modal" : "page"} lead={lead}>
          {visible.map((tab) => <TabPanel key={tab.id} id={tab.id}>{tabContent(tab.id)}</TabPanel>)}
          {/* Place pour la barre « Enregistrer » flottante sous le dernier champ. */}
          <div aria-hidden="true" className="h-12" />
        </PageTabs>
      ) : (
        <div className="space-y-8">
          {visible[0] && tabContent(visible[0].id)}
          <div aria-hidden="true" className="h-12" />
        </div>
      )}
    </div>
  );
}
