import { adminCtx } from "@/core/admin";
import { CREDIT_URL } from "@/core/credit";
import { adminBugReportUrl } from "@/core/bugReport";
import { REQUEST_NOTICES, parseTab } from "@/core/services/mcp/assistantsLinks";
import { maintenanceSummary } from "@/core/maintenance/summary";
import { markSeen } from "@/core/maintenance/settings";
import { BugReportLink } from "@/components/admin/BugReportLink";
import { PageHeader } from "@/components/admin/Page";
import { AccessTab } from "./AccessTab";
import { AssistantTabs } from "./AssistantTabs";
import { HistoryTab } from "./HistoryTab";
import { RequestsTab } from "./RequestsTab";

export const dynamic = "force-dynamic";

/**
 * Assistants IA : l'unique page pour laisser une IA lire ou gérer le site (remplace « API & MCP » et « Maintenance par IA »).
 * Trois vues : Accès (qui est branché, avec quels droits), Demandes à valider, Historique. Propriétaire seulement.
 * Les réglages techniques (adresse du serveur, liste des actions, consignes par outil) n'apparaissent qu'en mode avancé.
 */
export default async function AssistantsPage({ searchParams }: { searchParams: Promise<{ tab?: string; notice?: string; profile?: string }> }) {
  const { t, locale, config, advanced } = await adminCtx({ right: "core:mcp.tokens" });
  const query = await searchParams;
  const tab = parseTab(query.tab);
  const notice = REQUEST_NOTICES.find((n) => n === query.notice);
  const [{ pending }, bugUrl] = await Promise.all([maintenanceSummary(), adminBugReportUrl(t)]);
  // Voir les demandes ou l'historique = avoir vu ce que les IA ont fait : la pastille du menu repart de zéro (les demandes en attente, elles, restent).
  if (tab !== "access") await markSeen();

  return (
    <div className="space-y-8">
      <PageHeader
        icon="🤖"
        title={<>{t("assistants.title")}{advanced && <span className="ml-3 text-lg font-normal text-muted" data-testid="assistants-subtitle">{t("assistants.subtitle")}</span>}</>}
        intro={t("assistants.intro")}
      />
      <AssistantTabs t={t} current={tab} pending={pending} />
      {tab === "access" && <AccessTab t={t} locale={locale} advanced={advanced} profile={query.profile} />}
      {tab === "requests" && <RequestsTab t={t} locale={locale} defaultLocale={config.defaultLocale} notice={notice} />}
      {tab === "history" && <HistoryTab t={t} locale={locale} defaultLocale={config.defaultLocale} advanced={advanced} />}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <a href={`${CREDIT_URL}/blob/HEAD/docs/MAINTENANCE-IA.md`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent" data-testid="ai-guide-link">📄 {t("aim.guide")} ↗</a>
        <span>{t("aim.guideHelp")}</span>
        <BugReportLink href={bugUrl} className="underline underline-offset-2 hover:text-accent">🐞 {t("bugReport.link")} ↗</BugReportLink>
      </p>
    </div>
  );
}
