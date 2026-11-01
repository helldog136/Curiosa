/** Le bloc `table` enrichi (pur, testé sans navigateur) : quand un tableau est « enrichi », et quelles actions de ligne restent visibles. */
import type { Block, TableCell } from "../blocks";

type TableBlock = Extract<Block, { type: "table" }>;

/** Un tableau est « enrichi » (cartes sur téléphone, pagination, menu…) dès qu'il utilise l'une des clés de la 0.6.0 ; sinon le rendu est celui d'avant, à l'identique. */
export function isEnhancedTable(block: TableBlock): boolean {
  return block.searchable === true || (block.filters?.length ?? 0) > 0 || (block.truncate?.length ?? 0) > 0 || block.pageSize !== undefined || block.empty !== undefined
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
export const cellText = (c: TableCell | undefined): string => (typeof c === "string" ? c : c?.text ?? (c?.switch ? c.switch.label : ""));
