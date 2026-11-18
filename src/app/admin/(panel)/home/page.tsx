import { BLOCK_KINDS, CORE_INSTANCE, CORE_SECTION, normalizeBlockDef, type BlockKind } from "@/core/homeBlocks";
import { localeName } from "@/core/i18n/locales";
import { BLOCK_LABEL_KEYS } from "@/components/admin/blockLabels";
import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { getInstanceLabeler } from "@/core/modules/labels";
import { ENTRY_SECTION_ID, getActiveInstances, sectionsOf } from "@/core/modules/registry";
import { publishedEntryChoices } from "@/core/content/entries";
import { localized, type SettingField } from "@/core/modules/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import { HomeMenuHeader } from "@/components/admin/HomeMenuHeader";
import { PageHeader } from "@/components/admin/Page";
import { resolveSize } from "@/core/home";
import { SECTION_SIZES, type SectionSize } from "@/core/modules/types";
import { HomeBuilder, type HomeBlock, type HomeChoice } from "@/components/admin/HomeBuilder";
import { AssistantUndoNotice } from "@/components/admin/AssistantUndoNotice";
import { homeRestorePoint } from "@/core/maintenance/siteHome";
import { restoreAssistantHome, saveHome } from "./actions";

export default async function HomeAdminPage() {
  const { t, locale, config, advanced } = await adminCtx("admin");
  const active = await getActiveInstances();
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  // Toutes les sections proposables : une par (instance, section déclarée par son module).
  // The "page to show" chooser lists the published entries of each content instance (nothing to type by hand).
  const entryChoices = new Map(await Promise.all(active.filter(({ mod }) => !!mod.manifest.content).map(async ({ instance }) => [instance.key, await publishedEntryChoices(instance.id, locale, config.defaultLocale)] as const)));
  const choices: HomeChoice[] = active.flatMap(({ instance, mod }) =>
    sectionsOf(mod.manifest).map((s) => ({
      value: `${instance.key}|${s.id}`,
      icon: mod.manifest.icon ?? "🧩",
      title: L(s.label),
      subtitle: labeler.label(instance),
      defaultSize: resolveSize({}, s.size),
      options: ((s.options ?? []) as SettingField[]).map((o) => s.id === ENTRY_SECTION_ID && o.key === "entry"
        ? { key: o.key, type: o.type, label: L(o.label), default: entryChoices.get(instance.key)?.[0]?.id, options: (entryChoices.get(instance.key) ?? []).map((e) => ({ value: e.id, label: e.title })) }
        : { key: o.key, type: o.type, label: L(o.label), default: o.default, options: o.options?.map((op) => ({ value: op.value, label: L(op.label) })) }),
    })),
  );
  // Blocs de page du cœur : créés ici, sans module (voir core/homeBlocks.ts).
  const CORE_ICONS: Record<BlockKind, string> = { media: "🖼️", tabs: "🗂️", stats: "🔢", cta: "📣", video: "🎬" };
  const coreChoices: HomeChoice[] = BLOCK_KINDS.map((kind) => ({ value: `${CORE_INSTANCE}|${kind}`, icon: CORE_ICONS[kind], title: t(`home.core.${kind}`), subtitle: t(`home.core.${kind}.help`), defaultSize: "full", options: [], core: kind }));
  choices.unshift(...coreChoices);
  const initial: HomeBlock[] = config.homeSections.flatMap((row, i) => {
    if (row.instance === CORE_INSTANCE && row.section === CORE_SECTION) {
      const block = normalizeBlockDef((row.options as { block?: unknown }).block, config.locales);
      return [{ uid: row.id || `s${i}`, value: `${CORE_INSTANCE}|${block.kind}`, size: resolveSize(row, "full"), isolated: row.isolated === true, options: { block } }];
    }
    const c = choices.find((x) => x.value === `${row.instance}|${row.section}`);
    return c ? [{ uid: row.id || `s${i}`, value: c.value, size: resolveSize(row, c.defaultSize as SectionSize), isolated: row.isolated === true, options: { ...Object.fromEntries(c.options.filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), ...row.options } }] : [];
  });

  const undo = await homeRestorePoint();
  const blockLabels = Object.fromEntries(BLOCK_LABEL_KEYS.map((k) => [k, t(`block.${k}`)]));
  return (
    <div className="space-y-6">
      <HomeMenuHeader t={t} current="home" />
      <PageHeader level={2} title={t("nav.home")} intro={advanced ? t("home.intro") : t("home.intro.simple")} />
      {undo && <AssistantUndoNotice text={t("aim.undo.home", { name: undo.by, date: new Date(undo.at).toLocaleString(locale) })} button={t("aim.undo.home.button")} action={restoreAssistantHome} />}
      <ActionForm action={saveHome} floating={floatingLabels(t)} submitLabel={t("action.save")}>
        <HomeBuilder choices={choices} initial={initial} locales={config.locales.map((l) => ({ code: l, name: localeName(l) }))} blockLabels={blockLabels}
          labels={{ editBlock: t("home.editBlock"), coreGroup: t("home.coreGroup"), modulesGroup: t("home.modulesGroup"), noFeatures: t("home.noFeatures"), cancel: t("home.cancel"), layoutHelpTitle: t("home.layoutHelpTitle"), empty: t("home.empty"), add: t("home.addBlock"), pick: t("home.pick"), up: t("home.up"), down: t("home.down"), remove: t("home.removeBlock"), size: t("home.size"), alone: t("home.isolated"), aloneHelp: t("home.isolatedHelp"), adjust: t("home.adjust"),
            sizes: Object.fromEntries(SECTION_SIZES.map((z) => [z, t(`home.size.${z}`)])), sizeHelp: t("home.sizeHelp") }} />
        {advanced && <p className={ui.help}>{t("home.optionsHint")}</p>}
      </ActionForm>
    </div>
  );
}
