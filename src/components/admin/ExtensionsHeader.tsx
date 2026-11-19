import type { Translator } from "@/core/i18n/dictionary";
import { FeatureTabs, featureTabProps, type FeatureTab } from "./FeatureTabs";
import { HelpTip } from "./HelpTip";
import { PageHeader } from "./Page";

/** Haut de chaque vue d'Extensions : le même titre et les trois onglets (Installées, Ajouter, Mises à jour), l'onglet ouvert en évidence. */
export function ExtensionsHeader({ t, advanced, isOwner, current, intro, tip }: { t: Translator; advanced: boolean; isOwner: boolean; current: FeatureTab; /** One short line (R1). Nothing when the tab name already says it. */ intro?: React.ReactNode; /** What does not fit in the line goes in the « ? » bubble (R32). */ tip?: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.extensions")} icon="🧩" intro={intro ? <>{intro}{tip && <> <HelpTip always help={tip} name={t("nav.extensions")} /></>}</> : undefined} />
      <FeatureTabs current={current} {...featureTabProps(t, advanced, isOwner)} />
    </div>
  );
}
