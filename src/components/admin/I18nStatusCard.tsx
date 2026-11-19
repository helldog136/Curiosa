import { Badge } from "./Badge";
import { LiveSearch } from "./LiveSearch";
import { MoreOptions } from "./MoreOptions";
import { ui } from "./ui";
import { searchText } from "@/core/adminkit/search";
import type { I18nStatus } from "@/core/i18n/status";
import type { Translator } from "@/core/i18n/dictionary";

export const TRANSLATING_GUIDE = "https://github.com/helldog136/Curiosa/blob/main/docs/TRANSLATING.md";

/**
 * The translation status in Settings > Languages (no page of its own): every language with its status ("official" or "community") and how complete its interface
 * and extensions are ("complete" or "partial: 82%"), then the installed extensions that miss an English or French text.
 */
export function I18nStatusCard({ status, t }: { status: I18nStatus; t: Translator }) {
  // An official language (English, French) below 100% is "incomplete"; "partial" is only for community languages, where it is allowed.
  const label = (percent: number, official: boolean) => t(official ? "i18n.incomplete" : "i18n.partial", { percent });
  const gaps = status.modules.filter((m) => m.errors > 0);
  return (
    <div className={`${ui.card} space-y-5`} data-testid="i18n-status">
      <h3 className="font-semibold">{t("i18n.title")}</h3>
      <ul className="divide-y divide-line">
        {status.languages.map((l) => (
          <li key={l.code} data-testid={`i18n-language-${l.code}`} className="grid min-h-11 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-x-6">
            <span className="min-w-0 font-medium">{l.name} <span className="text-sm font-normal text-muted">{l.code}</span></span>
            <span className="justify-self-end"><Badge tone={l.status === "official" ? "ok" : "info"}>{t(l.status === "official" ? "i18n.official" : "i18n.community")}</Badge></span>
            {/* R14: "complete" is the normal state and is not written on every row; only what is missing shows. */}
            <span className="text-sm sm:whitespace-nowrap">{l.interface.percent < 100 && <><span className="text-muted">{t("i18n.interface")}</span> {label(l.interface.percent, l.status === "official")}</>}</span>
            <span className="text-sm sm:whitespace-nowrap">{l.modules.percent < 100 && <><span className="text-muted">{t("i18n.extensions")}</span> {label(l.modules.percent, l.status === "official")}</>}</span>
          </li>
        ))}
      </ul>
      {gaps.length > 0 && (
        <MoreOptions title={t("i18n.gapsTitle", { n: gaps.length })} defaultOpen={gaps.length <= 5}>
          <LiveSearch scope="i18n" placeholder={t("i18n.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")} />
          <ul className="divide-y divide-line">
            {gaps.map((m) => (
              <li key={m.id} data-live-item="i18n" data-search={searchText([m.name, m.id])} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{m.name}</span>
                <Badge tone="warn">{t("i18n.missing", { n: m.errors })}</Badge>
              </li>
            ))}
          </ul>
        </MoreOptions>
      )}
      <p className="text-sm"><a className="font-medium text-accent hover:underline" href={TRANSLATING_GUIDE} target="_blank" rel="noreferrer" title={t("i18n.add")}>{t("i18n.addLink")} →</a></p>
    </div>
  );
}
