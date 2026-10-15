import { ASSISTANT_TABS, assistantsTabHref, type AssistantTab } from "@/core/services/mcp/assistantsLinks";
import type { Translator } from "@/core/i18n/dictionary";

/** Les trois vues de la page, sous forme de liens (l'onglet est dans l'adresse : on peut le partager, il survit à un rechargement). */
export function AssistantTabs({ t, current, pending }: { t: Translator; current: AssistantTab; pending: number }) {
  return (
    <nav aria-label={t("assistants.tabs.label")} className="flex flex-wrap gap-2 border-b border-line pb-3" data-testid="assistants-tabs">
      {ASSISTANT_TABS.map((tab) => {
        const here = tab === current;
        return (
          <a key={tab} href={assistantsTabHref(tab)} aria-current={here ? "page" : undefined} data-testid={`assistants-tab-${tab}`}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[15px] font-medium transition-colors ${here ? "bg-accent font-semibold text-accent-fg" : "border border-line bg-surface hover:border-accent hover:text-accent"}`}>
            {t(`assistants.tab.${tab}`)}
            {tab === "requests" && pending > 0 && (
              <span className={`min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5 ${here ? "bg-accent-fg text-accent" : "bg-accent text-accent-fg"}`}>{pending}<span className="sr-only"> {t("nav.badge.ai")}</span></span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
