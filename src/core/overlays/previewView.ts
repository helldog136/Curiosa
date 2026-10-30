// Aperçu d'une page d'overlay dans l'éditeur : échelle affichée et placement des libellés des cadres (logique pure, testée).
import type { Size } from "./layout";

/** Hauteur maximale de l'aperçu ajusté, en pixels d'écran : une page en portrait ne doit pas devenir géante. */
export const PREVIEW_MAX_HEIGHT = 640;
/** Facteurs de zoom proposés, relatifs à l'aperçu ajusté (1 = ajusté à la largeur disponible). */
export const ZOOMS = [1, 2, 3] as const;

/** Largeur en pixels d'écran de l'aperçu ajusté : toute la largeur disponible, sauf si la hauteur dépasserait `maxHeight`. */
export function fitWidth(available: number, page: Size, maxHeight = PREVIEW_MAX_HEIGHT): number {
  if (!(available > 0) || !(page.width > 0) || !(page.height > 0)) return 0;
  return Math.min(available, (maxHeight * page.width) / page.height);
}

/** Échelle (pixels d'écran par pixel de page) et son pourcentage arrondi, jamais inférieur à 1 %. */
export function previewScale(available: number, page: Size, zoom = 1, maxHeight = PREVIEW_MAX_HEIGHT): { scale: number; percent: number; width: number; height: number } {
  const width = fitWidth(available, page, maxHeight) * zoom;
  const scale = page.width > 0 ? width / page.width : 0;
  return { scale, percent: width > 0 ? Math.max(1, Math.round(scale * 100)) : 0, width, height: scale * page.height };
}

/** tl, tr, bl, br : dans un coin du cadre. ot, ob : hors du cadre (au-dessus, au-dessous), pour les cadres trop petits pour porter leur libellé. */
export type LabelCorner = "tl" | "tr" | "bl" | "br" | "ot" | "ob";
export type LabelFrame = { uid: string; x: number; y: number; w: number; h: number; text: string };
export type PlacedLabel = { uid: string; corner: LabelCorner; width: number; height: number; x: number; y: number };

export const LABEL_HEIGHT = 18;
/** Écart entre un libellé placé hors du cadre et le cadre : laisse la place des poignées. */
export const OUTSIDE_GAP = 12;
/** Un cadre plus étroit ou plus bas que cela (en pixels d'écran) porte son libellé à l'extérieur. */
export const SMALL_W = 110;
export const SMALL_H = 2.5 * LABEL_HEIGHT;
/** Largeur maximale d'un libellé placé hors du cadre. */
export const OUTSIDE_MAX = 280;
/** Largeur estimée d'un libellé (police de 11 px en gras + marges), plafonnée à `max`. */
export const labelWidth = (text: string, max: number): number => Math.max(0, Math.min(max, Math.ceil(text.length * 6.4 + 14)));
export const isSmallFrame = (f: Pick<LabelFrame, "w" | "h">): boolean => f.w < SMALL_W || f.h < SMALL_H;

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * Place le libellé de chaque cadre (coordonnées d'écran, relatives à l'aperçu) de façon que deux libellés ne se chevauchent pas : dans un des quatre coins du cadre,
 * ou, si le cadre est trop petit, juste au-dessus ou au-dessous. Les cadres sont donnés du fond vers le devant : le devant choisit en premier.
 * `bounds` (taille de l'aperçu) écarte les places qui sortiraient de l'aperçu. À défaut de place libre, on garde celle qui en recouvre le moins.
 */
export function placeLabels(frames: LabelFrame[], bounds?: { width: number; height: number }, height = LABEL_HEIGHT): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const out = new Map<string, PlacedLabel>();
  for (const f of [...frames].reverse()) {
    let spots: [LabelCorner, number, number, number][];   // coin, x, y, largeur
    if (isSmallFrame(f)) {
      const width = labelWidth(f.text, OUTSIDE_MAX);
      spots = [["ot", f.x, f.y - height - OUTSIDE_GAP, width], ["ob", f.x, f.y + f.h + OUTSIDE_GAP, width], ["ot", f.x + f.w - width, f.y - height - OUTSIDE_GAP, width], ["ob", f.x + f.w - width, f.y + f.h + OUTSIDE_GAP, width]];
    } else {
      const width = labelWidth(f.text, f.w);
      spots = [["tl", f.x, f.y, width], ["tr", f.x + f.w - width, f.y, width], ["bl", f.x, f.y + f.h - height, width], ["br", f.x + f.w - width, f.y + f.h - height, width]];
    }
    let best: PlacedLabel | null = null, bestCost = Infinity;
    for (const [corner, x, y, width] of spots) {
      const cand = { uid: f.uid, corner, width, height, x, y };
      const outside = bounds && (x < -1 || y < -1 || x + width > bounds.width + 1 || y + height > bounds.height + 1) ? 1e9 : 0;
      const cost = outside + placed.reduce((sum, p) => sum + overlap(cand, p), 0);
      if (cost < bestCost) { best = cand; bestCost = cost; if (cost === 0) break; }
    }
    const chosen = best!;
    placed.push(chosen); out.set(f.uid, chosen);
  }
  return frames.map((f) => out.get(f.uid)!);
}
