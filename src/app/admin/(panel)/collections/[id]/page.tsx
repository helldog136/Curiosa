import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { DISPLAYS, FEATURES, getCollectionById } from "@/core/collections";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { ui } from "@/components/admin/ui";
import { deleteCollection, updateCollection } from "../actions";

export default async function EditCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, config } = await adminCtx("admin");
  const { id } = await params;
  const c = await getCollectionById(id);
  if (!c) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{c.names[config.defaultLocale] ?? c.key} <span className="font-mono text-base text-muted">({c.key})</span></h1>
      <ActionForm action={updateCollection} submitLabel={t("action.save")}>
        <input type="hidden" name="id" value={c.id} />

        <fieldset className={`${ui.card} space-y-4`}>
          <legend className="px-2 text-sm font-medium">{t("collections.names")}</legend>
          {config.locales.map((l) => (
            <div key={l} className="grid gap-3 sm:grid-cols-2">
              <TextField name={`name_${l}`} label={`${t("field.name")} — ${localeName(l)}`} defaultValue={c.names[l] ?? ""} required={l === config.defaultLocale} />
              <TextField name={`description_${l}`} label={`${t("field.description")} — ${localeName(l)}`} defaultValue={c.descriptions[l] ?? ""} />
            </div>
          ))}
        </fieldset>

        <TextField name="basePath" label={t("collections.basePath")} help={t("collections.basePathHelp")} defaultValue={c.basePath} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select name="display" label={t("collections.display")} defaultValue={c.display}
            options={DISPLAYS.map((d) => ({ value: d, label: t(`display.${d}`) }))} />
          <Select name="clickAction" label={t("collections.clickAction")} defaultValue={c.clickAction}
            options={[{ value: "detail", label: t("click.detail") }, { value: "external", label: t("click.external") }]} />
        </div>

        <fieldset className={`${ui.card} space-y-2`}>
          <legend className="px-2 text-sm font-medium">{t("collections.features")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURES.map((f) => <Checkbox key={f} name={`feature_${f}`} label={t(`feature.${f}`)} defaultChecked={c.features.includes(f)} />)}
          </div>
        </fieldset>

        <TextArea name="fieldSchema" label={t("collections.customFields")} help={t("collections.customFieldsHelp")} rows={4} mono
          defaultValue={c.fieldSchema.map((f) => `${f.key} | ${f.label} | ${f.type}`).join("\n")} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox name="published" label={t("collections.published")} defaultChecked={c.published} />
          <Checkbox name="showInNav" label={t("collections.showInNav")} defaultChecked={c.showInNav} />
          <Checkbox name="fallbackToDefault" label={t("collections.fallback")} help={t("collections.fallbackHelp")} defaultChecked={c.fallbackToDefault} />
          <Checkbox name="allowGoLinks" label={t("collections.goLinks")} help={t("collections.goLinksHelp")} defaultChecked={c.allowGoLinks} />
        </div>
        <TextField name="navOrder" type="number" label={t("collections.navOrder")} defaultValue={c.navOrder} />
      </ActionForm>

      <form action={deleteCollection.bind(null, c.id)} className="border-t border-line pt-6">
        <p className="mb-2 text-sm text-muted">{t("collections.deleteWarning")}</p>
        <ConfirmButton message={t("confirm.delete")}>{t("collections.delete")}</ConfirmButton>
      </form>
    </div>
  );
}
