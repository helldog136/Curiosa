"use client";

import { RowActionButton, RowMenuItem, RowSwitch, type EntryScope } from "./AdminBlocks";
import type { Block } from "@/core/blocks";
import { TableView } from "./TableView";
import type { TableLabels } from "./TableView";
export type { TableLabels };

// The admin table: the shared table view with the row buttons, menu items and switches of an admin panel. Public pages use `TableView` alone (see Blocks.tsx),
// so the admin form kit stays out of their JavaScript.
const parts = { RowActionButton, RowMenuItem, RowSwitch };
export function AdminTable(props: { block: Extract<Block, { type: "table" }>; instanceId?: string; entry?: EntryScope; labels: TableLabels }) {
  return <TableView {...props} parts={parts} />;
}
