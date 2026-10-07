import { sectionsOf, type ActiveInstance } from "@/core/modules/registry";
import type { HomeSection } from "@/core/settings";

/**
 * GRILLE DE L'ACCUEIL. Le cœur place les morceaux proposés par les modules sur une grille de `columns` colonnes
 * au plus ; chaque morceau occupe `w` × `h` cases. Le rendu fait de son mieux : sur un écran étroit il affiche
 * MOINS de colonnes (jusqu'à une seule, tout s'empile), et un morceau plus large que la grille prend toute la largeur.
 */
export const MAX_COLUMNS = 12;
export const MAX_ROWS = 6;
/** Largeur d'écran minimale (px) pour afficher `c` colonnes ; en dessous, on en affiche moins. */
export const columnBreakpoint = (c: number) => (c <= 1 ? 0 : c * 230);

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Taille d'un morceau : celle choisie dans l'admin, sinon la recommandation du module, sinon toute la largeur. */
export function resolveSize(section: Pick<HomeSection, "w" | "h">, recommended?: { w: number; h?: number }): { w: number; h: number } {
  return {
    w: clamp(section.w, 1, MAX_COLUMNS, clamp(recommended?.w, 1, MAX_COLUMNS, MAX_COLUMNS)),
    h: clamp(section.h, 1, MAX_ROWS, clamp(recommended?.h, 1, MAX_ROWS, 1)),
  };
}

/** Taille de chaque placement de l'accueil, selon les modules actifs. */
export function homeLayout(sections: HomeSection[], active: ActiveInstance[]): { section: HomeSection; w: number; h: number }[] {
  return sections.map((section) => {
    const target = active.find((a) => a.instance.key === section.instance);
    const decl = target ? sectionsOf(target.mod.manifest).find((s) => s.id === section.section) : undefined;
    return { section, ...resolveSize(section, decl?.size) };
  });
}

/**
 * CSS de la grille. Uniquement des nombres que l'on a calculés (jamais de texte d'un module) : sûr à injecter.
 * Mobile d'abord : une colonne ; puis, à chaque palier, une colonne de plus jusqu'au maximum réglé.
 * Un morceau couvre `min(w, colonnes affichées)` colonnes ; sa hauteur (en cases) ne s'applique qu'à partir de 2 colonnes.
 */
export function homeGridCss(columns: number, cells: { w: number; h: number }[]): string {
  const max = clamp(columns, 1, MAX_COLUMNS, 4);
  const rules = [".vh-grid{display:grid;gap:1.5rem;grid-template-columns:minmax(0,1fr)}.vh-cell{min-width:0}"];
  for (let c = 2; c <= max; c++) {
    const spans = cells.map((cell, i) => `.vh-s${i}{grid-column:span ${Math.min(cell.w, c)};grid-row:span ${cell.h}}`).join("");
    rules.push(`@media(min-width:${columnBreakpoint(c)}px){.vh-grid{grid-template-columns:repeat(${c},minmax(0,1fr));grid-auto-rows:minmax(7rem,auto)}${spans}}`);
  }
  return rules.join("\n");
}
