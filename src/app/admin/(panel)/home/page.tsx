import { BLOCK_KINDS, CORE_INSTANCE, CORE_SECTION, normalizeBlockDef, type BlockKind } from "@/core/homeBlocks";
import { localeName } from "@/core/i18n/locales";
import { BLOCK_LABEL_KEYS } from "@/components/admin/blockLabels";
import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { getInstanceLabeler } from "@/core/modules/labels";
import { getActiveInstances, sectionsOf } from "@/core/modules/registry";
import { localized, type SettingField } from "@/core/modules/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import { resolveSize } from "@/core/home";
import { SECTION_SIZES, type SectionSize } from "@/core/modules/types";
import { HomeBuilder, type HomeBlock, type HomeChoice } from "@/components/admin/HomeBuilder";
import { saveHome } from "./actions";

export default async function HomeAdminPage() {
  const { t, locale, config, advanced } = await adminCtx("admin");
  const active = await getActiveInstances();
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  // Toutes les sections proposables : une par (instance, section déclarée par son module).
  const choices: HomeChoice[] = active.flatMap(({ instance, mod }) =>
    sectionsOf(mod.manifest).map((s) => ({
      value: `${instance.key}|${s.id}`,
      icon: mod.manifest.icon ?? "🧩",
      title: L(s.label),
      subtitle: labeler.label(instance),
      defaultSize: resolveSize({}, s.size),
      options: ((s.options ?? []) as SettingField[]).map((o) => ({ key: o.key, type: o.type, label: L(o.label), default: o.default, options: o.options?.map((op) => ({ value: op.value, label: L(op.label) })) })),
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

  const blockLabels = Object.fromEntries(BLOCK_LABEL_KEYS.map((k) => [k, t(`block.${k}`)]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className={ui.pageTitle}>{t("nav.home")}</h1>
        <p className={ui.pageIntro}>{advanced ? t("home.intro") : t("home.intro.simple")}</p>
      </div>
      <ActionForm action={saveHome} floating={floatingLabels(t)} submitLabel={t("action.save")}>
        <HomeBuilder choices={choices} initial={initial} locales={config.locales.map((l) => ({ code: l, name: localeName(l) }))} blockLabels={blockLabels}
          labels={{ editBlock: t("home.editBlock"), coreGroup: t("home.coreGroup"), modulesGroup: t("home.modulesGroup"), empty: t("home.empty"), add: t("home.addBlock"), pick: t("home.pick"), up: t("home.up"), down: t("home.down"), remove: t("home.removeBlock"), size: t("home.size"), alone: t("home.isolated"), aloneHelp: t("home.isolatedHelp"), adjust: t("home.adjust"),
            sizes: Object.fromEntries(SECTION_SIZES.map((z) => [z, t(`home.size.${z}`)])), sizeHelp: t("home.sizeHelp") }} />
        {advanced && <p className={ui.help}>{t("home.optionsHint")}</p>}
      </ActionForm>
    </div>
  );
}
