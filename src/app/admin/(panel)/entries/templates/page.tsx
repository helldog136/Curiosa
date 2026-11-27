import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceByKey } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { getInstanceLabeler } from "@/core/modules/labels";
import { pickLocalized } from "@/core/modules/profiles";
import { ui } from "@/components/admin/ui";
import { PendingButton } from "@/components/admin/PendingButton";
import { createFromTemplate } from "../actions";
import { entriesHref } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ c?: string }> }): Promise<Metadata> {
  const { c } = await searchParams;
  return adminTitle(async ({ t, locale, config }) => {
    const collection = c ? await getInstanceByKey(c) : undefined;
    return collection ? `${t("entries.templates.title")} \u00b7 ${(await getInstanceLabeler(locale, config.defaultLocale)).label(collection)}` : "";
  }, { need: "editor" });
}

/**
 * « Partir d'un modèle » : les modèles d'entrée que le module déclare (`content.templates`). Un modèle crée un BROUILLON prérempli, jamais une page publiée ;
 * on le modifie ensuite comme n'importe quelle entrée. Aucune obligation : « Nouvelle entrée » reste le chemin direct.
 */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { t, locale, config } = await adminCtx("editor");
  const { c } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();
  const templates = (await getActiveInstances()).find((a) => a.instance.id === collection.id)?.mod.manifest.content?.templates ?? [];
  if (!templates.length) notFound();
  const name = (await getInstanceLabeler(locale, config.defaultLocale)).label(collection);
  return (
    <div className="space-y-6">
      <div>
        <a href={entriesHref(collection.key)} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-accent">← {t("entries.backTo", { name })}</a>
        <h1 className="mt-1 text-2xl font-bold">{t("entries.templates.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("entries.templates.intro")}</p>
      </div>
      <ul className={`${ui.card} divide-y divide-line !p-0`} data-testid="entry-templates">
        {templates.map((tpl) => {
          const description = tpl.description ? pickLocalized(tpl.description, locale) : "";
          return (
            <li key={tpl.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
              <div className="min-w-0 flex-1 basis-56">
                <h2 className="truncate font-medium" title={pickLocalized(tpl.name, locale)}>{pickLocalized(tpl.name, locale)}</h2>
                {description && <p className="truncate text-sm text-muted" title={description}>{description}</p>}
              </div>
              <form action={createFromTemplate}>
                <input type="hidden" name="instanceKey" value={collection.key} />
                <input type="hidden" name="template" value={tpl.id} />
                <PendingButton variant="btn" className="min-h-11">{t("entries.templates.use")}</PendingButton>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
