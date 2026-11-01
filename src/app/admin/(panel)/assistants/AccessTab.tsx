import { siteUrl } from "@/core/config";
import { listMcpTools } from "@/core/platform";
import { TEAM_HREF } from "@/core/services/mcp/assistantsLinks";
import { isMcpEnabled } from "@/core/services/mcp/tokens";
import type { Translator } from "@/core/i18n/dictionary";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { GUIDE_KEYS, McpConnectGuide, type GuideTexts } from "@/components/admin/McpConnectGuide";
import { Callout, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { setMcpEnabled } from "./actions";
import { PendingButton } from "@/components/admin/PendingButton";

/**
 * Onglet « Réglages » : ce qui est commun à tous les assistants IA (les mettre tous en pause, détails techniques en mode avancé).
 * Les assistants eux-mêmes — liste, ajout, retrait, droits — sont dans l'Équipe, avec les personnes.
 */
export async function AccessTab({ t, advanced }: { t: Translator; advanced: boolean }) {
  const enabled = await isMcpEnabled();
  const guide = Object.fromEntries(GUIDE_KEYS.map((k) => [k, t(k)])) as GuideTexts;

  return (
    <div className="space-y-8" data-testid="assistants-access">
      {!enabled && (
        <Callout tone="warn" testid="assistants-off">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span><strong>{t("assistants.off.title")}</strong> {t("assistants.off.help")}</span>
            <form action={setMcpEnabled.bind(null, true)}><PendingButton variant="primary">{t("assistants.off.resume")}</PendingButton></form>
          </span>
        </Callout>
      )}

      <Panel title={t("team.ai.where.title")} help={t("team.ai.where.help")} testid="assistants-where">
        <a href={TEAM_HREF} className={`${ui.btnPrimary} self-start`} data-testid="assistants-open-team">{t("team.ai.where.open")}</a>
      </Panel>

      <Panel title={t("assistants.master.title")} testid="assistants-master">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-medium"><span className={enabled ? ui.chipOk : ui.chipWarn}>{t(enabled ? "assistants.master.onChip" : "assistants.master.offChip")}</span>{t(enabled ? "assistants.master.on" : "assistants.master.off")}</p>
          <form action={setMcpEnabled.bind(null, !enabled)}>
            {enabled ? <ConfirmButton message={t("assistants.master.confirm")}>{t("assistants.master.suspend")}</ConfirmButton> : <PendingButton variant="primary">{t("assistants.off.resume")}</PendingButton>}
          </form>
        </div>
      </Panel>

      {advanced && (
        <Panel title={t("assistants.tech.title")} help={t("assistants.tech.help")} testid="assistants-tech">
          <p className="text-sm">{t("mcp.endpoint")} : <code className="select-all break-all rounded bg-line px-1.5 py-0.5 font-mono text-[13px]">{siteUrl}/api/mcp</code></p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">{t("mcp.safetyTitle")}</summary>
            <p className="mt-2 leading-6 text-muted">{t("mcp.safety")}</p>
          </details>
          <details className="rounded-xl border border-line bg-bg p-4" data-testid="mcp-connect">
            <summary className="cursor-pointer text-[15px] font-semibold">{t("mcp.connect.title")}</summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm leading-6 text-muted">{t("mcp.connect.intro")}</p>
              <McpConnectGuide texts={guide} baseUrl={siteUrl} advanced={advanced} />
            </div>
          </details>
          {enabled && <ToolsList t={t} />}
        </Panel>
      )}
    </div>
  );
}

/** La liste des actions que les modules proposent aux assistants (mode avancé). */
async function ToolsList({ t }: { t: Translator }) {
  const tools = await listMcpTools();
  return (
    <details className="rounded-xl border border-line bg-bg p-4">
      <summary className="cursor-pointer text-[15px] font-semibold">{t("mcp.tools")} ({tools.length})</summary>
      <p className="mt-2 text-sm text-muted">{t("mcp.toolsHelp")}</p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
        {tools.map((tool) => (
          <li key={tool.name} className="space-y-0.5 px-4 py-3 text-sm">
            <p className="break-all"><span className="font-mono">{tool.name}</span> <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tool.readOnly ? "bg-surface" : "bg-amber-500/20"}`}>{tool.readOnly ? t("mcp.scope.read") : t("mcp.scope.write")}</span></p>
            <p className="text-muted">{tool.description}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
