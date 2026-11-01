/**
 * RÈGLES DE L'ÉQUIPE (0.4.0) : qui peut gérer qui. Logique pure, testée ; roles.ts, teamPassword.ts et les actions de la page Équipe l'appellent.
 *
 * Hiérarchie : owner > coordinator > admin > editor. Ce que chaque niveau détient comme droits réservés se lit dans `LEVEL_RESERVED` (rights.ts) ;
 * ici, la règle ne dépend QUE du droit `core:team` (pas du nom du niveau), plus trois interdits qui ne sont pas des droits :
 *  - le compte propriétaire est intouchable (personne ne le modifie, rétrograde, supprime, ni ne réinitialise son mot de passe ou sa double vérification) ;
 *  - seul le propriétaire nomme ou modifie un coordinateur (un coordinateur ne se promeut pas, n'en crée pas, ne touche pas un autre) ;
 *  - le niveau propriétaire ne s'affecte jamais (le site se transfère hors de l'application, par le propriétaire).
 */
import { LEVEL_RESERVED, type Level, type ReservedRight } from "./rights";

export const levelHolds = (level: Level, right: ReservedRight): boolean => LEVEL_RESERVED[level].includes(right);

/** Cet acteur peut-il agir sur CETTE personne (rôles, suppression, mot de passe temporaire, déblocage, sessions, double vérification) ? */
export function canManageMember(actor: Level, target: Level, opts: { self?: boolean } = {}): boolean {
  if (opts.self || !levelHolds(actor, "core:team")) return false;
  if (target === "owner") return false;
  if (target === "coordinator") return actor === "owner";
  return true;
}

/** Niveaux que cet acteur peut attribuer à une personne (invitation, affectation). L'administrateur, sans `core:team`, n'invite que des éditeurs (comportement d'avant). */
export function grantableLevels(actor: Level): Level[] {
  if (actor === "owner") return ["coordinator", "admin", "editor"];
  if (levelHolds(actor, "core:team")) return ["admin", "editor"];
  if (actor === "admin") return ["editor"];
  return [];
}
