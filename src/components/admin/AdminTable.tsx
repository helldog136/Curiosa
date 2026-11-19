"use client";

import { RowActionButton, RowMenuItem, RowSwitch, type EntryScope } from "./AdminBlocks";
import type { Block } from "@/core/blocks";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TableView } from "./TableView";
import { serverSearchParams } from "@/core/adminkit/table";
import type { TableLabels } from "./TableView";
export type { TableLabels };

// The admin table: the shared table view with the row buttons, menu items and switches of an admin panel. Public pages use `TableView` alone (see Blocks.tsx),
// so the admin form kit stays out of their JavaScript.
const parts = { RowActionButton, RowMenuItem, RowSwitch };
type Props = { block: Extract<Block, { type: "table" }>; instanceId?: string; entry?: EntryScope; labels: TableLabels };
export function AdminTable(props: Props) {
  // The router hooks only run for a server search (a table without one renders with no router at all, as before).
  return props.block.searchable === "server" && props.instanceId ? <ServerSearchTable {...props} /> : <TableView {...props} parts={parts} />;
}

/** (core 0.38.0) `searchable: "server"`: the module filters and paginates; the field only edits `?q=` in the address (the address is the state: reload, "Back" and a shared link work). */
function ServerSearchTable(props: Props) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const asked = serverSearchParams(props.block);
  const server = asked ? { ...asked, value: search.get(asked.param) ?? "", current: `${path}${search.toString() ? `?${search.toString()}` : ""}`, go: (target: string) => router.replace(target, { scroll: false }) } : undefined;
  return <TableView {...props} parts={parts} server={server} />;
}
