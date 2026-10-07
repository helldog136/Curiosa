import { sectionsOf, type ActiveInstance } from "@/core/modules/registry";
import { SECTION_SIZES, type SectionSize } from "@/core/modules/types";
import type { HomeSection } from "@/core/settings";

/**
 * ACCUEIL FLUIDE. Pas de colonnes ni de lignes à régler : les morceaux proposés par les modules s'écoulent dans l'ordre
 * choisi par l'administrateur, à la ligne quand la place manque, comme du texte. Chacun a seulement une taille naturelle :
 *
 *   small   un petit encart (un code, le prochain stream)
 *   medium  une carte
 *   large   un morceau qui aime la place (planning de la semaine)
 *   full    toute la largeur (bandeau d'accueil, liste)
 *
 * Plusieurs petits morceaux se rangent côte à côte et s'étirent pour remplir la ligne ; sur un téléphone tout s'empile.
 * La hauteur est toujours celle du contenu. Les règles CSS sont statiques (globals.css, classes `vh-flow`, `vh-<taille>`).
 */
export const isSectionSize = (v: unknown): v is SectionSize => (SECTION_SIZES as readonly unknown[]).includes(v);

/** Taille d'un morceau : le choix de l'admin, sinon la recommandation du module, sinon pleine largeur. */
export function resolveSize(section: Pick<HomeSection, "size">, recommended?: SectionSize): SectionSize {
  if (isSectionSize(section.size)) return section.size;
  return isSectionSize(recommended) ? recommended : "full";
}

/** Taille de chaque placement de l'accueil, selon les modules actifs. */
export function homeLayout(sections: HomeSection[], active: ActiveInstance[]): { section: HomeSection; size: SectionSize }[] {
  return sections.map((section) => {
    const target = active.find((a) => a.instance.key === section.instance);
    const decl = target ? sectionsOf(target.mod.manifest).find((s) => s.id === section.section) : undefined;
    return { section, size: resolveSize(section, decl?.size) };
  });
}
