import type { Translator } from "@/core/i18n/dictionary";
import { HOME_MENU_TAB_HREFS } from "@/core/adminLinks";
import { LinkTabs, type LinkTab } from "./LinkTabs";
import { HelpTip } from "./HelpTip";
import { PageHeader } from "./Page";

/** The tabs of the "Home and menu" entry, in display order. */
export type HomeMenuTab = keyof typeof HOME_MENU_TAB_HREFS;
export const HOME_MENU_TABS: readonly HomeMenuTab[] = ["home", "menu", "header", "social"];

/**
 * Top of every page of the "Home and menu" entry: the title and the tabs (Home, Menu, Link and button, Social buttons), then ONE line that says what the current
 * tab is for (R1) with, when there is one, a "?" bubble for the longer explanation (R32). The tab name is the heading of the page below the tabs, kept for screen
 * readers only (it is already on the current tab). Each tab is a page that keeps its own address. The tabs are links, not client tabs: the home builder, the menu
 * editor and the social catalogue are heavy, and client tabs would render all of them on every visit.
 */
export function HomeMenuHeader({ t, current, purpose, more }: { t: Translator; current: HomeMenuTab; /** The one line that says what this tab is for. */ purpose: string; /** A longer precision, shown in a "?" bubble only. */ more?: string }) {
  const tabs: LinkTab[] = HOME_MENU_TABS.map((id) => ({ id, href: HOME_MENU_TAB_HREFS[id], label: t(`homemenu.tab.${id}`) }));
  return (
    <div className="space-y-4" data-testid="homemenu-header">
      <PageHeader title={t("nav.homeMenu")} />
      <LinkTabs tabs={tabs} current={current} label={t("homemenu.tabs.label")} testid="homemenu-tabs" />
      <div>
        <h2 className="sr-only">{t(`homemenu.tab.${current}`)}</h2>
        <p className="flex items-center gap-1.5 text-[15px] leading-6 text-muted" data-testid="homemenu-purpose">{purpose}{more && <HelpTip help={more} name={t(`homemenu.tab.${current}`)} always />}</p>
      </div>
    </div>
  );
}
