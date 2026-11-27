import type { Translator } from "@/core/i18n/dictionary";
import type { Level } from "@/core/auth/rights";
import { MAINTENANCE_TAB_HREFS } from "@/core/adminLinks";
import { maintenanceTabs, type MaintenanceTab } from "@/core/modules/adminMenu";
import { legacyUpkeepSummary } from "@/core/modules/legacyUpkeep";
import { getUpdateCheck } from "@/core/updates/service";
import { LinkTabs, type LinkTab } from "./LinkTabs";
import { PageHeader } from "./Page";
import { ui } from "./ui";

/**
 * Haut de chaque page de l'entrée « Entretien » : le titre, une phrase, et les onglets (Contrôle du site, Sauvegarde, Mises à jour, Restes, Journal d'activité).
 * Chaque onglet est une page qui garde sa propre adresse ; la barre ne montre que ce que la personne a le droit d'ouvrir (maintenanceTabs).
 * La barre est la même sur les cinq pages : une page ouverte à la main que le mode n'affiche pas (le journal en mode simple) n'ajoute pas son onglet.
 */
export async function MaintenanceHeader({ t, level, advanced, current }: { t: Translator; level: Level; advanced: boolean; current: MaintenanceTab }) {
  const visible = maintenanceTabs({ role: level, advanced });
  // The same bar on the five pages: what this person may open, in one order. The page that is open never adds a tab of its own (it would make the bars differ).
  const ids = (["health", "backup", "updates", "upkeep", "audit"] as const).filter((id) => visible.includes(id));
  const updateAvailable = ids.includes("updates") && visible.includes("updates") && (await getUpdateCheck().catch(() => null))?.available === true;
  const todo = ids.includes("upkeep") && visible.includes("upkeep") ? ((await legacyUpkeepSummary().catch(() => null))?.todo ?? 0) : 0;
  const tabs: LinkTab[] = ids.map((id) => ({
    id,
    href: MAINTENANCE_TAB_HREFS[id],
    label: t(`maint.tab.${id}`),
    ...(id === "updates" && updateAvailable ? { count: 1, countLabel: t("nav.badge.update") } : {}),
    ...(id === "upkeep" && todo > 0 ? { count: todo, countLabel: t("nav.upkeep.todo") } : {}),
  }));
  return (
    <div className="space-y-4" data-testid="maintenance-header">
      <PageHeader title={t("nav.maintenance")} intro={t("maint.intro")} />
      <LinkTabs tabs={tabs} current={current} label={t("maint.tabs.label")} testid="maintenance-tabs" />
    </div>
  );
}

/**
 * The title and the one-line purpose of a tab of the Maintenance page. The tab bar above already names the page, so the heading is kept for screen readers only
 * (R33.7: a name is shown once); the sentence stays visible (R1).
 */
export function TabIntro({ title, intro }: { title: string; intro?: string }) {
  return (
    <div data-testid="maintenance-intro">
      <h2 className="sr-only">{title}</h2>
      {intro ? <p className={ui.pageIntro}>{intro}</p> : null}
    </div>
  );
}
