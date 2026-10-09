import type { InstanceView } from "@/core/instances";
import { localeName } from "@/core/i18n/locales";
import type { Translator } from "@/core/i18n/dictionary";
import { ActionForm } from "@/components/admin/ActionForm";
import { floatingLabels } from "@/components/admin/floating";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ImageField } from "@/components/admin/ImageField";
import { MarkdownField } from "@/components/admin/MarkdownField";
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
  tags: string;
  expiresAt: string;
  publishedAt: string;
  fields: Record<string, unknown>;
  translations: { locale: string; slug: string; title: string; summary: string; body: string }[];
};

type Props = {
  t: Translator;
  collection: InstanceView;
  locales: string[];
  locale: string;
  data: EntryFormData;
  advanced: boolean;
  /** Options des champs « référence », par sujet. */
  refOptions?: Record<string, { value: string; label: string }[]>;
};

/**
 * Éditeur d'entrée, dans l'ordre où on y pense : le titre, les informations propres à ce genre de contenu (code, lien…), le texte, l'image, puis la
 * publication. Tout le facultatif (résumé, icône, étiquettes, adresse…) est rangé dans « Options », qui s'ouvre d'office si une valeur y est déjà.
 * Une version par langue : on n'en demande qu'une, les autres s'ajoutent à la demande (jamais imposées).
 */
export function EntryForm({ t, collection, locales, locale, data, advanced, refOptions = {} }: Props) {
  const has = (f: string) => collection.features.includes(f as never);
  const current = data.translations.find((tr) => tr.locale === locale);
  const missing = locales.filter((l) => !data.translations.some((tr) => tr.locale === l));
  const hasDetails = has("code") || has("url") || collection.fieldSchema.length > 0;
  const hasOptions = has("summary") || has("icon") || has("expiresAt") || advanced;
  const optionsFilled = Boolean(
    (has("summary") && current?.summary) || (has("icon") && data.icon) || (has("expiresAt") && !has("code") && data.expiresAt) ||
    (advanced && (data.tags || data.featured || data.publishedAt)),
  );
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

      <ActionForm action={saveEntry} floating={floatingLabels(t)} submitLabel={data.id ? t("action.save") : t("entries.create")}>
        <input type="hidden" name="id" value={data.id ?? ""} />
        <input type="hidden" name="instanceId" value={collection.id} />
        <input type="hidden" name="locale" value={locale} />
        {advanced && <input type="hidden" name="__adv" value="1" />}

        {/* 1. Le titre : ce qu'on écrit d'abord. */}
        {!data.id && locales.length > 1 && (
          <Select name="locale" label={t("entries.language")} defaultValue={locale}
            options={locales.map((l) => ({ value: l, label: localeName(l) }))} />
        )}
        <TextField name="title" label={t("field.title")} required defaultValue={current?.title} />

        {/* 2. Les informations propres à ce genre de contenu (code, lien, date de fin, champs libres) : quelques lignes, avant le long texte. */}
        {hasDetails && (
          <div className="space-y-4">
            {has("code") && <TextField name="code" label={t("field.code")} defaultValue={data.code ?? ""} />}
            {has("url") && <TextField name="url" type="url" label={t("field.url")} defaultValue={data.url ?? ""} placeholder="https://" />}
            {has("code") && has("expiresAt") && <ExpiresField t={t} value={data.expiresAt} />}
            {collection.fieldSchema.map((f) =>
              f.type === "ref" ? (
                <Select key={f.key} name={`field_${f.key}`} label={f.label} defaultValue={String(data.fields[f.key] ?? "")}
                  options={[{ value: "", label: "—" }, ...(refOptions[f.topic ?? ""] ?? [])]} />
              ) : f.type === "boolean" ? (
                <Checkbox key={f.key} name={`field_${f.key}`} label={f.label} defaultChecked={data.fields[f.key] === true} />
              ) : (
                <TextField key={f.key} name={`field_${f.key}`} label={f.label}
                  type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
                  defaultValue={data.fields[f.key] === undefined ? "" : String(data.fields[f.key])} />
              ),
            )}
          </div>
        )}

        {/* 3. Le texte. */}
        {has("body") && (
          <MarkdownField name="body" label={t("field.body")} help={t("field.bodyHelp")} rows={14} defaultValue={current?.body}
            labels={{ bold: t("editor.bold"), italic: t("editor.italic"), link: t("editor.link"), list: t("editor.list"), heading: t("editor.heading"), quote: t("editor.quote") }} />
        )}

        {/* 4. L'image (la même pour toutes les langues). */}
        {has("cover") && (
          <div>
            <ImageField name="cover" label={t("field.cover")} defaultValue={data.cover} uploadLabel={t("action.upload")} />
            {locales.length > 1 && <p className={ui.help}>{t("entries.sharedHint")}</p>}
          </div>
        )}

        {/* 5. La publication : brouillon ou publié, dit en toutes lettres. */}
        <fieldset className={`${ui.card} space-y-3`}>
          <legend className="px-2 text-sm font-medium">{t("entries.publication")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["draft", "published"] as const).map((v) => (
              <label key={v} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg p-3.5 transition-colors hover:border-accent/50 has-[:checked]:border-accent has-[:checked]:bg-accent/5">
                <input type="radio" name="status" value={v} defaultChecked={data.status === v} className="mt-1 h-4 w-4 accent-[var(--v-accent)]" />
                <span>
                  <span className="block text-[15px] font-medium">{t(`status.${v}`)}</span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-muted">{t(`entries.status.${v}Help`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 6. Le reste est facultatif : rangé, mais ouvert d'office si quelque chose y est déjà rempli. */}
        {hasOptions && (
          <details open={optionsFilled} className={`${ui.card} group`}>
            <summary className="cursor-pointer list-none text-[15px] font-medium">
              <span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90" aria-hidden>›</span>{t("entries.options")}
              <span className="ml-2 text-[13px] font-normal text-muted">{t("entries.optionsHint")}</span>
            </summary>
            <div className="mt-5 space-y-4">
              {has("summary") && <TextArea name="summary" label={t("field.summary")} help={t("entries.summaryHelp")} rows={3} defaultValue={current?.summary} />}
              {has("icon") && (
                <div>
                  <TextField name="icon" list="brand-icons" label={t("field.icon")} help={t("field.iconHelp")} defaultValue={data.icon ?? ""} />
                  <datalist id="brand-icons">{BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
                </div>
              )}
              {has("expiresAt") && !has("code") && <ExpiresField t={t} value={data.expiresAt} />}
              {advanced && has("tags") && <TextField name="tags" label={t("field.tags")} help={t("field.tagsHelp")} defaultValue={data.tags} />}
              {advanced && has("featured") && <Checkbox name="featured" label={t("field.featured")} defaultChecked={data.featured} />}
              {advanced && <TextField name="publishedAt" type="date" label={t("field.publishedAt")} help={t("field.publishedAtHelp")} defaultValue={data.publishedAt} />}
              {advanced && <TextField name="slug" label={t("field.slug")} help={t("field.slugHelp")} defaultValue={current?.slug} />}
            </div>
          </details>
        )}
      </ActionForm>
    </div>
  );
}

function ExpiresField({ t, value }: { t: Translator; value: string }) {
  return <TextField name="expiresAt" type="date" label={t("field.expiresAt")} help={t("entries.expiresHelp")} defaultValue={value} />;
}

const BRANDS = ["twitch", "youtube", "instagram", "tiktok", "discord", "x", "facebook", "github", "kick", "spotify", "patreon", "bluesky", "mastodon", "linkedin", "reddit", "twitter", "snapchat", "telegram", "whatsapp", "paypal"];
