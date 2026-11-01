import { prisma } from "@/core/db";
import { listMcpToolCatalogue } from "@/core/platform";
import { canUse, parseGrants } from "@/core/services/mcp/access";
import { abilities, accessState, splitAccesses } from "@/core/services/mcp/accessView";
import { accessHref, assistantsTabHref } from "@/core/services/mcp/assistantsLinks";
import { assistantFlags, assistantHistoryHref, lastActivity, memberFilter, summarizeRights } from "@/core/services/mcp/teamView";
import { isMcpEnabled } from "@/core/services/mcp/tokens";
import { listRequests } from "@/core/maintenance/requests";
import type { Translator } from "@/core/i18n/dictionary";
import { Badge } from "@/components/admin/Badge";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { RowMenu } from "@/components/admin/RowMenu";
import type { TableRow } from "@/components/admin/RowTable";
import { ui } from "@/components/admin/ui";
import { revokeTokenAction } from "../assistants/actions";

/**
 * Les assistants IA, mis en forme comme des lignes de l'Équipe (même tableau que les personnes, voir RowTable). La présentation est celle des personnes ;
 * le modèle reste celui des accès (jeton, plafond, actions accordées) : ni rôle, ni mot de passe, ni double vérification. Aucun secret n'est lu ni affiché ici.
 * Réservé à qui détient `core:mcp.tokens` (le contrôle est fait par la page ET par les actions, qui le revérifient).
 */
export async function assistantMembers({ t, locale, canHistory }: { t: Translator; locale: string; canHistory: boolean }) {
  const now = new Date();
  const [enabled, rows, catalogue, requests] = await Promise.all([isMcpEnabled(), prisma.apiToken.findMany({ orderBy: { createdAt: "asc" } }), listMcpToolCatalogue(), listRequests()]);
  const { active, inactive } = splitAccesses(rows, now);
  // Dernière activité : la plus récente entre l'usage de l'accès et une ligne du Journal central signée de son nom (une seule requête groupée, aucun minuteur).
  const journal = active.length === 0 ? [] : await prisma.auditLog.groupBy({ by: ["actor"], where: { actor: { in: active.map((k) => `mcp:${k.name}`) } }, _max: { createdAt: true } });
  const journalAt = new Map(journal.map((j) => [j.actor, j._max.createdAt]));
  const pending = new Map<string, number>();
  for (const r of requests) if (r.status === "pending") pending.set(r.tokenId, (pending.get(r.tokenId) ?? 0) + 1);
  const date = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  const tableRows: TableRow[] = active.map((k) => {
    const token = { scope: k.scope === "write" ? ("write" as const) : ("read" as const), grants: parseGrants(k.grants) };
    const can = abilities(catalogue.filter((x) => !x.instanceOptedOut && canUse(x, token)).map((x) => ({ readOnly: x.readOnly, destructive: x.destructive, source: x.source })));
    const summary = summarizeRights(can);
    const rightsText = [t(`team.rights.${summary.level}`), summary.canDelete && t("team.rights.delete")].filter(Boolean).join(" · ");
    const seenAt = lastActivity(k.lastUsedAt, journalAt.get(`mcp:${k.name}`));
    const waiting = pending.get(k.id) ?? 0;
    const flags = assistantFlags({ enabled, pending: waiting, lastActivity: seenAt });
    const historyHref = canHistory ? assistantHistoryHref(k.name) : assistantsTabHref("history");
    return {
      key: `ai:${k.id}`,
      testid: "assistant-row",
      search: [k.name, t("team.type.assistant"), rightsText, ...flags.map((f) => t(`team.flag.${f}`))],
      filters: { who: memberFilter("assistant") },
      titles: { person: k.name, role: can.map((a) => t(`assistants.can.${a}`)).join(" ") },
      cells: {
        person: <>
          <span className="block truncate font-medium">{k.name}</span>
          <span className="block truncate text-muted">{t("team.ai.added", { date: date(k.createdAt) })}</span>
        </>,
        type: <Badge tone="accent" testid="member-type">{t("team.type.assistant")}</Badge>,
        role: <span data-testid="assistant-rights" className="block">{rightsText}</span>,
        state: flags.length === 0 ? null : (
          <span className="flex flex-wrap gap-1.5" data-testid="assistant-flags">
            {flags.includes("paused") && <span className={ui.chipWarn}>{t("team.flag.paused")}</span>}
            {flags.includes("waiting") && <a href={assistantsTabHref("requests")} className={`${ui.chipWarn} underline`}>{t("team.flag.waiting")}</a>}
            {flags.includes("neverUsed") && <span className={ui.chip}>{t("team.flag.neverUsed")}</span>}
          </span>
        ),
        seen: seenAt
          ? <>
              <time dateTime={seenAt.toISOString()} className="block whitespace-nowrap">{date(seenAt)}</time>
              <a href={historyHref} className="block truncate text-accent underline underline-offset-2" data-testid="assistant-history">{t("team.ai.history")}<span className="sr-only"> {k.name}</span></a>
            </>
          : <span className="text-muted">{t("team.ai.neverSeen")}</span>,
      },
      actions: (
        <>
          <a href={accessHref(k.id)} className={ui.btn} data-testid="assistant-settings">{t("team.ai.settings")}<span className="sr-only"> {k.name}</span></a>
          <RowMenu label={t("users.menu.open", { name: k.name })}>
            <form action={revokeTokenAction.bind(null, k.id)}><ConfirmButton menu message={t("assistants.revokeConfirm", { name: k.name })} confirmLabel={t("assistants.revoke")} dangerConfirm>{t("assistants.revoke")}</ConfirmButton></form>
          </RowMenu>
        </>
      ),
    };
  });

  const stopped = inactive.map((k) => ({
    id: k.id, name: k.name, lastUsedAt: k.lastUsedAt,
    state: accessState(k, now) === "revoked" && k.revokedAt ? t("assistants.state.revoked", { date: date(k.revokedAt) }) : t("assistants.state.expired"),
  }));
  return { enabled, rows: tableRows, stopped, waiting: [...pending.values()].reduce((a, b) => a + b, 0), count: active.length, date };
}
