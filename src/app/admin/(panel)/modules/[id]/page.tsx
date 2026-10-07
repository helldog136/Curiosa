import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { buildContext, moduleSettingKey } from "@/core/modules/context";
import { getModule } from "@/core/modules/registry";
import { localized, type SettingField } from "@/core/modules/types";
import { getSettingByLocale } from "@/core/settings";
import { Blocks } from "@/components/site/Blocks";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { saveModuleSettings } from "../actions";

export default async function ModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale, config } = await adminCtx("admin");
  const { id } = await params;
  const mod = await getModule(id);
  if (!mod) notFound();
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  let panel: Awaited<ReturnType<NonNullable<typeof mod.def.adminPanel>>> = [];
  if (mod.row.enabled && mod.def.adminPanel) {
    try {
      panel = await mod.def.adminPanel(await buildContext(mod, locale));
    } catch (error) {
      console.error(`[modules] ${id} adminPanel failed:`, error);
    }
  }

  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of mod.manifest.settings) stored[f.key] = await getSettingByLocale(moduleSettingKey(id, f.key));

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{mod.manifest.icon ?? "🧩"} {L(mod.manifest.name)}</h1>
        <p className="mt-1 text-sm text-muted">v{mod.manifest.version}{mod.manifest.author ? ` · ${mod.manifest.author}` : ""}{mod.manifest.license ? ` · ${mod.manifest.license}` : ""}</p>
        <p className="mt-2">{L(mod.manifest.description)}</p>
        {mod.manifest.permissions.length > 0 && (
          <p className="mt-2 text-sm text-muted">{t("modules.permissions")}: {mod.manifest.permissions.join(", ")}</p>
        )}
        {!mod.row.enabled && <p className="mt-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("modules.disabledNotice")}</p>}
      </div>

      {mod.manifest.settings.length > 0 && (
        <ActionForm action={saveModuleSettings} submitLabel={t("action.save")}>
          <input type="hidden" name="id" value={id} />
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
    </div>
  );
}
