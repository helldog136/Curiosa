import { prisma } from "@/core/db";
import { listAudit, CORE_ONLY, type AuditFilter } from "@/core/audit";
import { describeRows, type JournalLine } from "@/core/journal/describe";
import { JOURNAL_PAGE_SIZE, journalHref, parseJournalParams, toFilter } from "@/core/journal/query";
import type { Translator } from "@/core/i18n/dictionary";
import { moduleNames } from "@/core/modules/updateStatus";
import { EmptyState } from "./Page";
import { JournalFilters } from "./JournalFilters";
import { NoResults } from "./LiveSearch";
import { ui } from "./ui";

/** Couleur ET texte (R30, R28) : l'origine d'une ligne ne se lit jamais à la couleur seule. */
const KIND_STYLE = {
  person: "bg-sky-500/15 text-sky-800",
  module: "bg-accent/10 text-accent",
  assistant: "bg-violet-500/15 text-violet-800",
  system: "bg-line/60 text-fg",
} as const;
const KIND_ICON = { person: "👤", module: "🧩", assistant: "🤖", system: "⚙️" } as const;
const LEVEL_STYLE = { warn: ui.chipWarn, error: ui.chipDanger } as const;

type Sp = Record<string, string | string[] | undefined>;

/**
 * Le journal à l'écran : filtres, nombre d'événements, lignes lisibles (jamais de JSON), pagination. Partagé par la page « Journal d'audit » (toutes les extensions)
 * et l'onglet « Historique » d'une extension (`moduleId` fixé : le filtre d'extension disparaît). Composant serveur : la liste est paginée par le serveur et la
 * recherche l'interroge (voir JournalFilters).
 */
export async function JournalView({ t, locale, defaultLocale, advanced, sp, path, prefix = "", moduleId, pageSize = JOURNAL_PAGE_SIZE, testid = "journal" }: {
  t: Translator; locale: string; defaultLocale: string; advanced: boolean; sp: Sp; path: string; prefix?: string; moduleId?: string; pageSize?: number; testid?: string;
}) {
  // Le filtre d'extension de la page globale ne propose que les extensions qui ont des lignes (plus « le site lui-même » quand il y en a).
  let moduleOptions: { value: string; label: string }[] | undefined;
  if (!moduleId) {
    const [present, names] = await Promise.all([prisma.auditLog.groupBy({ by: ["module"] }), moduleNames(locale, defaultLocale)]);
    const ids = present.map((r) => r.module);
    moduleOptions = [
      ...(ids.includes("") ? [{ value: CORE_ONLY, label: t("journal.module.core") }] : []),
      ...ids.filter(Boolean).map((id) => ({ value: id, label: names.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label, locale)),
    ];
  }
  const params = parseJournalParams(sp, prefix, moduleOptions ? moduleOptions.map((o) => o.value) : null);
  const filter: AuditFilter = { ...toFilter(params, moduleId ? { module: moduleId } : {}), pageSize };
  const { rows, total, page, pages } = await listAudit(filter);
  const lines = await describeRows(rows, { t, locale, defaultLocale });
  const filtered = Boolean(params.q || params.level || params.kind || params.period || (!moduleId && params.module));
  const href = (change: Parameters<typeof journalHref>[3]) => journalHref(path, sp, prefix, change);

  const options = (keys: readonly string[], base: string) => keys.map((k) => ({ value: k, label: t(`${base}.${k}`) }));
  return (
    <div className="space-y-5" data-testid={testid}>
      <JournalFilters
        prefix={prefix}
        initial={{ q: params.q, module: params.module, level: params.level, kind: params.kind, period: params.period }}
        modules={moduleOptions}
        levels={options(["info", "warn", "error"], "journal.level")}
        kinds={options(["person", "module", "assistant", "system"], "journal.kind")}
        periods={options(["day", "week", "month"], "journal.period")}
        labels={{
          search: t("journal.search"), clear: t("journal.clear"), busy: t("search.busy"),
          module: t("journal.module"), moduleAll: t("journal.module.all"), level: t("journal.level"), levelAll: t("journal.level.all"),
          kind: t("journal.kind"), kindAll: t("journal.kind.all"), period: t("journal.period"), periodAll: t("journal.period.all"),
        }}
      />
      {lines.length === 0 ? (
        filtered ? <NoResults message={t("journal.noResult.title")} clearLabel={t("journal.clear")} href={href({ q: "", module: "", level: "", kind: "", period: "" })} />
          : <EmptyState icon="📜" title={t("journal.empty.title")}>{moduleId ? t("journal.history.emptyHelp") : t("journal.empty")}</EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted" role="status">{t("journal.count", { n: total })}</p>
          <JournalTable lines={lines} t={t} locale={locale} advanced={advanced} showModule={!moduleId} />
        </>
      )}
      {pages > 1 && (
        <nav className="flex items-center gap-3 text-sm" aria-label={t("journal.pagination")}>
          {page > 1 ? <a className={`${ui.btn} min-h-11`} href={href({ page: page - 1 })} rel="prev">← {t("journal.previous")}</a> : <span />}
          <span>{t("journal.page", { page, pages })}</span>
          {page < pages && <a className={`${ui.btn} min-h-11`} href={href({ page: page + 1 })} rel="next">{t("journal.next")} →</a>}
        </nav>
      )}
    </div>
  );
}

/** Un seul tableau pour toutes les origines (R30) ; sur téléphone, chaque ligne devient une petite fiche (R27, pas de défilement horizontal). */
function JournalTable({ lines, t, locale, advanced, showModule }: { lines: JournalLine[]; t: Translator; locale: string; advanced: boolean; showModule: boolean }) {
  return (
    <table className="w-full" data-testid="journal-table">
      <thead className="max-md:sr-only">
        <tr>
          <th className={ui.th}>{t("journal.col.when")}</th>
          <th className={ui.th}>{t("journal.col.origin")}</th>
          <th className={ui.th}>{t("journal.col.who")}</th>
          <th className={ui.th}>{t("journal.col.what")}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-t border-line max-md:block max-md:space-y-1 max-md:py-3" data-kind={l.kind} data-level={l.level}>
            <td className={`${ui.td} whitespace-nowrap text-muted max-md:block max-md:px-0 max-md:py-0 md:w-44`}>{l.when.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</td>
            <td className={`${ui.td} max-md:inline-block max-md:px-0 max-md:py-0 md:w-40`}>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLE[l.kind]}`}><span aria-hidden>{KIND_ICON[l.kind]}</span>{t(`journal.kind.${l.kind}`)}</span>
            </td>
            <td className={`${ui.td} break-words max-md:inline-block max-md:px-2 max-md:py-0 md:max-w-56`}>{l.who}</td>
            <td className={`${ui.td} max-md:block max-md:px-0 max-md:py-0`}>
              <span className="flex flex-wrap items-center gap-2">
                {l.level !== "info" && <span className={LEVEL_STYLE[l.level]}>{t(`journal.level.${l.level}`)}</span>}
                <span>{l.sentence}</span>
              </span>
              {(l.target || (showModule && l.moduleName) || (advanced && l.code)) && (
                <span className="mt-0.5 block max-w-[60ch] truncate text-[13px] text-muted" title={[showModule ? l.moduleName : "", l.target, advanced ? l.code : ""].filter(Boolean).join(" · ")}>
                  {[showModule ? l.moduleName : "", l.target, advanced ? l.code : ""].filter(Boolean).join(" · ")}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
