import type { Translator } from "@/core/i18n/dictionary";
import { FeatureTabs, featureTabProps, type FeatureTab } from "./FeatureTabs";
import { PageHeader } from "./Page";

/** Haut de chaque vue d'Extensions : le même titre et les trois onglets (Installées, Ajouter, Mises à jour), l'onglet ouvert en évidence. */
export function ExtensionsHeader({ t, advanced, isOwner, current, intro }: { t: Translator; advanced: boolean; isOwner: boolean; current: FeatureTab; intro: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.extensions")} icon="🧩" intro={intro} />
      <FeatureTabs current={current} {...featureTabProps(t, advanced, isOwner)} />
    </div>
  );
}
