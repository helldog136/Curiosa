// Mise en page des réglages d'un module sur une fenêtre large : un champ court tient à moitié de ligne (deux colonnes), une adresse, un secret ou un texte long prend toute la ligne. Logique pure.

type LayoutField = { type: string; translatable?: boolean };

/** Types qui s'étalent sur toute la largeur : adresses, secrets, textes longs, médias. */
const WIDE = ["url", "link", "secret", "textarea", "image", "video", "multichoice"];

export type Span = "half" | "full";

/** Un réglage traduisible (une ligne par langue) prend toute la largeur ; sinon cela dépend de son type. */
export function fieldSpan(f: LayoutField): Span {
  return f.translatable || WIDE.includes(f.type) ? "full" : "half";
}

/** Classes Tailwind d'une cellule de la grille des réglages (deux colonnes dès 1100 px de large, une seule en dessous : mobile et fenêtres étroites). */
export const SPAN_CLASS: Record<Span, string> = { half: "min-w-0", full: "min-w-0 min-[1100px]:col-span-2" };
