import { prisma } from "@/core/db";
import type { Translator } from "@/core/i18n/dictionary";
import { sweepOrphanedAccesses } from "@/core/personalAi/lifecycle";
import { levelOfRow } from "@/core/personalAi/service";
import { resolvePersonalOwner } from "@/core/personalAi/owner";
import { Badge } from "@/components/admin/Badge";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { EmptyState, Panel } from "@/components/admin/Page";
import { PendingButton } from "@/components/admin/PendingButton";
import { RowMenu } from "@/components/admin/RowMenu";
import { RowTable, type TableRow } from "@/components/admin/RowTable";
import type { BadgeTone } from "@/core/blocks";
import { pauseAccessAction, revokeTokenAction } from "./actions";

/** The few filter pills for the owners: more than this many people and the search does the job (R19: never a wall of pills). */
const OWNER_PILLS_MAX = 6;
type State = "active" | "paused" | "stopped" | "none";
const TONE: Record<State, BadgeTone> = { active: "ok", paused: "warn", stopped: "warn", none: "danger" };

/**
 * "By person" tab (0.47.0): every AI access with the person it belongs to, its level and its state. One table (R30), search always present (R15), at most two visible
 * actions per row (R16): Pause, and the "⋯" menu (remove). THE OWNER OF AN ACCESS NEVER CHANGES (0.47.1): no row offers to choose another one. An access with no owner (it never
 * had one) works as before and says so ("No owner"; the temporary panel above gives it one, once); an access whose owner disappeared is revoked and is not listed (the sweep runs
 * first). Only holders of `core:mcp.tokens` see this page (the page and every action check it).
 */
export async function OwnersTab({ t }: { t: Translator }) {
  await sweepOrphanedAccesses().catch(() => []);
  const [rows, users] = await Promise.all([
    prisma.apiToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const ownerStates = new Map<string, Awaited<ReturnType<typeof resolvePersonalOwner>>>();
  for (const r of rows) if (r.ownerId && byId.has(r.ownerId) && !ownerStates.has(r.ownerId)) ownerStates.set(r.ownerId, await resolvePersonalOwner(r.ownerId));
  const levelText = (l: string) => t(`myai.level.${l}`);
  const stateOf = (r: (typeof rows)[number]): { state: State; why?: string } => {
    if (!r.ownerId) return { state: "none", why: t("owners.state.noneWhy") };
    if (r.pausedAt) return { state: "paused" };
    return ownerStates.get(r.ownerId)?.active ? { state: "active" } : { state: "stopped", why: t("owners.state.stoppedWhy") };
  };
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((id): id is string => !!id && byId.has(id)))];
  const pills = ownerIds.length > 1 && ownerIds.length <= OWNER_PILLS_MAX;
  const counts: Record<State, number> = { active: 0, paused: 0, stopped: 0, none: 0 };
  const tableRows: TableRow[] = rows.map((r) => {
    const { state, why } = stateOf(r);
    counts[state]++;
    const owner = r.ownerId ? byId.get(r.ownerId) : undefined;
    return {
      key: r.id, testid: "owners-row",
      search: [r.name, owner?.name, owner?.email, levelText(levelOfRow(r)), t(`owners.state.${state}`)],
      filters: { state, ...(pills && owner ? { owner: owner.id } : {}) },
      titles: { access: r.name, owner: owner ? `${owner.name} — ${owner.email}` : undefined },
      cells: {
        access: <span className="block truncate font-medium">{r.name}</span>,
        owner: owner ? <><span className="block truncate">{owner.name}</span><span className="block truncate text-muted">{owner.email}</span></> : <span className="text-muted">—</span>,
        level: <Badge tone="info" testid="owners-level">{levelText(levelOfRow(r))}</Badge>,
        state: <Badge tone={TONE[state]} title={why} testid="owners-state">{t(`owners.state.${state}`)}</Badge>,
      },
      actions: (
        <>
          {state === "active" && <form action={pauseAccessAction.bind(null, r.id)}><PendingButton testid="owners-pause">{t("owners.pause")}<span className="sr-only"> {r.name}</span></PendingButton></form>}
          <RowMenu label={t("users.menu.open", { name: r.name })}>
            <form action={revokeTokenAction.bind(null, r.id)}><ConfirmButton menu message={t("owners.removeConfirm", { name: r.name })} confirmLabel={t("assistants.revoke")} dangerConfirm>{t("owners.remove")}</ConfirmButton></form>
          </RowMenu>
        </>
      ),
    };
  });
  const filters = [
    { key: "state", allLabel: t("owners.filter.all"), options: (["active", "paused", "stopped", "none"] as State[]).filter((s) => counts[s] > 0).map((s) => ({ value: s, label: t(`owners.state.${s}`), count: counts[s] })) },
    ...(pills ? [{ key: "owner", allLabel: t("owners.filter.everyone"), options: ownerIds.map((id) => ({ value: id, label: byId.get(id)!.name, count: rows.filter((r) => r.ownerId === id).length })) }] : []),
  ];
  return (
    <div className="space-y-8" data-testid="assistants-owners">
      <Panel title={t("owners.title")} testid="owners-table">
        {rows.length === 0 ? <EmptyState icon="🤖" title={t("owners.empty.title")}>{t("owners.empty.body")}</EmptyState> : (
          <>
            <LiveSearch scope="owners" placeholder={t("owners.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")} filters={filters} />
            <RowTable scope="owners" actionsLabel={t("users.actions")}
              columns={[
                { key: "access", label: t("owners.col.access"), width: "w-[20%]" },
                { key: "owner", label: t("owners.col.owner"), width: "w-[22%]" },
                { key: "level", label: t("owners.col.level"), width: "w-[19%]" },
                { key: "state", label: t("owners.col.state"), width: "w-[17%]" },
              ]} rows={tableRows} />
          </>
        )}
      </Panel>
    </div>
  );
}
