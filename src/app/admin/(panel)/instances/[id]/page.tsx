import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { DISPLAYS, FEATURES, getInstanceById, pickName } from "@/core/instances";
import { localeName } from "@/core/i18n/locales";
import { buildContext, instanceSettingKey } from "@/core/modules/context";
import { hasPage } from "@/core/modules/manifest";
import { getModule } from "@/core/modules/registry";
import { localized, type SettingField } from "@/core/modules/types";
import { getSettingByLocale } from "@/core/settings";
import { Blocks } from "@/components/site/Blocks";
import { siteUrl } from "@/core/config";
import { effectiveType } from "@/core/modules/manifest";
import { getSources, providersOf } from "@/core/modules/topics";
import { InstanceTabs } from "@/components/admin/InstanceTabs";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { deleteInstanceAction, saveInstance, saveInstanceSettings, saveSources } from "../actions";

export default async function InstancePage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale, config, user } = await adminCtx("admin");
  const { id } = await params;
  const instance = await getInstanceById(id);
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!instance || !mod) notFound();
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const content = mod.manifest.content;

  let panel: Awaited<ReturnType<NonNullable<typeof mod.def.adminPanel>>> = [];
  if (instance.enabled && mod.row.enabled && mod.def.adminPanel) {
    try {
      panel = await mod.def.adminPanel(await buildContext(mod, instance, locale));
    } catch (error) {
      console.error(`[modules] ${instance.key} adminPanel failed:`, error);
    }
  }

  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of mod.manifest.settings) stored[f.key] = await getSettingByLocale(instanceSettingKey(id, f.key));

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
      case "color":
        return <TextField key={name} {...common} type="color" defaultValue={str || "#000000"} />;
      case "url":
        return <TextField key={name} {...common} type="url" defaultValue={str} />;
      default:
        return <TextField key={name} {...common} defaultValue={str} />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <InstanceTabs t={t} id={instance.id} keyName={instance.key} name={pickName(instance, locale, config.defaultLocale)} icon={mod.manifest.icon ?? "🧩"} active="settings" content={!!content} canConfigure={user.role !== "editor"} />
        <p className="text-sm text-muted">
          {L(mod.manifest.name)} · {t(`type.${effectiveType(mod.manifest)}`)} · v{mod.manifest.version} · <span className="font-mono">{instance.key}</span>
        </p>
        <p>{L(mod.manifest.description)}</p>
        {mod.def.overlay && (
          <p className="rounded-lg border border-line bg-surface p-3 text-sm">
            {t("instances.overlayUrl")}: <code className="break-all font-mono">{siteUrl}/overlays/{instance.key}</code>
          </p>
        )}
        {!mod.row.enabled && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("modules.disabledNotice")}</p>}
      </div>

      <ActionForm action={saveInstance} submitLabel={t("action.save")}>
        <input type="hidden" name="id" value={id} />
        <h2 className="text-lg font-semibold">{t("instances.general")}</h2>

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
        {hasPage(mod.manifest) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="basePath" label={t("instances.basePath")} help={t("instances.basePathHelp")} defaultValue={instance.basePath ?? ""} />
            <TextField name="navOrder" type="number" label={t("instances.navOrder")} defaultValue={instance.navOrder} />
          </div>
        )}

        {content && (
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
              defaultValue={instance.fieldSchema.map((f) => `${f.key} | ${f.label} | ${f.type}`).join("\n")} />
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
          <div>
            <h2 className="text-lg font-semibold">{t("sources.title")}</h2>
            <p className="mt-1 text-sm text-muted">{t("sources.intro")}</p>
          </div>
          {await Promise.all((mod.manifest.consumes ?? []).map(async (decl, i) => {
            const providers = await providersOf(decl.topic);
            const current = await getSources(id, decl.topic);
            return (
              <fieldset key={decl.topic} className={`${ui.card} space-y-3`}>
                <legend className="px-2 text-sm font-medium">{L(decl.label)} <span className="font-mono text-xs text-muted">{decl.topic}</span></legend>
                {providers.length === 0 && <p className="text-sm text-muted">{t("sources.none")}</p>}
                {providers.map((p) => (
                  <Checkbox key={p.instance.key} name={`sources_${i}`} value={p.instance.key}
                    label={`${p.mod.manifest.icon ?? "🧩"} ${pickName(p.instance, locale, config.defaultLocale)} (${L(p.mod.manifest.name)})`}
                    defaultChecked={current.instances === null || current.instances.includes(p.instance.key)} />
                ))}
                {decl.tags && <TextField name={`tags_${i}`} label={t("sources.tags")} help={t("sources.tagsHelp")} defaultValue={current.tags.join(", ")} />}
              </fieldset>
            );
          }))}
        </ActionForm>
      )}

      {mod.manifest.settings.length > 0 && (
        <ActionForm action={saveInstanceSettings} submitLabel={t("action.save")}>
          <input type="hidden" name="id" value={id} />
          <h2 className="text-lg font-semibold">{t("instances.moduleSettings")}</h2>
          {mod.manifest.settings.map((f) =>
            f.translatable ? (
              <fieldset key={f.key} className={`${ui.card} space-y-3`}>
                <legend className="px-2 text-sm font-medium">{L(f.label)}</legend>
                {config.locales.map((l) => input(f, `s__${f.key}__${l}`, stored[f.key]?.[l], localeName(l)))}
              </fieldset>
            ) : (
              input(f, `s__${f.key}`, f.type === "secret" ? Boolean(stored[f.key]?.[""]) || undefined : stored[f.key]?.[""], L(f.label))
            ),
          )}
        </ActionForm>
      )}

      {panel.length > 0 && <Blocks blocks={panel} locale={locale} />}

      <form action={deleteInstanceAction.bind(null, instance.id)} className="border-t border-line pt-6">
        <p className="mb-2 text-sm text-muted">{t("instances.deleteWarning")}</p>
        <ConfirmButton message={t("confirm.delete")}>{t("instances.delete")}</ConfirmButton>
      </form>
    </div>
  );
}
