import type { CollectionView } from "@/core/collections";
import { localeName } from "@/core/i18n/locales";
import type { Translator } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ImageField } from "@/components/admin/ImageField";
import { ui } from "@/components/admin/ui";
import { saveEntry } from "./actions";

export type EntryFormData = {
  id?: string;
  status: string;
  cover: string | null;
  icon: string | null;
  url: string | null;
  code: string | null;
  featured: boolean;
  expiresAt: string;
  publishedAt: string;
  fields: Record<string, unknown>;
  translations: { locale: string; slug: string; title: string; summary: string; body: string }[];
};

type Props = {
  t: Translator;
  collection: CollectionView;
  locales: string[];
  locale: string;
  data: EntryFormData;
};

/**
 * Éditeur d'entrée. Une version par langue : on n'en demande qu'une, et les
 * autres s'ajoutent à la demande (jamais imposées).
 */
export function EntryForm({ t, collection, locales, locale, data }: Props) {
  const has = (f: string) => collection.features.includes(f as never);
  const current = data.translations.find((tr) => tr.locale === locale);
  const missing = locales.filter((l) => !data.translations.some((tr) => tr.locale === l));
  const base = data.id ? `/admin/entries/${data.id}` : `/admin/entries/new?c=${collection.key}`;

  return (
    <div className="space-y-6">
      {data.id && (
        <nav aria-label={t("entries.languages")} className="flex flex-wrap items-center gap-2 text-sm">
          {data.translations.map((tr) => (
            <a key={tr.locale} href={`${base}?locale=${tr.locale}`} aria-current={tr.locale === locale ? "page" : undefined}
              className={`rounded-lg border px-3 py-1 ${tr.locale === locale ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>
              {localeName(tr.locale)}
            </a>
          ))}
          {missing.length > 0 && (
            <details className="relative">
              <summary className={`${ui.btn} cursor-pointer list-none`}>+ {t("entries.addVersion")}</summary>
              <div className="absolute z-10 mt-1 min-w-40 rounded-lg border border-line bg-bg p-1 shadow-lg">
                {missing.map((l) => (
                  <a key={l} href={`${base}?locale=${l}`} className="block rounded px-3 py-1.5 hover:bg-surface">{localeName(l)}</a>
                ))}
              </div>
            </details>
          )}
        </nav>
      )}

      {!current && data.id && (
        <p className="rounded-lg border border-line bg-surface p-3 text-sm">{t("entries.newVersionHint", { lang: localeName(locale) })}</p>
      )}

      <ActionForm action={saveEntry} submitLabel={t("action.save")}>
        <input type="hidden" name="id" value={data.id ?? ""} />
        <input type="hidden" name="collectionId" value={collection.id} />
        <input type="hidden" name="locale" value={locale} />

        {!data.id && locales.length > 1 && (
          <Select name="locale" label={t("entries.language")} defaultValue={locale}
            options={locales.map((l) => ({ value: l, label: localeName(l) }))} />
        )}

        <TextField name="title" label={t("field.title")} required defaultValue={current?.title} />
        {has("summary") && <TextArea name="summary" label={t("field.summary")} rows={3} defaultValue={current?.summary} />}
        {has("body") && <TextArea name="body" label={t("field.body")} help={t("field.bodyHelp")} rows={14} mono defaultValue={current?.body} />}
        <TextField name="slug" label={t("field.slug")} help={t("field.slugHelp")} defaultValue={current?.slug} />

        <fieldset className={`${ui.card} space-y-4`}>
          <legend className="px-2 text-sm font-medium">{t("entries.sharedFields")}</legend>
          {has("cover") && <ImageField name="cover" label={t("field.cover")} defaultValue={data.cover} uploadLabel={t("action.upload")} />}
          {has("icon") && <TextField name="icon" label={t("field.icon")} help={t("field.iconHelp")} defaultValue={data.icon ?? ""} />}
          {has("url") && <TextField name="url" type="url" label={t("field.url")} defaultValue={data.url ?? ""} placeholder="https://" />}
          {has("code") && <TextField name="code" label={t("field.code")} defaultValue={data.code ?? ""} />}
          {has("expiresAt") && <TextField name="expiresAt" type="date" label={t("field.expiresAt")} defaultValue={data.expiresAt} />}
          {has("featured") && <Checkbox name="featured" label={t("field.featured")} defaultChecked={data.featured} />}
          {collection.fieldSchema.map((f) =>
            f.type === "boolean" ? (
              <Checkbox key={f.key} name={`field_${f.key}`} label={f.label} defaultChecked={data.fields[f.key] === true} />
            ) : (
              <TextField key={f.key} name={`field_${f.key}`} label={f.label}
                type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
                defaultValue={data.fields[f.key] === undefined ? "" : String(data.fields[f.key])} />
            ),
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select name="status" label={t("field.status")} defaultValue={data.status}
              options={[{ value: "draft", label: t("status.draft") }, { value: "published", label: t("status.published") }]} />
            <TextField name="publishedAt" type="date" label={t("field.publishedAt")} help={t("field.publishedAtHelp")} defaultValue={data.publishedAt} />
          </div>
        </fieldset>
      </ActionForm>
    </div>
  );
}
