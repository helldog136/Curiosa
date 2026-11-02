import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceByKey } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { getInstanceLabeler } from "@/core/modules/labels";
import { pickLocalized } from "@/core/modules/profiles";
import { ui } from "@/components/admin/ui";
import { PendingButton } from "@/components/admin/PendingButton";
import { createFromTemplate } from "../actions";

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
        <a href={`/admin/entries?c=${collection.key}`} className="text-sm text-muted hover:text-accent">← {t("entries.backTo", { name })}</a>
        <h1 className="mt-1 text-2xl font-bold">{t("entries.templates.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("entries.templates.intro")}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="entry-templates">
        {templates.map((tpl) => (
          <li key={tpl.id} className={`${ui.card} flex flex-col gap-3`}>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{pickLocalized(tpl.name, locale)}</h2>
              {tpl.description && <p className="mt-1 text-sm text-muted">{pickLocalized(tpl.description, locale)}</p>}
            </div>
            <form action={createFromTemplate}>
              <input type="hidden" name="instanceKey" value={collection.key} />
              <input type="hidden" name="template" value={tpl.id} />
              <PendingButton variant="btn" className="min-h-11">{t("entries.templates.use")}</PendingButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
