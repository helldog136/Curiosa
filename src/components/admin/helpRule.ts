/**
 * Aide d'un champ d'administration : règle de présentation et logique du bouton « ? » (pur, testé sans navigateur).
 *
 * RÈGLE (une seule, ici) : une aide COURTE (60 caractères au plus, sur une seule ligne) reste affichée sous le champ ; une aide plus longue devient un bouton « ? »
 * à côté du libellé, qui ouvre une bulle. Les « Exemple : 500 » tiennent donc sous le champ. Les MESSAGES D'ERREUR ne passent jamais par ici : ils restent toujours
 * visibles sous leur champ (components/admin/FieldErrors.tsx).
 */
export const HELP_INLINE_MAX = 60;

/** Largeur maximale de la bulle (px) ; elle ne dépasse jamais l'écran (voir `placeBubble`). */
export const HELP_BUBBLE_MAX_WIDTH = 320;
/** Marge minimale entre la bulle et le bord de l'écran (px). */
export const HELP_BUBBLE_MARGIN = 8;

/** L'aide est-elle trop longue pour rester sous le champ ? (Vide ou absente : non, il n'y a rien à montrer.) */
export function isLongHelp(help: string | null | undefined): boolean {
  const text = (help ?? "").trim();
  if (!text) return false;
  return Array.from(text).length > HELP_INLINE_MAX || /[\r\n]/.test(text);
}

/** Le texte de l'aide : jamais de HTML (affiché comme texte par React), espaces superflus retirés. */
export const helpText = (help: string): string => help.trim();

/** « Aide : {name} » (modèle traduit) pour le libellé accessible du bouton. */
export const helpAriaLabel = (template: string, name: string): string => template.replaceAll("{name}", name);

/* ───────────── état du bouton ───────────── */

export type TipState = { open: boolean; pinned: boolean };
export type TipEvent = "mouseEnter" | "mouseLeave" | "keyboardFocus" | "blur" | "click" | "escape" | "outside";
export const TIP_CLOSED: TipState = { open: false, pinned: false };

/**
 * Souris : le survol ouvre, la sortie ferme (sauf si un clic l'a « épinglée »). Clavier : le focus ouvre, la perte du focus ferme. Toucher (pas de survol) : un appui
 * ouvre, un second ferme ; un appui ailleurs ou Échap ferme. Un clic (ou Entrée / Espace) sur une bulle épinglée la ferme.
 */
export function tipReducer(s: TipState, e: TipEvent): TipState {
  switch (e) {
    case "mouseEnter": return s.open ? s : { ...s, open: true };
    case "mouseLeave": return s.pinned ? s : TIP_CLOSED;
    case "keyboardFocus": return s.open ? s : { ...s, open: true };
    case "click": return s.open && s.pinned ? TIP_CLOSED : { open: true, pinned: true };
    case "blur": case "escape": case "outside": return s.open || s.pinned ? TIP_CLOSED : s;
  }
}

/* ───────────── position de la bulle ───────────── */

export type Box = { left: number; top: number; width: number; height: number };

/**
 * Où poser la bulle (position fixe, en px de la fenêtre) : sous le bouton, alignée sur son bord gauche, ramenée dans l'écran ; au-dessus s'il n'y a pas la place en bas.
 * La largeur est bornée (320 px, et jamais plus que l'écran moins les marges).
 */
export function placeBubble(anchor: Box, bubble: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number; maxWidth: number } {
  const m = HELP_BUBBLE_MARGIN;
  const maxWidth = Math.max(0, Math.min(HELP_BUBBLE_MAX_WIDTH, viewport.width - 2 * m));
  const width = Math.min(bubble.width, maxWidth);
  const left = Math.max(m, Math.min(anchor.left, viewport.width - width - m));
  const below = anchor.top + anchor.height;
  const fitsBelow = below + bubble.height + m <= viewport.height;
  const above = anchor.top - bubble.height;
  const top = fitsBelow || above < m ? below : above;
  return { left, top, maxWidth };
}
