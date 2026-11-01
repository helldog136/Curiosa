import type { Translator } from "@/core/i18n/dictionary";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF, EXTENSIONS_UPDATES_HREF } from "@/core/modules/extensionsLinks";
import { peekModulesReport } from "@/core/modules/updateStatus";

/**
 * Onglets de la page Extensions : ce qui est installé, de quoi en ajouter (le catalogue) et les mises à jour des modules. Pour l'utilisateur
 * c'est un seul endroit, avec une seule entrée dans le menu. Chaque onglet a son adresse (voir extensionsLinks.ts).
 */
export type FeatureTab = "installed" | "add" | "updates";
export const FEATURE_TAB_HREFS: Record<FeatureTab, string> = { installed: EXTENSIONS_HREF, add: EXTENSIONS_ADD_HREF, updates: EXTENSIONS_UPDATES_HREF };

export function FeatureTabs({ current, labels, behind = 0, behindLabel }: { current: FeatureTab; labels: { installed: string; add: string; updates?: string }; /** Modules en retard : compteur dans l'onglet « Mises à jour ». */ behind?: number; behindLabel?: string }) {
  const tab = (id: FeatureTab, label: string, count = 0) => (
    <a key={id} href={FEATURE_TAB_HREFS[id]} aria-current={current === id ? "page" : undefined}
      className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${current === id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
      {label}
      {count > 0 && <span data-testid="tab-badge" title={behindLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{count}<span className="sr-only"> {behindLabel}</span></span>}
    </a>
  );
  return (
    <nav aria-label={labels.installed} className="flex gap-1 overflow-x-auto border-b border-line" data-testid="feature-tabs">
      {tab("installed", labels.installed)}
      {tab("add", labels.add)}
      {labels.updates && tab("updates", labels.updates, behind)}
    </nav>
  );
}

/** Libellés des trois onglets (mode simple : sans jargon) et compteur de modules en retard, lu sans réseau (le même que la pastille du menu). L'onglet « Mises à jour » est réservé au propriétaire. */
export function featureTabProps(t: Translator, advanced: boolean, isOwner: boolean) {
  const behind = isOwner ? (peekModulesReport()?.outdated.length ?? 0) : 0;
  return {
    labels: { installed: t(advanced ? "hub.tab.installed" : "hub.tab.installed.simple"), add: t(advanced ? "hub.tab.catalogue" : "hub.tab.catalogue.simple"), updates: isOwner ? t("hub.tab.updates") : undefined },
    behind,
    behindLabel: t("hub.tab.updatesBehind", { n: behind }),
  };
}
