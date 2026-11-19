import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { isOwner } from "@/core/permissions";
import { CREDIT_URL } from "@/core/credit";
import { adminBugReportUrl } from "@/core/bugReport";
import { REQUEST_NOTICES, newAccessHref, parseTab } from "@/core/services/mcp/assistantsLinks";
import { maintenanceSummary } from "@/core/maintenance/summary";
import { markSeen } from "@/core/maintenance/settings";
import { accessesWithFullPowers } from "@/core/services/mcp/fullPowers";
import { accessHref } from "@/core/services/mcp/assistantsLinks";
import { HelpTip } from "@/components/admin/HelpTip";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { turnOffFullPowersAction } from "./fullPowersActions";
import { BugReportLink } from "@/components/admin/BugReportLink";
import { PageHeader } from "@/components/admin/Page";
import { AccessTab } from "./AccessTab";
import { AssistantTabs } from "./AssistantTabs";
import { HistoryTab } from "./HistoryTab";
import { RequestsTab } from "./RequestsTab";

export const dynamic = "force-dynamic";

/**
 * Assistants IA : l'unique page pour laisser une IA lire ou gérer le site (remplace « API & MCP » et « Maintenance par IA »).
 * Trois vues : Réglages (commun à tous), Demandes à valider, Historique. Les assistants eux-mêmes (liste, ajout, retrait) sont dans l'Équipe ; la fiche de chacun
 * (droits par outil, approbations) reste ici, à /admin/assistants/<id>. Propriétaire et coordination technique seulement.
 * Les réglages techniques (adresse du serveur, liste des actions, consignes par outil) n'apparaissent qu'en mode avancé.
 */
export default async function AssistantsPage({ searchParams }: { searchParams: Promise<{ tab?: string; notice?: string; profile?: string }> }) {
  const { t, locale, config, advanced, user } = await adminCtx({ right: "core:mcp.tokens" });
  const query = await searchParams;
  const tab = parseTab(query.tab);
  // Ancien lien « ajouter un assistant d'entretien » : le formulaire est maintenant dans l'Équipe.
  if (tab === "access" && query.profile === "maintenance") redirect(newAccessHref(true));
  const notice = REQUEST_NOTICES.find((n) => n === query.notice);
  const [{ pending }, bugUrl, fullPowers] = await Promise.all([maintenanceSummary(), adminBugReportUrl(t), accessesWithFullPowers()]);
  const owner = isOwner(user);
  // Voir les demandes ou l'historique = avoir vu ce que les IA ont fait : la pastille du menu repart de zéro (les demandes en attente, elles, restent).
  if (tab !== "access") await markSeen();

  return (
    <div className="space-y-8">
      <PageHeader
        icon="🤖"
        title={<>{t("assistants.title")}{advanced && <span className="ml-3 text-lg font-normal text-muted" data-testid="assistants-subtitle">{t("assistants.subtitle")}</span>}</>}
        intro={t("assistants.intro")}
      />
      {fullPowers.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-danger/50 bg-danger/10 p-3.5 text-sm" data-testid="fullpowers-banner">
          <span className={ui.chipDanger}>{t("fullpowers.chip")}</span>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {fullPowers.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2" data-testid="fullpowers-banner-item">
                <a href={accessHref(a.id)} className="font-medium underline underline-offset-2">{a.name}</a>
                {owner && <form action={turnOffFullPowersAction.bind(null, a.id)}><PendingButton testid="fullpowers-banner-off">{t("fullpowers.turnOff")}<span className="sr-only"> {a.name}</span></PendingButton></form>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <AssistantTabs t={t} current={tab} pending={pending} />
      {tab === "access" && <AccessTab t={t} locale={locale} advanced={advanced} owner={isOwner(user)} />}
      {tab === "requests" && <RequestsTab t={t} locale={locale} defaultLocale={config.defaultLocale} notice={notice} />}
      {tab === "history" && <HistoryTab t={t} locale={locale} defaultLocale={config.defaultLocale} advanced={advanced} />}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <a href={`${CREDIT_URL}/blob/HEAD/docs/MAINTENANCE-IA.md`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent" data-testid="ai-guide-link">📄 {t("aim.guide")} ↗</a>
        <HelpTip always help={t("aim.guideHelp")} name={t("aim.guide")} />
        <BugReportLink href={bugUrl} className="underline underline-offset-2 hover:text-accent">🐞 {t("bugReport.link")} ↗</BugReportLink>
      </p>
    </div>
  );
}
