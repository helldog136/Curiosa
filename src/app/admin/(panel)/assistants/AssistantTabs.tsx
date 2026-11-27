import { ASSISTANT_TABS, assistantsTabHref, type AssistantTab } from "@/core/services/mcp/assistantsLinks";
import type { Translator } from "@/core/i18n/dictionary";
import { LinkTabs } from "@/components/admin/LinkTabs";

/** The page views as links (the tab is in the address: it can be shared and survives a reload). The shared `LinkTabs` brick draws them and marks the open one with `aria-current`. */
export function AssistantTabs({ t, current, pending }: { t: Translator; current: AssistantTab; pending: number }) {
  return (
    <LinkTabs
      testid="assistants-tabs" label={t("assistants.tabs.label")} current={current}
      tabs={ASSISTANT_TABS.map((tab) => ({ id: tab, href: assistantsTabHref(tab), label: t(`assistants.tab.${tab}`), ...(tab === "requests" ? { count: pending, countLabel: t("nav.badge.ai") } : {}) }))}
    />
  );
}
