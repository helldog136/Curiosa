"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BadgeTone, Block, TableCell } from "@/core/blocks";
import { splitActions } from "@/core/adminkit/table";
import { TABLE_PAGE_SIZE, pageSlice, pillOptions, rowPasses, searchText } from "@/core/adminkit/search";
import { Pills, SearchField } from "./LiveSearch";
import { RowMenu } from "./RowMenu";
import { RowActionButton, RowMenuItem, RowSwitch, type EntryScope } from "./AdminBlocks";
import { safeHref } from "@/core/url";
import { ui } from "./ui";

type TableBlock = Extract<Block, { type: "table" }>;

/** Les textes du tableau enrichi (déjà traduits par le serveur). */
export type TableLabels = {
  search: string; none: string; clear: string; all: string; count: string; prev: string; next: string; page: string; pages: string; actions: string; menu: string; saved: string; failed: string;
  on: string; off: string;
};

/** Une pastille : couleur ET texte, jamais la couleur seule. */
export const BADGE: Record<BadgeTone, string> = {
  accent: "bg-accent/10 text-accent",
  info: "bg-sky-500/15 text-sky-800",
  ok: "bg-emerald-500/15 text-emerald-800",
  warn: "bg-amber-500/20 text-amber-900",
  danger: "bg-red-500/15 text-red-800",
  neutral: "bg-line/60 text-fg",
};

type Cell = { text: string; badge?: BadgeTone; href?: string; title?: string; sw?: Extract<TableCell, object>["switch"] };
const norm = (c: TableCell | undefined): Cell => (typeof c === "string" || c === undefined ? { text: c ?? "" } : { text: c.text ?? "", badge: c.badge, href: c.href, title: c.title, sw: c.switch });

export function AdminTable({ block, instanceId, entry, labels }: { block: TableBlock; instanceId?: string; entry?: EntryScope; labels: TableLabels }) {
  const [query, setQuery] = useState("");
  const [pills, setPills] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);
  const size = block.pageSize === 0 ? 0 : block.pageSize ?? TABLE_PAGE_SIZE;
  const filters = useMemo(() => block.filters ?? [], [block.filters]);

  const rows = useMemo(() => block.rows.map((raw, index) => {
    const cells = raw.map(norm);
    const keys: Record<string, string | undefined> = {};
    filters.forEach((f, i) => { keys[`f${i}`] = cells[f.column]?.text; });
    return { index, cells, haystack: searchText(cells.flatMap((c) => [c.text, c.title])), keys };
  }), [block.rows, filters]);

  const shown = rows.filter((r) => rowPasses({ haystack: r.haystack, ...r.keys }, query, pills));
  const view = pageSlice(shown, page, size);
  // Un nouveau filtre ramène à la première page.
  useEffect(() => setPage(1), [query, pills]);

  const clear = () => { setQuery(""); setPills({}); };
  const active = query.trim() !== "" || Object.values(pills).some((v) => v !== "all");
  const { visible: visibleActions, menu: menuActions } = splitActions(block.rowActions ?? []);
  const hasActions = Boolean(instanceId && (block.rowActions ?? []).length > 0);
  const cut = new Set(block.truncate ?? []);
  const href = (a: { href?: string }, id?: string) => a.href?.replace("{id}", encodeURIComponent(id ?? ""));

  if (rows.length === 0) return block.empty ? <div className={`${ui.card} text-[15px]`}>{block.empty}</div> : null;
  return (
    <div className="space-y-3" data-admin-table="" ref={top}>
      {(block.searchable || filters.length > 0) && (
        <div className="space-y-3">
          {block.searchable && <SearchField value={query} onChange={setQuery} onClear={clear} placeholder={block.searchPlaceholder ?? labels.search} clearLabel={labels.clear} />}
          {filters.map((f, i) => (
            <Pills key={i} pillKey={`f${i}`} label={block.columns[f.column] ?? ""} allLabel={f.allLabel ?? labels.all} value={pills[`f${i}`] ?? "all"} onChange={(v) => setPills((p) => ({ ...p, [`f${i}`]: v }))}
              options={pillOptions(rows.map((r) => r.cells[f.column]?.text ?? "")).map((o) => ({ value: o.value, label: o.value, count: o.count }))} />
          ))}
          <p className="min-h-5 text-sm text-muted" role="status" aria-live="polite">{active && shown.length > 0 ? labels.count.replace("{shown}", String(shown.length)).replace("{total}", String(rows.length)) : ""}</p>
        </div>
      )}
      {shown.length === 0 ? (
        <div role="status" className={`${ui.card} space-y-2 text-[15px]`} data-testid="live-search-none">
          <p className="font-medium">{labels.none}</p>
          <button type="button" onClick={clear} className={`${ui.btn} min-h-11`}>{labels.clear}</button>
        </div>
      ) : (
        <table role="table" data-skin-part="table" className="w-full text-left text-sm max-sm:block">
          <thead data-skin-part="table-head" role="rowgroup" className="text-muted max-sm:sr-only">
            <tr data-skin-part="table-row" role="row">
              {block.columns.map((c, i) => <th key={i} role="columnheader" data-skin-part="table-cell" className="px-3 py-2 font-medium">{c}</th>)}
              {hasActions && <th role="columnheader" className="px-3 py-2"><span className="sr-only">{labels.actions}</span></th>}
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {view.items.map((r) => {
              const id = block.rowIds?.[r.index];
              return (
                <tr key={r.index} role="row" data-skin-part="table-row" className="border-t-token border-line align-middle max-sm:mb-3 max-sm:block max-sm:rounded-2xl max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-3">
                  {r.cells.map((c, i) => (
                    <td key={i} role="cell" data-skin-part="table-cell" data-label={block.columns[i]}
                      className={`px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1 max-sm:py-1.5 max-sm:before:shrink-0 max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)] ${cut.has(i) ? "max-w-[26ch] max-sm:max-w-none" : "whitespace-pre-wrap"}`}>
                      <CellView cell={c} cut={cut.has(i)} instanceId={instanceId} entry={entry} id={id} labels={labels} />
                    </td>
                  ))}
                  {hasActions && (
                    <td role="cell" className="whitespace-nowrap px-3 py-2 max-sm:flex max-sm:justify-end max-sm:px-1 max-sm:pt-2">
                      <div className="flex items-center gap-2">
                        {visibleActions.map((a) => (
                          <RowActionButton key={a.label} instanceId={instanceId!} label={a.label} action={a.action} href={href(a, id)} id={id} confirm={a.confirm} danger={a.danger} entry={entry} />
                        ))}
                        {menuActions.length > 0 && (
                          <RowMenu label={labels.menu}>
                            {menuActions.map((a) => <RowMenuItem key={a.label} instanceId={instanceId!} label={a.label} action={a.action} href={href(a, id)} id={id} confirm={a.confirm} danger={a.danger} entry={entry} />)}
                          </RowMenu>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {view.pages > 1 && (
        <nav aria-label={labels.pages} className="flex items-center justify-between gap-3">
          <button type="button" disabled={view.page <= 1} onClick={() => { setPage(view.page - 1); top.current?.scrollIntoView({ block: "nearest" }); }} className={`${ui.btn} min-h-11`}>← {labels.prev}</button>
          <span className="text-sm text-muted" aria-live="polite">{labels.page.replace("{page}", String(view.page)).replace("{pages}", String(view.pages))}</span>
          <button type="button" disabled={view.page >= view.pages} onClick={() => { setPage(view.page + 1); top.current?.scrollIntoView({ block: "nearest" }); }} className={`${ui.btn} min-h-11`}>{labels.next} →</button>
        </nav>
      )}
    </div>
  );
}

function CellView({ cell, cut, instanceId, entry, id, labels }: { cell: Cell; cut: boolean; instanceId?: string; entry?: EntryScope; id?: string; labels: TableLabels }) {
  if (cell.sw) {
    // Interrupteur : actif dans le panneau d'admin ; ailleurs (ou sans identifiant de ligne), seulement l'état écrit.
    if (instanceId) return <RowSwitch instanceId={instanceId} action={cell.sw.action} id={id} on={cell.sw.on} label={cell.sw.label} onText={cell.sw.onText ?? labels.on} offText={cell.sw.offText ?? labels.off} entry={entry} failedText={labels.failed} savedText={labels.saved} />;
    return <span>{cell.text || (cell.sw.on ? cell.sw.onText ?? labels.on : cell.sw.offText ?? labels.off)}</span>;
  }
  const body = cell.badge
    ? <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[cell.badge]}`}>{cell.text}</span>
    : cell.href ? <a href={safeHref(cell.href)} className="underline-offset-2 hover:text-accent hover:underline">{cell.text}</a> : cell.text;
  return cut ? <span className="block truncate" title={cell.title ?? cell.text}>{body}</span> : cell.title ? <span title={cell.title}>{body}</span> : <>{body}</>;
}
