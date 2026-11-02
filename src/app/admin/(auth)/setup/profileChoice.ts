/**
 * Choix d'un profil de départ dans l'assistant : de la logique pure (sans React), testée à part. Un profil ne fait que PRÉ-COCHER des extensions et PROPOSER des pages d'exemple :
 *  - choisir un profil retire d'abord ce que le profil précédent avait coché, puis coche celui du nouveau (ce que la personne a coché elle-même reste coché) ;
 *  - « aucun » (sauter, ou « Autre ») ne coche rien et retire ce que le profil précédent avait coché ;
 *  - les pages d'exemple suivent le profil (toutes cochées d'avance, la personne en décoche à sa guise) et ne sont proposées que tant que leur extension est cochée.
 */
export type ProfileLike = { modules: string[]; samples: string[] };
export type WizardChoice = { chosen: string[]; samples: string[] };

export function applyProfile(state: WizardChoice, previous: ProfileLike | null, next: ProfileLike | null): WizardChoice {
  const dropped = new Set(previous?.modules ?? []);
  const kept = state.chosen.filter((id) => !dropped.has(id));
  const added = (next?.modules ?? []).filter((id) => !kept.includes(id));
  return { chosen: [...kept, ...added], samples: [...(next?.samples ?? [])] };
}

/** Les pages d'exemple du profil dont l'extension est cochée. */
export function profileSamples(profile: ProfileLike | null, chosen: string[]): string[] {
  return (profile?.samples ?? []).filter((ref) => chosen.includes(ref.split(":")[0] ?? ""));
}
