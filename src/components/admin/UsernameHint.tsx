/**
 * Identifiant du compte, dans un formulaire qui ne demande qu'un mot de passe (changer le sien, en choisir un, confirmer qui l'on est).
 * Sans lui, un gestionnaire de mots de passe ne sait pas QUELLE fiche mettre à jour et peut en créer une nouvelle ou écraser une autre.
 * Le champ est présent dans la page (pas `display:none`, que les gestionnaires ignorent), invisible à l'écran, hors de l'ordre de tabulation
 * et caché des lecteurs d'écran (la personne n'a rien à y faire : l'e-mail est déjà affiché ailleurs sur la page).
 */
export function UsernameHint({ value }: { value: string }) {
  return <input type="text" name="username" autoComplete="username" defaultValue={value} tabIndex={-1} aria-hidden="true" className="sr-only" data-username-hint="" />;
}
