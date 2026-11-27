/**
 * RIGHTS MATRIX, pure part (C3c). What each cell of the matrix says, computed from data only: no database, no React.
 *
 * Rules that live here and nowhere else (the component only draws the result):
 *  - a reserved right (`CORE_RESERVED`, or a right the catalogue marks `reserved`) is NEVER grantable: for a custom role its cell is always "locked", whatever the
 *    grants say (a forged or stale grant is not shown as held); only a built-in preset role (`system`) can show it as held;
 *  - a built-in preset role is read-only: its cells are never editable;
 *  - only the one role being edited (`editRoleId`, not a preset) has editable cells, and only for rights that are not reserved;
 *  - the matrix carries counts of people at most (`people`), never a name or an address.
 */
import { isReserved } from "@/core/auth/rights";

export type MatrixRole = { id: string; name: string; /** Built-in preset: read-only. */ system?: boolean; /** Number of people holding the role (a number only: no names). */ people?: number };
export type MatrixRight = { id: string; label: string; help?: string; sensitive?: boolean; reserved?: boolean };
export type MatrixGroup = { id: string; title: string; rights: MatrixRight[] };
export type CellState = "yes" | "no" | "locked" | "edit";

export const rightIsReserved = (r: Pick<MatrixRight, "id" | "reserved">): boolean => r.reserved === true || isReserved(r.id);

/** The state of one cell. `held` is what the role holds today (or, for the edited role, what is ticked now). */
export function cellState(role: MatrixRole, right: MatrixRight, held: ReadonlySet<string>, editRoleId?: string | null): CellState {
  const reserved = rightIsReserved(right);
  if (reserved) return role.system && held.has(right.id) ? "yes" : "locked";
  if (editRoleId && role.id === editRoleId && !role.system) return "edit";
  return held.has(right.id) ? "yes" : "no";
}

/** « n of total » for one role in one group: the total leaves out the rights a custom role can never hold. */
export function groupCount(role: MatrixRole, group: MatrixGroup, held: ReadonlySet<string>): { n: number; total: number } {
  let n = 0, total = 0;
  for (const r of group.rights) {
    if (rightIsReserved(r) && !role.system) continue;
    total++;
    if (held.has(r.id)) n++;
  }
  return { n, total };
}

/** The rights of the edited role that may be sent with the form: never a reserved one, never one the matrix does not list. */
export function editableSelection(groups: MatrixGroup[], selected: readonly string[]): string[] {
  const ok = new Set<string>();
  for (const g of groups) for (const r of g.rights) if (!rightIsReserved(r)) ok.add(r.id);
  return [...new Set(selected)].filter((id) => ok.has(id));
}

/** The grants of every role as sets; a custom role never keeps a reserved right, even if the data says so. */
export function grantSets(roles: MatrixRole[], groups: MatrixGroup[], grants: Record<string, readonly string[]>): Map<string, Set<string>> {
  const known = new Set<string>();
  const reserved = new Set<string>();
  for (const g of groups) for (const r of g.rights) { known.add(r.id); if (rightIsReserved(r)) reserved.add(r.id); }
  const out = new Map<string, Set<string>>();
  for (const role of roles) {
    const set = new Set<string>();
    for (const id of grants[role.id] ?? []) if (known.has(id) && (role.system || !reserved.has(id))) set.add(id);
    out.set(role.id, set);
  }
  return out;
}

/** Grid moves for the keyboard: from (row, col) with a key, among the cells that exist (`has(row, col)`). Returns null when the key is not a move. */
export function moveFocus(key: string, ctrl: boolean, at: { row: number; col: number }, size: { rows: number; cols: number }, has: (row: number, col: number) => boolean): { row: number; col: number } | null {
  const { row, col } = at;
  const scan = (dr: number, dc: number): { row: number; col: number } | null => {
    for (let r = row + dr, c = col + dc; r >= 0 && r < size.rows && c >= 0 && c < size.cols; r += dr, c += dc) if (has(r, c)) return { row: r, col: c };
    return null;
  };
  switch (key) {
    case "ArrowUp": return scan(-1, 0);
    case "ArrowDown": return scan(1, 0);
    case "ArrowLeft": return scan(0, -1);
    case "ArrowRight": return scan(0, 1);
    case "Home": if (ctrl) { for (let r = 0; r < size.rows; r++) if (has(r, col)) return { row: r, col }; return null; } for (let c = 0; c < size.cols; c++) if (has(row, c)) return { row, col: c }; return null;
    case "End": if (ctrl) { for (let r = size.rows - 1; r >= 0; r--) if (has(r, col)) return { row: r, col }; return null; } for (let c = size.cols - 1; c >= 0; c--) if (has(row, c)) return { row, col: c }; return null;
    default: return null;
  }
}
