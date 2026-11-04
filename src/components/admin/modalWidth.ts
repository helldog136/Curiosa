// Largeur de la fenêtre des routes interceptées. Constantes pures, testées telles quelles.

/**
 * Largeur de la fenêtre (à partir de la taille « sm » ; sur mobile elle prend tout l'écran) : elle suit la fenêtre du navigateur avec de fines marges (94 % de la largeur), plafonnée pour garder des lignes lisibles.
 * « form » : formulaire de modification ouvert depuis une liste (640 px au plus : une colonne de champs) ;
 * « wide » : réglages d'une extension (formulaires en deux colonnes, jusqu'à 1280 px) ; « medium » : fiche du catalogue, surtout du texte à lire (960 px au plus).
 */
export const MODAL_WIDTH = { wide: "sm:max-w-[min(94vw,1280px)]", medium: "sm:max-w-[min(94vw,960px)]", form: "sm:max-w-[min(94vw,640px)]" } as const;
export type ModalSize = keyof typeof MODAL_WIDTH;

