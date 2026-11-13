"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BadgeTone, Block, TableCell } from "@/core/blocks";
import { splitActions } from "@/core/adminkit/table";
import { TABLE_PAGE_SIZE, pageSlice, pillOptions, rowPasses, searchText } from "@/core/adminkit/search";
import { Pills, SearchField } from "./LiveSearch";
import { BADGE } from "./Badge";
import { RowMenu } from "./RowMenu";
import type { EntryScope } from "./AdminBlocks";
import { safeHref } from "@/core/url";
import type { CellImage } from "@/core/adminkit/image";
import { ui } from "./ui";
import { SAVED_EVENT, type SavedDetail } from "./savedEvent";

type TableBlock = Extract<Block, { type: "table" }>;

/** Les textes du tableau enrichi (déjà traduits par le serveur). */
export type TableLabels = {
  search: string; none: string; clear: string; all: string; count: string; prev: string; next: string; page: string; pages: string; actions: string; menu: string; saved: string; failed: string;
  on: string; off: string;
};

type Cell = { text: string; badge?: BadgeTone; href?: string; title?: string; sw?: Extract<TableCell, object>["switch"]; image?: CellImage };
const norm = (c: TableCell | undefined): Cell => (typeof c === "string" || c === undefined ? { text: c ?? "" } : { text: c.text ?? "", badge: c.badge, href: c.href, title: c.title, sw: c.switch, image: shownImage(c.image) });
/** Dernier garde-fou côté navigateur : le serveur a DÉJÀ validé l'image (hôte déclaré, texte alternatif) ; ici on n'accepte plus qu'une page du site ou du https, avec un texte alternatif. */
function shownImage(image: CellImage | undefined): CellImage | undefined {
  if (!image || typeof image.alt !== "string" || image.alt.trim() === "" || typeof image.src !== "string") return undefined;
  return (/^\/(?!\/)/.test(image.src) || /^https:\/\//i.test(image.src)) ? image : undefined;
}

/** The admin-only pieces (they call the server actions of an admin panel). Public pages render the table without them; `AdminTable.tsx` supplies them. */
export type TableParts = Pick<typeof import("./AdminBlocks"), "RowActionButton" | "RowMenuItem" | "RowSwitch">;

export function TableView({ block, instanceId, entry, labels, parts }: { block: TableBlock; instanceId?: string; entry?: EntryScope; labels: TableLabels; parts?: TableParts }) {
  const { RowActionButton, RowMenuItem } = parts ?? ({} as TableParts);
  const [query, setQuery] = useState("");
  const [pills, setPills] = useState<Record<string, string>>({});
  const [pageAt, setPageAt] = useState({ key: "", page: 1 });
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
  // Un nouveau filtre ou une nouvelle recherche ramène à la première page.
  const filterKey = `${query}\u0000${JSON.stringify(pills)}`;
  const page = pageAt.key === filterKey ? pageAt.page : 1;
  const setPage = (n: number) => setPageAt({ key: filterKey, page: n });
  const view = pageSlice(shown, page, size);

  // An edit dialog above this list was saved: the row gets a visible confirmation (until the next search or filter), announced to screen readers.
  const [saved, setSaved] = useState<{ key: string; id?: string; message: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<SavedDetail>).detail;
      if (d.instanceId === instanceId) setSaved({ key: filterKey, id: d.id, message: d.message });
    };
    window.addEventListener(SAVED_EVENT, on);
    return () => window.removeEventListener(SAVED_EVENT, on);
  }, [instanceId, filterKey]);
  const notice = saved && saved.key === filterKey ? saved : null;
  const noticeRow = notice?.id !== undefined ? view.items.find((r) => block.rowIds?.[r.index] === notice.id) : undefined;
  useEffect(() => {
    if (noticeRow) top.current?.querySelector("[data-row-saved]")?.scrollIntoView({ block: "nearest" });
  }, [noticeRow, notice]);

  const clear = () => { setQuery(""); setPills({}); };
  const active = query.trim() !== "" || Object.values(pills).some((v) => v !== "all");
  const { visible: visibleActions, menu: menuActions } = splitActions(block.rowActions ?? []);
  const hasActions = Boolean(instanceId && (block.rowActions ?? []).length > 0);
  const cut = new Set(block.truncate ?? []);
  // Une colonne qui a des vignettes réserve la place de la vignette à chaque ligne (lignes de même hauteur, R16), même quand une ligne n'en a pas.
  const pictured = new Set(rows.flatMap((r) => r.cells.flatMap((c, i) => (c.image ? [i] : []))));
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
      {notice && <p role="status" data-testid="table-saved" className={noticeRow ? "sr-only" : "rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-800"}>{noticeRow ? "" : "✓ "}{notice.message}</p>}
      {shown.length === 0 ? (
        <div role="status" className={`${ui.card} space-y-2 text-[15px]`} data-testid="live-search-none">
          <p className="font-medium">{labels.none}</p>
          <button type="button" onClick={clear} className={`${ui.btn} min-h-11`}>{labels.clear}</button>
        </div>
      ) : (
        // Plus large que l'écran, le tableau défile ; sous 640 px chaque ligne devient une carte (rien ne déborde).
        <div className="relative sm:overflow-x-auto">
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
                <tr key={r.index} role="row" data-skin-part="table-row" data-row-saved={noticeRow === r ? "" : undefined} className={`${noticeRow === r ? "bg-emerald-500/10 " : ""}border-t-token border-line align-middle max-sm:mb-3 max-sm:block max-sm:rounded-2xl max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-3`}>
                  {r.cells.map((c, i) => (
                    <td key={i} role="cell" data-skin-part="table-cell" data-label={block.columns[i]}
                      className={`px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1 max-sm:py-1.5 max-sm:before:shrink-0 max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)] ${cut.has(i) ? "max-w-[26ch] max-sm:max-w-none" : "whitespace-pre-wrap"}`}>
                      <CellView parts={parts} cell={c} cut={cut.has(i)} pictured={pictured.has(i)} instanceId={instanceId} entry={entry} id={id} labels={labels} />
                      {i === 0 && noticeRow === r && <span aria-hidden="true" className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-800">✓ {notice?.message}</span>}
                    </td>
                  ))}
                  {hasActions && (
                    <td role="cell" className="whitespace-nowrap px-3 py-2 max-sm:flex max-sm:justify-end max-sm:px-1 max-sm:pt-2">
                      <div className="flex items-center gap-2">
                        {visibleActions.map((a) => (
                          <RowActionButton key={a.label} instanceId={instanceId!} label={a.label} action={a.action} href={href(a, id)} id={id} confirm={a.confirm} danger={a.danger} entry={entry} presentation={a.presentation} />
                        ))}
                        {menuActions.length > 0 && (
                          <RowMenu label={labels.menu}>
                            {menuActions.map((a) => <RowMenuItem key={a.label} instanceId={instanceId!} label={a.label} action={a.action} href={href(a, id)} id={id} confirm={a.confirm} danger={a.danger} entry={entry} presentation={a.presentation} />)}
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
        </div>
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

function CellView({ cell, cut, pictured, instanceId, entry, id, labels, parts }: { parts?: TableParts; cell: Cell; cut: boolean; pictured?: boolean; instanceId?: string; entry?: EntryScope; id?: string; labels: TableLabels }) {
  if (cell.sw) {
    // Interrupteur : actif dans le panneau d'admin ; ailleurs (ou sans identifiant de ligne), seulement l'état écrit.
    if (instanceId && parts) return <parts.RowSwitch instanceId={instanceId} action={cell.sw.action} id={id} on={cell.sw.on} label={cell.sw.label} onText={cell.sw.onText ?? labels.on} offText={cell.sw.offText ?? labels.off} entry={entry} failedText={labels.failed} savedText={labels.saved} />;
    return <span>{cell.text || (cell.sw.on ? cell.sw.onText ?? labels.on : cell.sw.offText ?? labels.off)}</span>;
  }
  const body = cell.badge
    ? <span data-badge="" title={cell.title ?? cell.text} className={`inline-flex min-h-6 max-w-full min-w-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 ${BADGE[cell.badge]}`}><span className="min-w-0 truncate">{cell.text}</span></span>
    : cell.href ? <a href={safeHref(cell.href)} className="underline-offset-2 hover:text-accent hover:underline">{cell.text}</a> : cell.text;
  const text = cut ? <span className="block truncate" title={cell.title ?? cell.text}>{body}</span> : cell.title ? <span title={cell.title}>{body}</span> : <>{body}</>;
  if (!pictured) return text;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Thumb image={cell.image} initial={cell.text} />
      {cell.text !== "" && <span className="min-w-0">{text}</span>}
    </span>
  );
}

/** Vignette à taille fixe (40 px, comme les autres lignes) : chargement paresseux, `object-fit`, et si l'image ne charge pas, une pastille neutre à sa place (jamais d'icône cassée). Sans `image` : la même place, vide. */
function Thumb({ image, initial }: { image?: CellImage; initial: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // L'erreur peut survenir avant l'hydratation : on relit l'état de l'image à l'affichage.
  useEffect(() => { const el = ref.current; if (el && el.complete && el.naturalWidth === 0) setFailed(true); }, []);
  return <ThumbView image={image} initial={initial} failed={failed} imgRef={ref} onError={() => setFailed(true)} />;
}

/** L'aspect d'une vignette (sans état : testable et photographiable dans ses trois cas — image, case vide, image tombée). */
export function ThumbView({ image, initial, failed, imgRef, onError }: { image?: CellImage; initial: string; failed: boolean; imgRef?: React.Ref<HTMLImageElement>; onError?: () => void }) {
  const box = "inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface";
  if (!image) return <span className={box} aria-hidden="true" />;
  if (failed) return <span className={`${box} text-sm font-semibold text-muted`} role="img" aria-label={image.alt}>{Array.from(initial.trim())[0]?.toUpperCase() ?? ""}</span>;
  return (
    <span className={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={image.src} alt={image.alt} width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onError}
        data-testid="table-thumb" className={`h-full w-full ${image.fit === "contain" ? "object-contain" : "object-cover"}`} />
    </span>
  );
}
