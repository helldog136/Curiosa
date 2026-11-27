"use client";

import { useMemo, useRef, useState } from "react";
import { cellState, editableSelection, grantSets, groupCount, moveFocus, type CellState, type MatrixGroup, type MatrixRole } from "@/core/adminkit/rightsMatrix";
import { HelpTip } from "./HelpTip";
import { StatusPill } from "./StatusPill";
import { ui } from "./ui";

export type RightsMatrixLabels = {
  /** Accessible name of the table. */
  region: string;
  /** Header of the first column (« Access »). */
  corner: string;
  yes: string; no: string;
  /** « Cannot be delegated »: a reserved right, never grantable to a custom role. */
  locked: string;
  sensitive: string;
  /** Pill on a built-in preset column (« Built-in preset »). */
  system: string;
  /** « {n} people » (several) and « 1 person ». */
  people: string; peopleOne: string;
  /** « {n} of {total} » */
  count: string;
  /** « {n} accesses chosen » (live region while editing). */
  chosen: string;
  /** « {right}, {role} » : name of an editable box. */
  cell: string;
};

const ICON: Record<Exclude<CellState, "edit">, { glyph: React.ReactNode; tone: string }> = {
  yes: { glyph: <path d="M3 8.5l3.2 3L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />, tone: "text-ok-text" },
  no: { glyph: <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />, tone: "text-muted" },
  locked: { glyph: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" strokeWidth="1.8" /></>, tone: "text-muted" },
};

/**
 * RIGHTS MATRIX (C3c): who holds what, in plain words. Rows are the rights, folded by area (each area says « n of total » per role); columns are the roles.
 * Two uses with one component:
 *   - overview: every role is a read-only column (check = allowed, dash = not allowed, lock = cannot be delegated);
 *   - editing one role (`editRoleId`): that column holds real check boxes (`name`, default « right ») that go with the surrounding form; the others stay read-only.
 * Never delegating the reserved: a reserved right (`CORE_RESERVED`, or marked `reserved`) never has a box and never reads « allowed » for a custom role, even if the
 * data says so; built-in preset roles are read-only. It shows counts of people only, never a name. The state is a shape plus a hidden word, never colour alone.
 * Keyboard: the table is ONE tab stop (the first visible cell); arrows move between cells, Home/End to the row ends, Ctrl+Home/End to the column ends; area
 * headers are buttons (Enter or Space folds). Check boxes of a folded area stay in the form (hidden, still sent). Text comes in `labels` (translated by the page).
 */
export function RightsMatrix({ roles, groups, grants, labels, editRoleId = null, name = "right", defaultOpen, testid }: {
  roles: MatrixRole[]; groups: MatrixGroup[]; grants: Record<string, readonly string[]>; labels: RightsMatrixLabels;
  editRoleId?: string | null; name?: string; defaultOpen?: string[]; testid?: string;
}) {
  const sets = useMemo(() => grantSets(roles, groups, grants), [roles, groups, grants]);
  const editRole = roles.find((r) => r.id === editRoleId && !r.system) ?? null;
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(editRole ? editableSelection(groups, [...(sets.get(editRole.id) ?? [])]) : []));
  const [opened, setOpened] = useState<Set<string>>(() => new Set(defaultOpen ?? (groups.length === 1 && groups[0] ? [groups[0].id] : [])));
  const [active, setActive] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);

  // Flat row index of every right, for the keyboard grid.
  const rowIndex = useMemo(() => { const m = new Map<string, number>(); let i = 0; for (const g of groups) for (const r of g.rights) m.set(r.id, i++); return m; }, [groups]);
  const rowCount = rowIndex.size;
  const heldOf = (role: MatrixRole): ReadonlySet<string> => (editRole && role.id === editRole.id ? ticked : sets.get(role.id) ?? new Set());

  // The one tab stop: the active cell if it is visible, else the first cell of the first open area.
  const firstVisible = (() => { for (const g of groups) if (opened.has(g.id) && g.rights[0]) return `${rowIndex.get(g.rights[0].id)}:0`; return null; })();
  const activeVisible = active && (() => { const [r] = active.split(":").map(Number); return groups.some((g) => opened.has(g.id) && g.rights.some((x) => rowIndex.get(x.id) === r)); })();
  const stop = activeVisible ? active : firstVisible;

  const toggleGroup = (id: string) => setOpened((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tick = (id: string, on: boolean) => setTicked((t) => { const n = new Set(t); if (on) n.add(id); else n.delete(id); return n; });

  function onKeyDown(e: React.KeyboardEvent<HTMLTableElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-mx]");
    if (!el) return;
    const [row, col] = el.dataset.mx!.split(":").map(Number) as [number, number];
    const cells = table.current?.querySelectorAll<HTMLElement>("[data-mx]") ?? [];
    const present = new Set<string>();
    for (const c of cells) if (!c.closest("[hidden]")) present.add(c.dataset.mx!);
    const to = moveFocus(e.key, e.ctrlKey || e.metaKey, { row, col }, { rows: rowCount, cols: roles.length }, (r, c) => present.has(`${r}:${c}`));
    if (!to) return;
    e.preventDefault();
    setActive(`${to.row}:${to.col}`);
    table.current?.querySelector<HTMLElement>(`[data-mx="${to.row}:${to.col}"]`)?.focus();
  }

  const people = (n?: number) => (n === undefined ? null : n === 1 ? labels.peopleOne : labels.people.replace("{n}", String(n)));
  const chosen = labels.chosen.replace("{n}", String(ticked.size));

  return (
    <div className="space-y-2" data-rights-matrix="" data-testid={testid ?? "rights-matrix"}>
      {editRole && <p className="sr-only" role="status" aria-live="polite" data-matrix-chosen="">{chosen}</p>}
      <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface">
        <table ref={table} onKeyDown={onKeyDown} className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">{labels.region}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 min-w-48 bg-surface px-4 py-3 text-left font-medium">{labels.corner}</th>
              {roles.map((role) => (
                <th key={role.id} scope="col" data-role={role.id} className="min-w-28 px-3 py-3 text-center align-bottom font-medium">
                  <span className="block break-words">{role.name}</span>
                  {role.system ? <span className="mt-1 block"><StatusPill tone="neutral">{labels.system}</StatusPill></span> : null}
                  {people(role.people) ? <span className="mt-1 block text-xs font-normal text-muted">{people(role.people)}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => {
            const open = opened.has(g.id);
            const panel = `mx-${g.id}`;
            const rowId = (id: string) => `${panel}-${id}`;
            return (
              <tbody key={g.id} data-group={g.id} className="border-t border-line">
                <tr className="bg-bg/40">
                  <th scope="rowgroup" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-medium">
                    <button type="button" aria-expanded={open} aria-controls={g.rights.map((r) => rowId(r.id)).join(" ")} onClick={() => toggleGroup(g.id)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      <span aria-hidden="true" className={`inline-block text-xs text-muted transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                      <span className="min-w-0 flex-1 break-words">{g.title}</span>
                    </button>
                  </th>
                  {roles.map((role) => {
                    const c = groupCount(role, g, heldOf(role));
                    return <td key={role.id} className="px-3 py-1 text-center text-xs text-muted" data-count={role.id}>{labels.count.replace("{n}", String(c.n)).replace("{total}", String(c.total))}</td>;
                  })}
                </tr>
                {g.rights.map((r) => {
                  const row = rowIndex.get(r.id)!;
                  return (
                    <tr key={r.id} id={rowId(r.id)} hidden={!open} data-right={r.id} className="border-t border-line/60">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal">
                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="break-words">{r.label}</span>
                          {r.sensitive && <span className={ui.chipWarn}>{labels.sensitive}</span>}
                          {r.help && <HelpTip help={r.help} name={r.label} always />}
                        </span>
                      </th>
                      {roles.map((role, col) => {
                        const state = cellState(role, r, heldOf(role), editRole?.id ?? null);
                        const key = `${row}:${col}`;
                        const tab = stop === key ? 0 : -1;
                        if (state === "edit") {
                          return (
                            <td key={role.id} className="px-3 py-1 text-center" data-cell="edit">
                              <input type="checkbox" name={name} value={r.id} checked={ticked.has(r.id)} onChange={(e) => tick(r.id, e.currentTarget.checked)} onFocus={() => setActive(key)}
                                data-mx={key} tabIndex={tab} aria-label={labels.cell.replace("{right}", r.label).replace("{role}", role.name)}
                                className="h-5 w-5 align-middle accent-[var(--v-accent)]" />
                            </td>
                          );
                        }
                        const text = state === "yes" ? labels.yes : state === "no" ? labels.no : labels.locked;
                        const icon = ICON[state];
                        return (
                          <td key={role.id} className="px-3 py-1 text-center" data-cell={state}>
                            <span data-mx={key} tabIndex={tab} onFocus={() => setActive(key)} title={text} role="img" aria-label={text}
                              className={`inline-flex h-11 w-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${icon.tone}`}>
                              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" data-matrix-glyph={state}>{icon.glyph}</svg>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
