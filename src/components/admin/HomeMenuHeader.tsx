import type { Translator } from "@/core/i18n/dictionary";
import { HOME_MENU_TAB_HREFS } from "@/core/adminLinks";
import { LinkTabs, type LinkTab } from "./LinkTabs";
import { PageHeader } from "./Page";

/** The tabs of the "Home and menu" entry, in display order. */
export type HomeMenuTab = keyof typeof HOME_MENU_TAB_HREFS;
export const HOME_MENU_TABS: readonly HomeMenuTab[] = ["home", "menu", "header", "social"];

/**
 * Top of every page of the "Home and menu" entry: the title, one sentence, and the tabs (Home, Menu, Link and button, Social buttons).
 * Each tab is a page that keeps its own address. The tabs are links, not client tabs: the home builder, the menu editor and the
 * social catalogue are heavy, and client tabs would render all of them on every visit.
 */
export function HomeMenuHeader({ t, current }: { t: Translator; current: HomeMenuTab }) {
  const tabs: LinkTab[] = HOME_MENU_TABS.map((id) => ({ id, href: HOME_MENU_TAB_HREFS[id], label: t(`homemenu.tab.${id}`) }));
  return (
    <div className="space-y-4" data-testid="homemenu-header">
      <PageHeader title={t("nav.homeMenu")} icon="🏠" intro={t("homemenu.intro")} />
      <LinkTabs tabs={tabs} current={current} label={t("homemenu.tabs.label")} testid="homemenu-tabs" />
    </div>
  );
}
