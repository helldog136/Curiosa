import type { OverlayElementDecl } from "./decl";

/** Ce que la géométrie lit d'une déclaration (le navigateur reçoit exactement ceci). */
export type LayoutDecl = Pick<OverlayElementDecl, "fit" | "size" | "referenceHeight" | "ratios" | "minSize">;

/**
 * GÉOMÉTRIE des éléments d'une page d'overlay (pur, testé en unitaire) : contraintes des trois comportements, échelle de rendu, aimant, ancrages.
 * Les mêmes fonctions servent l'éditeur (navigateur), le serveur (qui ne croit jamais le navigateur) et la page de rendu : ce qu'on voit est ce qui est enregistré.
 *
 *  - scale : taille naturelle déclarée, mise à l'échelle comme une image (ratio verrouillé).
 *  - ratio : fenêtre virtuelle de hauteur `referenceHeight` dont la largeur suit le ratio du cadre (dans la plage déclarée), puis mise à l'échelle.
 *  - fluid : fenêtre aux dimensions réelles du cadre (jamais plus petite que la taille minimale : sinon mise à l'échelle).
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { width: number; height: number };
export const MIN_FRAME = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rapport largeur/hauteur imposé (scale) ou null. */
export const aspectOf = (d: Pick<LayoutDecl, "fit" | "size">): number | null => (d.fit === "scale" && d.size ? d.size.width / d.size.height : null);
/** Le ratio du cadre est-il verrouillé pendant un redimensionnement à la poignée ? (scale et ratio : oui ; fluid : non). */
export const lockedByHandles = (d: Pick<LayoutDecl, "fit">): boolean => d.fit !== "fluid";

/**
 * Ramène un cadre à ce que le comportement permet. `keep` : la dimension que la personne vient de saisir (l'autre s'en déduit).
 * Pour scale : ratio imposé. Pour ratio / fluid : ratio ramené dans la plage, taille minimale respectée (agrandissement uniforme), puis le tout rentre dans la page.
 */
export function constrainRect(d: LayoutDecl, rect: Rect, page: Size, keep: "w" | "h" = "w"): Rect {
  let w = Number.isFinite(rect.w) ? rect.w : MIN_FRAME * 10;
  let h = Number.isFinite(rect.h) ? rect.h : MIN_FRAME * 10;
  w = Math.max(MIN_FRAME, w); h = Math.max(MIN_FRAME, h);
  const a = aspectOf(d);
  if (a) {
    if (keep === "h") w = h * a; else h = w / a;
    const f = Math.min(1, page.width / w, page.height / h);
    w *= f; h *= f;
    if (w < MIN_FRAME) { w = MIN_FRAME; h = w / a; }
    w = Math.round(w); h = Math.max(1, Math.round(w / a));
  } else {
    const range = d.ratios;
    const min = d.minSize;
    if (range) {
      const r = clamp(w / h, range.min, range.max);
      if (keep === "h") w = h * r; else h = w / r;
      if (min) { const up = Math.max(1, min.width / w, min.height / h); w *= up; h *= up; }
      const down = Math.min(1, page.width / w, page.height / h);
      w *= down; h *= down;
    } else {
      if (min) { w = Math.max(w, min.width); h = Math.max(h, min.height); }
      w = Math.min(w, page.width); h = Math.min(h, page.height);
    }
    w = Math.round(w); h = Math.round(h);
  }
  w = Math.min(w, page.width); h = Math.min(h, page.height);
  const x0 = Number.isFinite(rect.x) ? rect.x : 0, y0 = Number.isFinite(rect.y) ? rect.y : 0;
  return { x: Math.round(clamp(x0, 0, page.width - w)), y: Math.round(clamp(y0, 0, page.height - h)), w, h };
}

/** Taille et position de l'iframe à l'intérieur du cadre, et échelle à appliquer (transform: scale). */
export type FrameLayout = { iframeW: number; iframeH: number; scale: number; offsetX: number; offsetY: number; boxW: number; boxH: number };

export function frameLayout(d: LayoutDecl, rect: Pick<Rect, "w" | "h">): FrameLayout {
  const w = Math.max(1, rect.w), h = Math.max(1, rect.h);
  let iw: number, ih: number, s: number;
  if (d.fit === "scale" && d.size) {
    iw = d.size.width; ih = d.size.height;
    s = Math.min(w / iw, h / ih);
  } else if (d.fit === "ratio" && d.referenceHeight && d.ratios) {
    const r = clamp(w / h, d.ratios.min, d.ratios.max);
    ih = d.referenceHeight; iw = Math.round(ih * r);
    s = Math.min(w / iw, h / ih);
  } else {
    iw = w; ih = h;
    if (d.ratios) {
      const r = w / h;
      if (r > d.ratios.max) iw = h * d.ratios.max; else if (r < d.ratios.min) ih = w / d.ratios.min;
    }
    iw = Math.round(iw); ih = Math.round(ih);
    if (d.minSize) { iw = Math.max(iw, d.minSize.width); ih = Math.max(ih, d.minSize.height); }
    s = Math.min(1, w / iw, h / ih);
  }
  s = Math.round(s * 10000) / 10000;
  const boxW = r2(iw * s), boxH = r2(ih * s);
  return { iframeW: iw, iframeH: ih, scale: s, offsetX: r2((w - boxW) / 2), offsetY: r2((h - boxH) / 2), boxW, boxH };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
/** Poignées proposées : les quatre coins quand le ratio est verrouillé, les huit pour un élément libre. */
export const handlesFor = (d: Pick<LayoutDecl, "fit">): Handle[] => (lockedByHandles(d) ? ["nw", "ne", "sw", "se"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

/** Nouveau cadre pendant le glisser d'une poignée (le bord opposé reste en place). */
export function resizeRect(d: LayoutDecl, start: Rect, handle: Handle, dx: number, dy: number, page: Size): Rect {
  const west = handle.includes("w"), east = handle.includes("e"), north = handle.includes("n"), south = handle.includes("s");
  let w = start.w + (east ? dx : west ? -dx : 0);
  let h = start.h + (south ? dy : north ? -dy : 0);
  let keep: "w" | "h" = "w";
  if (lockedByHandles(d)) {
    const ratio = start.w / start.h;
    // Le coin suit l'axe où la souris a le plus bougé (en proportion).
    if (Math.abs(dy) / start.h > Math.abs(dx) / start.w && (north || south)) { h = start.h + (south ? dy : -dy); w = h * ratio; keep = "h"; } else { h = w / ratio; }
  } else if (!east && !west) keep = "h";
  const size = constrainRect(d, { x: start.x, y: start.y, w, h }, page, keep);
  const x = west ? start.x + start.w - size.w : east ? start.x : start.x + (start.w - size.w) / 2;
  const y = north ? start.y + start.h - size.h : south ? start.y : start.y + (start.h - size.h) / 2;
  return { ...size, x: Math.round(clamp(x, 0, page.width - size.w)), y: Math.round(clamp(y, 0, page.height - size.h)) };
}

export type Guide = { axis: "x" | "y"; at: number };
/** Aimant léger : bords et centre de la page, à `threshold` pixels de la page au plus. */
export function snapMove(rect: Rect, page: Size, threshold: number): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = [];
  let { x, y } = rect;
  const tryAxis = (value: number, size: number, total: number, axis: "x" | "y"): number => {
    const cands: [number, number][] = [[0, 0], [total - size, total], [(total - size) / 2, total / 2]];
    let best: [number, number] | null = null;
    for (const c of cands) if (Math.abs(value - c[0]) <= threshold && (!best || Math.abs(value - c[0]) < Math.abs(value - best[0]))) best = c;
    if (!best) return value;
    guides.push({ axis, at: best[1] });
    return Math.round(best[0]);
  };
  x = tryAxis(x, rect.w, page.width, "x");
  y = tryAxis(y, rect.h, page.height, "y");
  return { rect: { ...rect, x: Math.round(clamp(x, 0, page.width - rect.w)), y: Math.round(clamp(y, 0, page.height - rect.h)) }, guides };
}

export const ANCHORS = ["tl", "tc", "tr", "ml", "c", "mr", "bl", "bc", "br"] as const;
export type Anchor = (typeof ANCHORS)[number];
export const MAX_MARGIN = 400;
/** Place le cadre contre un bord, un coin ou au centre, avec une marge (en pixels de la page) contre les bords touchés. */
export function anchorRect(rect: Rect, anchor: Anchor, page: Size, margin: number): Rect {
  const m = Math.round(clamp(Number.isFinite(margin) ? margin : 0, 0, MAX_MARGIN));
  // Premier caractère : verticale (t haut, m milieu, b bas) ; second : horizontale (l gauche, c milieu, r droite) ; « c » seul : le centre.
  const v = anchor === "c" ? "m" : anchor[0];
  const hz = anchor === "c" ? "c" : anchor[1];
  const x = hz === "l" ? m : hz === "r" ? page.width - rect.w - m : (page.width - rect.w) / 2;
  const y = v === "t" ? m : v === "b" ? page.height - rect.h - m : (page.height - rect.h) / 2;
  return { ...rect, x: Math.round(clamp(x, 0, page.width - rect.w)), y: Math.round(clamp(y, 0, page.height - rect.h)) };
}

/** Premier cadre d'un élément qu'on vient d'ajouter : à une taille raisonnable pour la page, décalé des cadres déjà posés. */
export function defaultRect(d: LayoutDecl, page: Size, placed: number): Rect {
  const shift = (placed % 8) * 24;
  if (d.fit === "scale" && d.size) {
    const f = page.height / 1080;
    return constrainRect(d, { x: 24 + shift, y: 24 + shift, w: d.size.width * f, h: d.size.height * f }, page);
  }
  if (d.fit === "ratio") return constrainRect(d, { x: 0, y: 0, w: page.width, h: page.height }, page, "h");
  return constrainRect(d, { x: 24 + shift, y: 24 + shift, w: page.width * 0.4, h: page.height * 0.5 }, page);
}

/** Changement de résolution : positions proportionnelles à chaque axe, tailles à l'échelle commune (les formes ne se déforment pas). Le résultat est ensuite ramené par `constrainRect`. */
export function rescaleRect(rect: Rect, from: Size, to: Size): Rect {
  const f = Math.min(to.width / from.width, to.height / from.height);
  return { x: rect.x * (to.width / from.width), y: rect.y * (to.height / from.height), w: rect.w * f, h: rect.h * f };
}
