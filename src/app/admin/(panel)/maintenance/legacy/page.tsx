import { adminCtx } from "@/core/admin";
import { legacyReport } from "@/core/modules/legacyReport";
import { ActionForm } from "@/components/admin/ActionForm";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { EXTENSIONS_UPDATES_HREF } from "@/core/modules/extensionsLinks";
import { rerunLegacySweep } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Entretien (0.2.0) : ce qui reste à mettre à niveau après une mise à jour depuis une version plus ancienne du site. LECTURE SEULE (rapport d'héritage,
 * src/core/modules/legacyReport.ts), plus « Relancer » (le même balayage qu'au démarrage). Jamais la valeur d'un réglage : des nombres et des noms.
 */
export default async function LegacyPage() {
  const { t, locale } = await adminCtx("owner");
  const r = await legacyReport();
  const rows: { id: string; n: number; help: string; items: string[]; href?: string }[] = [
    { id: "sourceRows", n: r.totals.sourceRows, help: t("legacy.row.sourceRows.help"), items: r.sourceRows.map((m) => `${m.id} ${m.version}`), href: EXTENSIONS_UPDATES_HREF },
    { id: "switchedOff", n: r.totals.switchedOffModules + r.totals.switchedOffInstances, help: t("legacy.row.switchedOff.help"), items: [...r.switchedOff.modules, ...r.switchedOff.instances] },
    { id: "behind", n: r.totals.behind, help: t("legacy.row.behind.help"), items: r.behind.map((i) => `${i.key} (${i.from} → ${i.to})`) },
    { id: "failed", n: r.totals.failed, help: t("legacy.row.failed.help"), items: r.failed.map((i) => `${i.key} · ${t(`legacy.reason.${i.reason}`)}`) },
    { id: "newer", n: r.totals.newer, help: t("legacy.row.newer.help"), items: r.newer.map((i) => `${i.key} (${i.from} > ${i.to})`), href: EXTENSIONS_UPDATES_HREF },
    { id: "seedsMissing", n: r.totals.seedsMissing, help: t("legacy.row.seedsMissing.help"), items: r.seedsMissing.map((i) => i.key) },
    { id: "collections", n: r.totals.collections, help: t("legacy.row.collections.help"), items: r.collections.map((c) => `${c.key} · ${c.collection} (${c.count})`) },
    { id: "legacyValues", n: r.totals.legacyValues, help: t("legacy.row.legacyValues.help"), items: r.legacyValues.map((i) => `${i.key} · ${i.settings.join(", ")}`) },
    { id: "orphans", n: r.totals.orphans, help: t("legacy.row.orphans.help"), items: r.orphans.map((i) => `${i.key} · ${i.settings.join(", ")}`) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={t("legacy.title")} intro={t("legacy.intro")} />
      {r.marker ? (
        <Callout tone="ok" role="status" testid="legacy-done">{t("legacy.done", { date: new Date(r.marker.at).toLocaleString(locale), version: r.marker.version })}</Callout>
      ) : (
        <Callout tone="warn" role="status" testid="legacy-pending">{t("legacy.pending")}</Callout>
      )}
      {r.clean && <Callout tone="ok">{t("legacy.clean")}</Callout>}
      <Panel title={t("legacy.report")} help={t("legacy.report.help")}>
        <ul className="divide-y divide-line" data-testid="legacy-report">
          {rows.map((row) => (
            <li key={row.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{t(`legacy.row.${row.id}`)}</span>
                <span className={row.n ? "inline-flex rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700" : "inline-flex rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700"} data-testid={`legacy-count-${row.id}`}>{row.n}</span>
              </div>
              {row.n > 0 && (
                <>
                  <p className="text-sm leading-6 text-muted">{row.help}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {row.items.map((item) => <li key={item} className="break-all rounded-md bg-accent/5 px-2 py-0.5 font-mono text-xs">{item}</li>)}
                    {row.n > row.items.length && <li className="text-xs text-muted">{t("legacy.more", { n: row.n - row.items.length })}</li>}
                  </ul>
                  {row.href && <a href={row.href} className="text-sm text-accent underline">{t(`legacy.row.${row.id}.action`)}</a>}
                </>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={t("legacy.rerun")} help={t("legacy.rerun.help")}>
        <ActionForm action={rerunLegacySweep} submitLabel={t("legacy.rerun.button")} secondary className="space-y-2">{null}</ActionForm>
      </Panel>
    </div>
  );
}
