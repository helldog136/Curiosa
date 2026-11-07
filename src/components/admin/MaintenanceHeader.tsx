import type { Translator } from "@/core/i18n/dictionary";
import type { Level } from "@/core/auth/rights";
import { MAINTENANCE_TAB_HREFS } from "@/core/adminLinks";
import { maintenanceTabs, type MaintenanceTab } from "@/core/modules/adminMenu";
import { legacyUpkeepSummary } from "@/core/modules/legacyUpkeep";
import { getUpdateCheck } from "@/core/updates/service";
import { LinkTabs, type LinkTab } from "./LinkTabs";
import { PageHeader } from "./Page";

/**
 * Haut de chaque page de l'entrée « Entretien » : le titre, une phrase, et les onglets (Contrôle du site, Sauvegarde, Mises à jour, Restes, Journal d'activité).
 * Chaque onglet est une page qui garde sa propre adresse ; la barre ne montre que ce que la personne a le droit d'ouvrir (maintenanceTabs).
 * L'onglet de la page ouverte est toujours présent, même si le mode ou le droit ne le proposerait pas (adresse ouverte à la main).
 */
export async function MaintenanceHeader({ t, level, advanced, current }: { t: Translator; level: Level; advanced: boolean; current: MaintenanceTab }) {
  const visible = maintenanceTabs({ role: level, advanced });
  const ids = (["health", "backup", "updates", "upkeep", "audit"] as const).filter((id) => id === current || visible.includes(id));
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
      <PageHeader title={t("nav.maintenance")} icon="🛠️" intro={t("maint.intro")} />
      <LinkTabs tabs={tabs} current={current} label={t("maint.tabs.label")} testid="maintenance-tabs" />
    </div>
  );
}
