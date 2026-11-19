/** Le bloc `table` enrichi (pur, testé sans navigateur) : quand un tableau est « enrichi », et quelles actions de ligne restent visibles. */
import type { Block, TableCell } from "../blocks";

type TableBlock = Extract<Block, { type: "table" }>;

/** Un tableau est « enrichi » (cartes sur téléphone, pagination, menu…) dès qu'il utilise l'une des clés de la 0.6.0 ; sinon le rendu est celui d'avant, à l'identique. */
export function isEnhancedTable(block: TableBlock): boolean {
  return Boolean(block.searchable) || (block.filters?.length ?? 0) > 0 || (block.truncate?.length ?? 0) > 0 || block.pageSize !== undefined || block.empty !== undefined
    || (block.rowActions ?? []).some((a) => a.inMenu) || block.rows.some((r) => r.some((c) => typeof c === "object" && c !== null));
}

/** Nombre d'actions de ligne visibles à la fois (règle R16) : les autres vont dans le menu « ⋯ ». */
export const VISIBLE_ACTIONS = 2;

/** Les actions visibles (2 au plus) et celles du menu « ⋯ » : `inMenu` et `danger` y vont toujours, les suivantes aussi. */
export function splitActions<T extends { inMenu?: boolean; danger?: boolean }>(actions: T[], visibleMax = VISIBLE_ACTIONS): { visible: T[]; menu: T[] } {
  const visible: T[] = [], menu: T[] = [];
  for (const a of actions) (a.inMenu || a.danger || visible.length >= visibleMax ? menu : visible).push(a);
  return { visible, menu };
}

/** Le texte d'une cellule (pour la recherche, les tests et les lecteurs d'écran). */
export const cellText = (c: TableCell | undefined): string => (typeof c === "string" ? c : c?.text ?? (c?.switch ? c.switch.label : c?.image?.alt ?? ""));

/** Server search (`searchable: "server"`, core 0.38.0): delay after the last keystroke before the page is asked again. */
export const SERVER_SEARCH_DELAY_MS = 250;
/** Longest search text sent to the module. */
export const SERVER_SEARCH_MAX = 80;
const PARAM_RE = /^[A-Za-z0-9_.-]{1,60}$/;

/** The address parameter of a server search and the parameters dropped when it changes (the module's own paging), validated: a module cannot aim the search at another parameter shape. */
export function serverSearchParams(block: Pick<TableBlock, "searchable" | "searchParam" | "searchReset">): { param: string; reset: string[] } | null {
  if (block.searchable !== "server") return null;
  const param = typeof block.searchParam === "string" && PARAM_RE.test(block.searchParam) ? block.searchParam : "q";
  const reset = (Array.isArray(block.searchReset) ? block.searchReset : ["page"]).filter((r): r is string => typeof r === "string" && PARAM_RE.test(r)).slice(0, 8);
  return { param, reset };
}

/** The admin address after a search: the same page, `param` replaced by the trimmed text (removed when empty), the paging parameters dropped, everything else kept. */
export function serverSearchTarget(current: string, param: string, text: string, reset: readonly string[] = ["page"]): string {
  const url = new URL(current, "http://local.invalid");
  for (const r of reset) url.searchParams.delete(r);
  const q = text.trim().slice(0, SERVER_SEARCH_MAX);
  if (q) url.searchParams.set(param, q); else url.searchParams.delete(param);
  return url.pathname + url.search;
}
