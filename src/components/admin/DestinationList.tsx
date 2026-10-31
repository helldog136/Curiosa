import Link from "next/link";
import type { DestinationSummary } from "@/core/redirectGroups";
import { redirectShortUrl } from "@/core/redirects";
import { DestinationCurve } from "./DestinationCurve";
import { ui } from "./ui";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** La vue « Par destination » : un bloc par endroit visé (classé), ses quatre totaux, sa mini-courbe, puis la liste des liens courts qui y mènent. */
export function DestinationList({ summary, t, format }: { summary: DestinationSummary; t: T; format: (day: string) => string }) {
  const stateChip = { active: ui.chipOk, ended: ui.chipWarn, off: ui.chip } as const;
  if (summary.groups.length === 0) return <div className={`${ui.card} text-[15px]`}><p className="font-medium">{t("redirects.dest.empty")}</p></div>;
  return (
    <div className="space-y-4">
      {summary.linksTotal > summary.linksRead && <p role="status" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800">{t("redirects.dest.truncated", { read: summary.linksRead, total: summary.linksTotal })}</p>}
      <ol className="space-y-4" data-testid="destination-list">
        {summary.groups.map((g, i) => (
          <li key={g.key} className={`${ui.card} space-y-4 !p-4 sm:!p-5`} data-testid="destination-row">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted">{t("redirects.dest.rank", { rank: i + 1 })}</p>
              <p className="break-all text-[15px] font-semibold" data-testid="destination-address">{g.destination}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["today", g.today], ["week", g.week], ["month", g.month], ["total", g.total]] as const).map(([k, n]) => (
                <div key={k} className="rounded-xl border border-line bg-bg p-3">
                  <dt className="text-[13px] text-muted">{t(`redirects.stats.${k === "total" ? "totalAll" : k}`)}</dt>
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`destination-${k}`}>{n}</dd>
                </div>
              ))}
            </dl>
            <DestinationCurve series={g.series} format={format}
              labels={{
                alt: t("redirects.dest.curveAlt", { destination: g.destination, month: g.month, today: g.today, from: format(g.series[0]!.day), to: format(g.series[g.series.length - 1]!.day) }),
                table: t("redirects.stats.table"), day: t("redirects.stats.day"), hits: t("redirects.stats.hits"), none: t("redirects.stats.none"),
              }} />
            <div>
              <h3 className="text-sm font-semibold">{t("redirects.dest.aliases", { n: g.links.length })}</h3>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="destination-aliases">
                {g.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link href={`/admin/redirects/${l.id}`} className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere] hover:text-accent hover:underline" title={redirectShortUrl(l.path)}>/{l.path}</Link>
                      <span className={stateChip[l.state]}>{t(`redirects.state.${l.state}`)}</span>
                    </span>
                    <span className="text-sm text-muted tabular-nums">{t("redirects.dest.aliasLine", { today: l.today, month: l.month, total: l.total })}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      {summary.hidden > 0 && <p className={ui.help}>{t("redirects.dest.hidden", { n: summary.hidden })}</p>}
      <p className={ui.help}>{t("redirects.dest.privacy")}</p>
    </div>
  );
}
