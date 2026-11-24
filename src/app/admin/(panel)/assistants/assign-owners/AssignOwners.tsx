// TEMPORARY (SUNSET 0.49.0): the page "Choose who owns each access" exists only to migrate sites that have several accounts. It is NOT shown when every access has an owner.
// Deleting this folder (and its import in ../OwnersTab.tsx, the locale keys `owners.assign.*`, its sunset test in tests/services/access-owners.test.mjs) removes it.
import type { Translator } from "@/core/i18n/dictionary";
import { accessesWithoutOwner, eligibleOwners, ownerOptions } from "@/core/personalAi/owners";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { Panel } from "@/components/admin/Page";
import { RowTable, type TableRow } from "@/components/admin/RowTable";
import { assignOwnerAction } from "../actions";
import { OwnerSelect } from "../OwnerSelect";
import { BulkAssign } from "./BulkAssign";
import { assignAllAction } from "./actions";

export const ASSIGN_OWNERS_SUNSET = "0.49.0";

/** Null when nothing waits for input (R33: no empty panel). */
export async function AssignOwners({ t, viewerId }: { t: Translator; viewerId: string }) {
  const rows = await accessesWithoutOwner();
  if (rows.length === 0) return null;
  const owners = ownerOptions(await eligibleOwners(viewerId));
  const labels = { choose: t("owners.assign.choose"), assign: t("owners.assign.assign"), failed: t("owners.assign.failed"), owned: t("owners.assign.owned"), done: t("owners.assign.done"), pick: t("owners.assign.pick") };
  const tableRows: TableRow[] = rows.map((r) => ({
    key: r.id, testid: "assign-row", search: [r.name], cells: { access: <span className="block break-words font-medium">{r.name}</span> },
    actions: <OwnerSelect tokenId={r.id} owners={owners} assign={assignOwnerAction} labels={labels} />,
  }));
  return (
    <Panel title={t("owners.assign.title")} help={t("owners.assign.help")} testid="assign-owners">
      <BulkAssign owners={owners} count={rows.length} assignAll={assignAllAction}
        labels={{ pick: labels.pick, choose: t("owners.assign.bulkChoose"), placeholder: t("owners.assign.bulkPlaceholder"), button: t("owners.assign.bulk"), confirm: t("owners.assign.bulkConfirm"), confirmLabel: t("owners.assign.bulkConfirmLabel"), done: t("owners.assign.bulkDone"), failed: labels.failed }} />
      <LiveSearch scope="assign" placeholder={t("owners.assign.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")} />
      <RowTable scope="assign" actionsLabel={t("users.actions")} columns={[{ key: "access", label: t("owners.col.access"), width: "w-[34%]" }]} rows={tableRows} />
    </Panel>
  );
}
