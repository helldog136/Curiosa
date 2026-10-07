import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { DISPLAYS, FEATURES, getInstanceById } from "@/core/instances";
import { localeName } from "@/core/i18n/locales";
import { buildContext, instanceSettingKey } from "@/core/modules/context";
import { hasPage } from "@/core/modules/manifest";
import { getModule } from "@/core/modules/registry";
import { localized, type SettingField } from "@/core/modules/types";
import { buildTheme, themeRef } from "@/core/color";
import { getSetting, getSettingByLocale, getSiteConfig } from "@/core/settings";
import { mcpInstanceKey } from "@/core/modules/mcpProvider";
import { getInstanceLabeler } from "@/core/modules/labels";
import { Blocks } from "@/components/site/Blocks";
import { siteUrl } from "@/core/config";
import { effectiveType } from "@/core/modules/manifest";
import { getSources, providersOf } from "@/core/services/topics";
import { InstanceTabs } from "@/components/admin/InstanceTabs";
import { ImageField } from "@/components/admin/ImageField";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { dataStatusOf } from "@/core/modules/dataMigrations";
import { deleteInstanceAction, retryMigrationAction, saveInstance, saveInstanceSettings, saveSources } from "../actions";

export default async function InstancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const { id } = await params;
  const instance = await getInstanceById(id);
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!instance || !mod) notFound();
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const content = mod.manifest.content;
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const showNickname = labeler.hasSiblings(instance.moduleId);

  let panel: Awaited<ReturnType<NonNullable<typeof mod.def.adminPanel>>> = [];
  if (instance.enabled && mod.row.enabled && mod.def.adminPanel) {
    try {
      const sp = await searchParams;
      const query = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
      panel = await mod.def.adminPanel(await buildContext(mod, instance, locale), { query });
    } catch (error) {
      console.error(`[modules] ${instance.key} adminPanel failed:`, error);
    }
  }

  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of mod.manifest.settings) stored[f.key] = await getSettingByLocale(instanceSettingKey(id, f.key));

  const mcpOn = (await getSetting<boolean>(mcpInstanceKey(instance.id))) !== false;
  const dataStatus = await dataStatusOf(instance.id);
  const visibleSettings = mod.manifest.settings.filter((f) => advanced || !f.advanced);
  const generalSettings = visibleSettings.filter((f) => f.group !== "appearance");
  const appearanceSettings = visibleSettings.filter((f) => f.group === "appearance");
  const siteConfig = await getSiteConfig();
  const theme = buildTheme(siteConfig.background, siteConfig.accent, siteConfig.font);

  const input = (f: SettingField, name: string, value: unknown, label: string) => {
    const common = { name, label, help: f.help ? L(f.help) : undefined };
    const str = value === undefined ? (f.default === undefined ? "" : String(f.default)) : String(value);
    switch (f.type) {
      case "boolean":
        return <Checkbox key={name} {...common} defaultChecked={value === undefined ? f.default === true : value === true} />;
      case "textarea":
        return <TextArea key={name} {...common} rows={4} defaultValue={str} />;
      case "select":
        return <Select key={name} {...common} defaultValue={str} options={(f.options ?? []).map((o) => ({ value: o.value, label: L(o.label) }))} />;
      case "secret":
        return <TextField key={name} {...common} type="password" placeholder={value ? "••••••••" : ""} autoComplete="off" />;
      case "number":
        return <TextField key={name} {...common} type="number" defaultValue={str} />;
      case "color": {
        // Une couleur qui suit le thème (défaut « theme:… ») : case « Suivre le thème » cochée tant qu'aucune couleur n'est choisie.
        const token = themeRef(f.default);
        if (!token) return <TextField key={name} {...common} type="color" defaultValue={str || "#000000"} />;
        const own = typeof value === "string" && value !== "" ? value : null;
        return (
          <div key={name} className="space-y-1">
            <TextField {...common} type="color" defaultValue={own ?? theme[token]} />
            <Checkbox name={`${name}__theme`} label={t("instances.followTheme")} help={t("instances.followThemeHelp")} defaultChecked={own === null} />
          </div>
        );
      }
      case "image":
        return <ImageField key={name} name={name} label={label} defaultValue={str} uploadLabel={t("action.upload")} />;
      case "url":
        return <TextField key={name} {...common} type="url" defaultValue={str} />;
      default:
        return <TextField key={name} {...common} defaultValue={str} />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <InstanceTabs t={t} id={instance.id} keyName={instance.key} name={labeler.label(instance)} icon={mod.manifest.icon ?? "🧩"} active="settings" content={!!content} canConfigure={user.role !== "editor"} />
        <p className="text-sm text-muted">
          {L(mod.manifest.name)}{advanced && <> · {t(`type.${effectiveType(mod.manifest)}`)} · v{mod.manifest.version} · {t("instances.technicalId")} <span className="font-mono">{instance.key}</span></>}
        </p>
        <p>{L(mod.manifest.description)}</p>
        {mod.def.overlay && (
          <p className="rounded-lg border border-line bg-surface p-3 text-sm">
            {t("instances.overlayUrl")}: <code className="break-all font-mono">{siteUrl}/overlays/{instance.key}</code>
          </p>
        )}
        {dataStatus && (
          <div role="alert" className="space-y-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">
            <p>{t(dataStatus.status === "newer" ? "migration.newer" : "migration.failed")}</p>
            {dataStatus.error && <p className="font-mono text-xs">{dataStatus.error}</p>}
            <form action={retryMigrationAction.bind(null, instance.id)}><button className={ui.btn}>{t("migration.retry")}</button></form>
          </div>
        )}
        {!mod.row.enabled && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("modules.disabledNotice")}</p>}
      </div>

      <ActionForm action={saveInstance} submitLabel={t("action.save")}>
        <input type="hidden" name="id" value={id} />
        {advanced && <input type="hidden" name="__adv" value="1" />}
        <h2 className="text-lg font-semibold">{t("instances.general")}</h2>
        {/* Le surnom ne sert qu'à distinguer plusieurs instances du même module : superflu (donc absent) s'il n'y en a qu'une. */}
        {showNickname && (
          <TextField name="nickname" label={t("instances.nickname")} help={t("instances.nicknameAdminHelp", { module: L(mod.manifest.name) })} required defaultValue={instance.nickname ?? ""} />
        )}

        <fieldset className={`${ui.card} space-y-4`}>
          <legend className="px-2 text-sm font-medium">{t("instances.names")}</legend>
          {config.locales.map((l) => (
            <div key={l} className="grid gap-3 sm:grid-cols-2">
              <TextField name={`name_${l}`} label={`${t("field.name")} — ${localeName(l)}`} defaultValue={instance.names[l] ?? ""} required={l === config.defaultLocale} />
              <TextField name={`description_${l}`} label={`${t("field.description")} — ${localeName(l)}`} defaultValue={instance.descriptions[l] ?? ""} />
            </div>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox name="enabled" label={t("instances.enabled")} defaultChecked={instance.enabled} />
          {hasPage(mod.manifest) && <Checkbox name="showInNav" label={t("instances.showInNav")} defaultChecked={instance.showInNav} />}
        </div>
        {advanced && (mod.manifest.mcp?.length || content) && (
          <Checkbox name="mcp" label={t("instances.mcp")} help={t("instances.mcpHelp")} defaultChecked={mcpOn} />
        )}
        {hasPage(mod.manifest) && !advanced && (
          <p className="text-sm text-muted">{t("instances.address")} : <code className="font-mono">/{instance.basePath}</code></p>
        )}
        {hasPage(mod.manifest) && advanced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="basePath" label={t("instances.basePath")} help={t("instances.basePathHelp")} defaultValue={instance.basePath ?? ""} />
            <TextField name="navOrder" type="number" label={t("instances.navOrder")} defaultValue={instance.navOrder} />
          </div>
        )}

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

      {(mod.manifest.consumes ?? []).length > 0 && (
        <ActionForm action={saveSources} submitLabel={t("action.save")}>
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
                {providers.length === 0 && <p className="text-sm text-muted">{t("sources.none")}</p>}
                {providers.map((p) => (
                  <Checkbox key={p.instance.key} name={`sources_${i}`} value={p.instance.key}
                    label={`${p.mod.manifest.icon ?? "🧩"} ${labeler.label(p.instance)}${labeler.hasSiblings(p.instance.moduleId) ? ` (${L(p.mod.manifest.name)})` : ""}`}
                    defaultChecked={current.instances === null || current.instances.includes(p.instance.key)} />
                ))}
                {advanced && decl.tags && <TextField name={`tags_${i}`} label={t("sources.tags")} help={t("sources.tagsHelp")} defaultValue={current.tags.join(", ")} />}
              </fieldset>
            );
          }))}
        </ActionForm>
      )}

      {visibleSettings.length > 0 && (
        <ActionForm action={saveInstanceSettings} submitLabel={t("action.save")}>
          <input type="hidden" name="id" value={id} />
          {advanced && <input type="hidden" name="__adv" value="1" />}
          {[{ title: t("instances.moduleSettings"), fields: generalSettings }, { title: t("instances.appearance"), fields: appearanceSettings }].map(
            (group) =>
              group.fields.length > 0 && (
                <div key={group.title} className="space-y-4">
                  <h2 className="text-lg font-semibold">{group.title}</h2>
                  {group.fields.map((f) =>
                    f.translatable ? (
                      <fieldset key={f.key} className={`${ui.card} space-y-3`}>
                        <legend className="px-2 text-sm font-medium">{L(f.label)}</legend>
                        {config.locales.map((l) => input(f, `s__${f.key}__${l}`, stored[f.key]?.[l], localeName(l)))}
                      </fieldset>
                    ) : (
                      input(f, `s__${f.key}`, f.type === "secret" ? Boolean(stored[f.key]?.[""]) || undefined : stored[f.key]?.[""], L(f.label))
                    ),
                  )}
                </div>
              ),
          )}
        </ActionForm>
      )}

      {panel.length > 0 && <Blocks blocks={panel} locale={locale} adminInstanceId={instance.id} />}

      <form action={deleteInstanceAction.bind(null, instance.id)} className="border-t border-line pt-6">
        <p className="mb-2 text-sm text-muted">{t("instances.deleteWarning")}</p>
        <ConfirmButton message={t("confirm.delete")}>{t("instances.delete")}</ConfirmButton>
      </form>
    </div>
  );
}
