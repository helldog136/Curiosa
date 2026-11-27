"use client";

import { useMemo, useState } from "react";
import { matchesSearch, searchText } from "@/core/adminkit/search";
import { Pills, ResultCount, SearchField } from "./LiveSearch";
import { Badge } from "./Badge";
import { DialogLink } from "./EditDialog";
import { RowMenu } from "./RowMenu";
import { RowActionButton, RowMenuItem } from "./AdminBlocks";
import { ORIGINS, ORIGIN_TONE, rowSearchParts, stateTone, type ConnectionRow, type ConnectionsLabels, type RowAction } from "./connectionRows";
import { ui } from "./ui";


function ActionButton({ action }: { action: RowAction }) {
  if (action.kind === "dialog") return <DialogLink href={action.href} className={`${ui.btn} min-h-11`}>{action.label}</DialogLink>;
  if (action.kind === "link") return <a href={action.href} className={`${ui.btn} inline-flex min-h-11 items-center`}>{action.label}</a>;
  return <RowActionButton instanceId={action.instanceId} label={action.label} action={action.action} id={action.id} />;
}

/**
 * The table of "Accounts and connections" (R30): one table, a column for where a row comes from and one for its state (a word AND a colour), live search (R15), quick
 * filters with their numbers, ONE button per row (same place on every row, R16) and the rare actions in the "⋯" menu. On a phone each row is a card.
 */
export function ConnectionsTable({ rows, labels }: { rows: ConnectionRow[]; labels: ConnectionsLabels }) {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("all");
  const [state, setState] = useState("all");
  const items = useMemo(() => rows.map((r) => ({ r, haystack: searchText(rowSearchParts(r, labels)) })), [rows, labels]);
  const shown = items.filter(({ r, haystack }) => matchesSearch(haystack, query) && (origin === "all" || r.origin === origin) && (state === "all" || r.state === state));
  const count = (f: (r: ConnectionRow) => boolean) => rows.filter(f).length;
  const originOptions = ORIGINS.filter((o) => count((r) => r.origin === o) > 0).map((o) => ({ value: o, label: labels.origin[o], count: count((r) => r.origin === o) }));
  const stateOptions = (["configured", "degraded", "notConfigured"] as const).filter((s) => count((r) => r.state === s) > 0).map((s) => ({ value: s, label: labels.state[s], count: count((r) => r.state === s) }));
  const active = query.trim() !== "" || origin !== "all" || state !== "all";
  const clear = () => { setQuery(""); setOrigin("all"); setState("all"); };
  const visible = shown;
  return (
    <div className="space-y-3" data-testid="connections-table">
      <SearchField value={query} onChange={setQuery} onClear={clear} placeholder={labels.search} clearLabel={labels.clear} hideClear={shown.length === 0} />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {originOptions.length > 1 && <Pills pillKey="origin" label={labels.filterOrigin} allLabel={labels.all} options={originOptions} value={origin} onChange={setOrigin} />}
        {stateOptions.length > 1 && <Pills pillKey="state" label={labels.filterState} allLabel={labels.all} options={stateOptions} value={state} onChange={setState} />}
      </div>
      <ResultCount text={active && shown.length > 0 ? labels.count.replace("{shown}", String(shown.length)).replace("{total}", String(rows.length)) : ""} />
      {shown.length === 0 ? (
        <div role="status" className={`${ui.card} space-y-2 text-[15px]`} data-testid="live-search-none">
          <p className="font-medium">{labels.none}</p>
          <button type="button" onClick={clear} className={`${ui.btn} min-h-11`}>{labels.clear}</button>
        </div>
      ) : (
        <div className="relative sm:overflow-x-auto">
        <table role="table" className="w-full text-left text-sm max-sm:block">
          <thead role="rowgroup" className="text-muted max-sm:sr-only">
            <tr role="row">
              <th role="columnheader" className="px-3 py-2 font-medium">{labels.columns.name}</th>
              <th role="columnheader" className="px-3 py-2 font-medium">{labels.columns.origin}</th>
              <th role="columnheader" className="px-3 py-2 font-medium">{labels.columns.state}</th>
              <th role="columnheader" className="px-3 py-2 font-medium">{labels.columns.detail}</th>
              <th role="columnheader" className="px-3 py-2"><span className="sr-only">{labels.columns.actions}</span></th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {visible.map(({ r }) => (
              <tr key={r.id} role="row" data-testid="connection-row" data-origin={r.origin} data-state={r.state ?? ""} className="border-t-token border-line align-middle sm:h-14 max-sm:mb-3 max-sm:block max-sm:rounded-2xl max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-3">
                <td role="cell" className="px-3 py-2 font-medium max-sm:block max-sm:px-1">
                  <span className="break-words">{r.name}</span>
                  {r.todo > 0 && <span className="ml-2 min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{r.todo}<span className="sr-only"> {labels.todo}</span></span>}
                </td>
                <td role="cell" data-label={labels.columns.origin} className="px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-1 max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]"><Badge tone={ORIGIN_TONE[r.origin]}>{labels.origin[r.origin]}</Badge></td>
                <td role="cell" data-label={labels.columns.state} className="px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-1 max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]">
                  {r.state && <Badge tone={stateTone(r.state)} testid="connection-state">{labels.state[r.state]}</Badge>}
                </td>
                <td role="cell" className="max-w-[34ch] px-3 py-2 max-sm:max-w-none max-sm:px-1"><span className="block truncate max-sm:whitespace-normal max-sm:break-words" title={r.detail}>{r.detail}</span></td>
                <td role="cell" className="whitespace-nowrap px-3 py-2 max-sm:px-1 max-sm:pt-2">
                  <div className="flex min-h-11 items-center gap-2 max-sm:justify-end">
                    <ActionButton action={r.action} />
                    {r.menu.length > 0 && (
                      <RowMenu label={labels.menu}>
                        {r.menu.map((m) => <RowMenuItem key={m.action + (m.id ?? "")} instanceId={m.instanceId} label={m.label} action={m.action} id={m.id} confirm={m.confirm} danger={m.danger} />)}
                      </RowMenu>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
