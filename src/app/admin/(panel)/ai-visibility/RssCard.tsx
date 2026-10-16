import { ActionForm } from "@/components/admin/ActionForm";
import { CopyBlock } from "@/components/admin/CopyBlock";
import { Checkbox } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import type { FeedOverview } from "@/core/feeds";
import { saveFeedLink } from "./actions";

/**
 * Bloc « Flux RSS » : l'adresse à donner aux lecteurs, ce que contient le flux et d'où cela vient.
 * Mode simple : l'explication, l'adresse, le nombre d'éléments, les 5 derniers et la case du pied de page.
 * Mode avancé : en plus, les flux par fonctionnalité et par rubrique, et les options des adresses.
 */
export function RssCard({ overview, hasSource, linkEnabled, advanced, t, locale }: { overview: FeedOverview; hasSource: boolean; linkEnabled: boolean; advanced: boolean; t: Translator; locale: string }) {
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <section id="rss" aria-labelledby="rss-title" className={`${ui.card} scroll-mt-6 space-y-5`} data-testid="rss-card">
      <div>
        <h2 id="rss-title" className="text-xl font-semibold">{t("rss.title")}</h2>
        <p className={ui.help}>{t("rss.intro")}</p>
      </div>

      <p className="text-[15px] font-medium" role="status" data-testid="rss-count">
        {!hasSource ? t("rss.noSource") : overview.count > 0 ? t("rss.count", { n: overview.count }) : t("rss.countNone")}
      </p>

      <div className="space-y-2">
        <CopyBlock label={t("rss.address")} text={overview.url} copyLabel={t("rss.copy")} copiedLabel={t("rss.copied")} />
        <a href={overview.url} target="_blank" rel="noopener" className={ui.btn}>{t("rss.open")}</a>
        <p className={ui.help}>{t("rss.only")}</p>
      </div>

      <div>
        <h3 className="font-semibold">{t("rss.latest")}</h3>
        {overview.latest.length === 0 ? (
          <p className={ui.help}>{t("rss.latestNone")}</p>
        ) : (
          <ol className="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="rss-latest">
            {overview.latest.map((i) => (
              <li key={i.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <a href={i.link} target="_blank" rel="noopener" className="min-w-0 [overflow-wrap:anywhere] text-[15px] hover:text-accent hover:underline">{i.title}</a>
                <span className="shrink-0 text-xs text-muted">{i.publishedAt ? fmt.format(i.publishedAt) : t("rss.noDate")}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <ActionForm action={saveFeedLink} submitLabel={t("action.save")} secondary className="space-y-3">
        <Checkbox name="feedLink" label={t("rss.link.label")} help={t("rss.link.help")} defaultChecked={linkEnabled} />
        {!linkEnabled ? <p className={ui.help} data-testid="rss-link-state">{t("rss.link.hidden")}</p> : !hasSource ? <p className={ui.help} data-testid="rss-link-state">{t("rss.link.idle")}</p> : null}
      </ActionForm>

      {advanced && (
        <div className="space-y-5 border-t border-line pt-5" data-testid="rss-advanced">
          <div>
            <h3 className="font-semibold">{t("rss.sources")}</h3>
            <p className={ui.help}>{t("rss.sources.help")}</p>
            <ul className="mt-3 space-y-3">
              {overview.sources.map((s) => (
                <li key={s.key} className="space-y-1.5">
                  <p className="text-[15px]">
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-xs text-muted">· <code>{s.module}</code> · {s.kind === "entries" ? t("rss.sources.entries") : t("rss.sources.items")} · {t("rss.sources.n", { n: s.count })}</span>
                  </p>
                  <CopyBlock text={s.url} copyLabel={t("rss.copy")} copiedLabel={t("rss.copied")} />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold">{t("rss.topics")}</h3>
            <p className={ui.help}>{t("rss.topics.help")}</p>
            {overview.topics.length === 0 ? (
              <p className={ui.help}>{t("rss.topics.none")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {overview.topics.map((tp) => (
                  <li key={tp.id} className="space-y-1.5">
                    <p className="text-[15px]">
                      <span className="font-medium">{tp.label}</span>{" "}
                      <span className="text-xs text-muted">· {t("rss.sources.n", { n: tp.count })} · {t("rss.topics.from", { names: tp.names.join(", ") })}</span>
                    </p>
                    <CopyBlock text={tp.url} copyLabel={t("rss.copy")} copiedLabel={t("rss.copied")} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="font-semibold">{t("rss.options")}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5 text-muted">
              {(["lang", "topics", "limit", "cache", "catalogue"] as const).map((k) => <li key={k}>{t(`rss.options.${k}`)}</li>)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
