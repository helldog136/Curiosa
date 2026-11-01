import { searchText } from "@/core/adminkit/search";

/**
 * TABLEAU DE LIGNES pour les pages du cœur (Équipe, Rôles) : un seul tableau, des lignes de même hauteur, des colonnes qui disent ce qui distingue chaque ligne
 * (règles R14, R16, R30). Composant serveur : il pose les attributs lus par `LiveSearch` (mode page) — `data-live-item`, `data-search` et `data-live-<clé>` pour les
 * pastilles de filtre — et ne contient aucun script. Sous 640 px chaque ligne devient une carte (rien ne déborde, R27) ; le texte trop long est coupé avec « … »
 * et complet dans l'info-bulle (`title`).
 */
export type RowColumn = { key: string; label: string; /** Largeur sur grand écran (classe Tailwind, ex. « w-[28%] »). */ width?: string; /** Colonne vide sur la plupart des lignes : masquée de la carte quand elle est vide. */ optional?: boolean };
export type TableRow = {
  key: string;
  /** Tout ce qu'on veut pouvoir retrouver (nom, e-mail, rôle…). */
  search: (string | number | null | undefined | false)[];
  /** Valeurs des pastilles de filtre : { role: "editor" }. */
  filters?: Record<string, string>;
  /** Une case par colonne, sous la clé de la colonne ; `null` ou absente = vide. */
  cells: Record<string, React.ReactNode>;
  /** Texte brut par colonne pour l'info-bulle des textes coupés (facultatif). */
  titles?: Record<string, string | undefined>;
  /** Les actions de la ligne (au plus deux visibles), alignées à droite. */
  actions?: React.ReactNode;
  testid?: string;
};

export function RowTable({ scope, columns, rows, actionsLabel, testid }: { scope: string; columns: RowColumn[]; rows: TableRow[]; actionsLabel: string; testid?: string }) {
  const hasActions = rows.some((r) => r.actions);
  return (
    <div className="relative max-sm:overflow-x-auto sm:overflow-x-clip">
    <table role="table" className="w-full text-left text-sm max-sm:block sm:table-fixed" data-testid={testid}>
      <thead role="rowgroup" className="text-muted max-sm:sr-only">
        <tr role="row">
          {columns.map((c) => <th key={c.key} role="columnheader" scope="col" className={`px-3 py-2 font-medium ${c.width ?? ""}`}>{c.label}</th>)}
          {hasActions && <th role="columnheader" scope="col" className="w-[15.5rem] px-3 py-2"><span className="sr-only">{actionsLabel}</span></th>}
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-sm:block">
        {rows.map((r) => {
          const filterAttrs = Object.fromEntries(Object.entries(r.filters ?? {}).map(([k, v]) => [`data-live-${k}`, v]));
          return (
            <tr key={r.key} role="row" data-live-item={scope} data-search={searchText(r.search)} {...filterAttrs} data-testid={r.testid}
              className="border-t border-line align-middle [&[hidden]]:hidden! max-sm:mb-3 max-sm:block max-sm:rounded-2xl max-sm:border max-sm:bg-surface max-sm:p-3 max-sm:first:border-t">
              {columns.map((c) => {
                const cell = r.cells[c.key];
                if (c.optional && (cell === null || cell === undefined || cell === false)) return <td key={c.key} role="cell" className="px-3 py-2 max-sm:hidden" />;
                return (
                  <td key={c.key} role="cell" data-label={c.label} title={r.titles?.[c.key]}
                    className="min-w-0 px-3 py-2.5 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1 max-sm:py-1.5 max-sm:before:shrink-0 max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)] max-sm:first:block max-sm:first:before:hidden">
                    <div className="min-w-0 max-sm:text-right max-sm:first:text-left">{cell}</div>
                  </td>
                );
              })}
              {hasActions && (
                <td role="cell" className={`px-3 py-2 max-sm:flex max-sm:justify-end max-sm:px-1 max-sm:pt-2 ${r.actions ? "" : "max-sm:hidden"}`}>
                  <div className="flex min-h-11 items-center justify-end gap-2">{r.actions}</div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
