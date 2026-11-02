/** Durées de l'ouverture d'une fiche d'extension, partagées entre le serveur et l'écran (ce fichier ne dépend de rien d'autre). */
/** Attente maximale de la fiche à l'écran : au-delà, un message clair et « Réessayer » (la lecture continue en coulisse et sert la tentative suivante). */
export const PREVIEW_WAIT_MS = 30_000;
/** Après ce délai sans fiche, l'écran dit que la lecture se poursuit (au lieu de rester muet). */
export const PREVIEW_SLOW_MS = 5_000;
