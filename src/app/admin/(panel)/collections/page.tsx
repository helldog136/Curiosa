import { adminCtx } from "@/core/admin";
import { listCollections, pickName } from "@/core/collections";
import { PRESETS, presetName } from "@/core/presets";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { Select, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { createCollection } from "./actions";

export default async function CollectionsPage() {
  const { t, locale, config } = await adminCtx("admin");
  const collections = await listCollections();
  const counts = await prisma.entry.groupBy({ by: ["collectionId"], _count: true });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.collections")}</h1>
        <p className="mt-1 text-sm text-muted">{t("collections.intro")}</p>
      </div>
      <table className="w-full">
        <thead><tr><th className={ui.th}>{t("field.name")}</th><th className={ui.th}>URL</th><th className={ui.th}>{t("collections.entries")}</th></tr></thead>
        <tbody>
          {collections.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <td className={ui.td}><a className="font-medium hover:text-accent" href={`/admin/collections/${c.id}`}>{pickName(c, locale, config.defaultLocale)}</a></td>
              <td className={`${ui.td} font-mono text-xs`}>/{c.basePath}</td>
              <td className={ui.td}>{counts.find((n) => n.collectionId === c.id)?._count ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className={`${ui.card} space-y-4`}>
        <h2 className="text-lg font-semibold">{t("collections.add")}</h2>
        <ActionForm action={createCollection} submitLabel={t("action.create")}>
          <Select name="preset" label={t("collections.preset")} help={t("collections.presetHelp")}
            options={[...PRESETS.map((p) => ({ value: p.id, label: presetName(p, locale) })), { value: "blank", label: t("collections.blank") }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="key" label={t("collections.key")} required help={t("collections.keyHelp")} />
            <TextField name="basePath" label={t("collections.basePath")} help={t("collections.basePathHelp")} />
          </div>
          <TextField name="name" label={t("field.name")} required />
        </ActionForm>
      </section>
    </div>
  );
}
