import { ExtensionsHeader } from "@/components/admin/ExtensionsHeader";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { Badge } from "@/components/admin/Badge";
import { Panel } from "@/components/admin/Page";
import { RowTable, type TableRow } from "@/components/admin/RowTable";
import type { AccessState } from "@/core/gitAccess";
import type { Translator } from "@/core/i18n/dictionary";
import { catalogueLabel, type CatalogueStatus, type PersonalCatalogue, type ReadFailure } from "@/core/modules/personalCatalogues";
import type { BadgeTone } from "@/core/blocks";
import { AddCatalogue, CatalogueActions } from "./PersonalClient";
import { PERSONAL_LABEL_KEYS } from "./labels";

const REASON: Record<ReadFailure, string> = { access: "personal.reason.access", unreachable: "access.error.unreachable", tooOld: "access.error.tooOld", index: "personal.reason.index", unknown: "personal.reason.unknown" };

export type PersonalRowData = { catalogue: PersonalCatalogue; status: CatalogueStatus; access: AccessState; installed: number };

/**
 * Extensions > Personal catalogues (owner only): repositories, maybe private, that offer their own extensions. They appear in the catalogue of this site with a "Personal"
 * tag. One table (search, state in words, one main button and a menu per row), one short form to add (R2: one address, one click to check, one click to add).
 */
export function PersonalView({ t, advanced, data, addInitial }: { t: Translator; advanced: boolean; data: PersonalRowData[]; addInitial?: React.ComponentProps<typeof AddCatalogue>["initial"] }) {
  const labels = Object.fromEntries(PERSONAL_LABEL_KEYS.map((k) => [k, t(k)]));
  const rows: TableRow[] = data.map(({ catalogue: c, status, access, installed }) => {
    const needsAccess = status.state === "access" || access.state === "reenter";
    const state: { tone: BadgeTone; text: string; reason?: string } = needsAccess ? { tone: "danger", text: t("personal.state.access"), reason: t(access.state === "reenter" ? "access.reenter.why" : "personal.reason.access") }
      : status.state === "degraded" ? { tone: "warn", text: t("personal.state.degraded"), reason: t(REASON[status.failure ?? "unknown"]) }
      : status.state === "configured" ? { tone: "ok", text: t("personal.state.configured") }
      : { tone: "neutral", text: t("personal.state.unknown") };
    return {
      key: c.id, testid: `catalogue-${c.id}`,
      search: [c.name, catalogueLabel(c.url), state.text],
      cells: {
        name: <div className="min-w-0"><p className="truncate font-medium" title={c.name}>{c.name}</p><p className="truncate text-xs text-muted" title={c.url}>{catalogueLabel(c.url)}</p></div>,
        state: <div className="space-y-1"><Badge tone={state.tone}>{state.text}</Badge>{state.reason && <p className="text-xs text-muted">{state.reason}</p>}</div>,
        count: status.state === "configured" ? String(status.offered) : null,
      },
      titles: { name: `${c.name} ${c.url}` },
      actions: <CatalogueActions id={c.id} name={c.name} address={c.url} installed={installed} access={access} needsAccess={needsAccess} labels={labels} />,
    };
  });
  return (
    <div className="space-y-8">
      <ExtensionsHeader t={t} advanced={advanced} isOwner current="personal" intro={t("personal.intro")} tip={t("personal.tip")} />
      <Panel title={t("personal.add.title")} testid="personal-add-panel">
        <AddCatalogue labels={labels} initial={addInitial} />
      </Panel>
      <Panel title={t("personal.list.title", { n: data.length })} testid="personal-list">
        <LiveSearch scope="personal" placeholder={t("search.placeholder")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")} />
        {data.length === 0
          ? <p className="text-sm text-muted" data-testid="personal-empty">{t("personal.empty")}</p>
          : <RowTable scope="personal" actionsLabel={t("personal.actions")} testid="personal-table" columns={[
              { key: "name", label: t("personal.col.name"), width: "w-[34%]" },
              { key: "state", label: t("personal.col.state"), width: "w-[30%]" },
              { key: "count", label: t("personal.col.count"), width: "w-[10%]", optional: true },
            ]} rows={rows} />}
      </Panel>
    </div>
  );
}
