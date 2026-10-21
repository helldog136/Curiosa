/**
 * « Montre-moi cet élément » : un élément caché dans un onglet inactif (champ à remplir, ancre) demande à être affiché. L'événement remonte jusqu'aux onglets
 * de la page (PageTabs) qui ouvrent le bon onglet, de façon synchrone : juste après l'appel, l'élément est visible et peut recevoir le focus.
 */
export const REVEAL_EVENT = "curiosa:reveal";

export function reveal(el: Element): void {
  el.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
  const fold = el.closest("details");
  if (fold && !fold.open) fold.open = true;
}
