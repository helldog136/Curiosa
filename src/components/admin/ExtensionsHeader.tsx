import type { Translator } from "@/core/i18n/dictionary";
import { FeatureTabs, featureTabProps, type FeatureTab } from "./FeatureTabs";
import { HelpTip } from "./HelpTip";
import { PageHeader } from "./Page";

/** Haut de chaque vue d'Extensions : le même titre et les trois onglets (Installées, Ajouter, Mises à jour), l'onglet ouvert en évidence. */
export function ExtensionsHeader({ t, advanced, isOwner, current, intro, tip }: { t: Translator; advanced: boolean; isOwner: boolean; current: FeatureTab; /** One short line (R1). Nothing when the tab name already says it. */ intro?: React.ReactNode; /** What does not fit in the line goes in the « ? » bubble (R32). */ tip?: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.extensions")} icon="🧩" intro={intro ? <IntroTip intro={intro} tip={tip} name={t("nav.extensions")} /> : undefined} />
      <FeatureTabs current={current} {...featureTabProps(t, advanced, isOwner)} />
    </div>
  );
}

/**
 * The page intro with its "?" bubble: the bubble is glued to the LAST word of the line (non-breaking space, no wrap), so on a narrow screen it never wraps alone onto its own line.
 */
function IntroTip({ intro, tip, name }: { intro: React.ReactNode; tip?: string; name: string }) {
  if (!tip) return <>{intro}</>;
  if (typeof intro !== "string") return <>{intro}{" "}<span className="whitespace-nowrap"><HelpTip always help={tip} name={name} /></span></>;
  const at = intro.lastIndexOf(" ");
  return <>{at < 0 ? "" : `${intro.slice(0, at)} `}<span className="whitespace-nowrap">{intro.slice(at + 1)}{"\u00a0"}<HelpTip always help={tip} name={name} /></span></>;
}
