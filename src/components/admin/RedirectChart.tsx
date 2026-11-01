import type { RedirectStats } from "@/core/redirectStats";
import { ui } from "./ui";

type Labels = { today: string; week: string; month: string; total: string; summary: string; table: string; day: string; hits: string; none: string; max: string };

/**
 * Les passages d'un lien court : quatre chiffres (aujourd'hui, 7 jours, 30 jours, total) et un petit graphique en barres des 30 derniers jours.
 * Accessible : le graphique est une image décrite par une phrase (texte), et les mêmes chiffres jour par jour sont dans un tableau repliable ; la couleur ne porte rien seule.
 */
export function RedirectChart({ stats, labels, format }: { stats: RedirectStats; labels: Labels; format: (day: string) => string }) {
  const max = Math.max(1, ...stats.series.map((d) => d.hits));
  const empty = stats.month === 0;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["today", stats.today], ["week", stats.week], ["month", stats.month], ["total", stats.total]] as const).map(([k, n]) => (
          <div key={k} className="rounded-xl border border-line bg-bg p-3">
            <dt className="text-[13px] text-muted">{labels[k]}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      {empty ? <p className="text-sm text-muted">{labels.none}</p> : (
        <figure className="space-y-1.5">
          <div role="img" aria-label={labels.summary} className="flex h-28 items-end gap-[2px] border-b border-line" data-testid="redirect-chart">
            {stats.series.map((d) => (
              <div key={d.day} className="flex h-full flex-1 items-end" title={`${format(d.day)} : ${d.hits}`}>
                <div className={d.hits > 0 ? "w-full rounded-t-sm bg-accent" : "w-full bg-line"} style={{ height: d.hits > 0 ? `${Math.max(4, Math.round((d.hits / max) * 100))}%` : "2px" }} />
              </div>
            ))}
          </div>
          <figcaption className="flex justify-between text-xs text-muted"><span>{format(stats.series[0]!.day)}</span><span>{labels.max.replace("{n}", String(max))}</span><span>{format(stats.series[29]!.day)}</span></figcaption>
        </figure>
      )}
      {!empty && (
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">{labels.table}</summary>
          <div className="relative mt-3 overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className={ui.th}>{labels.day}</th><th className={`${ui.th} text-right`}>{labels.hits}</th></tr></thead>
            <tbody>
              {[...stats.series].reverse().filter((d) => d.hits > 0).map((d) => (
                <tr key={d.day} className="border-t border-line"><td className="px-3 py-1.5">{format(d.day)}</td><td className="px-3 py-1.5 text-right tabular-nums">{d.hits}</td></tr>
              ))}
            </tbody>
          </table></div>
        </details>
      )}
    </div>
  );
}
