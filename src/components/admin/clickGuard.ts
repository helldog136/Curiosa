/** Un seul clic compte à la fois : `begin()` dit si ce clic ouvre la fiche (le premier) ou s'il est ignoré (la navigation est déjà partie) ; `reset()` rouvre. */
export function createClickGuard() {
  let busy = false;
  return { begin: () => (busy ? false : (busy = true)), reset: () => { busy = false; }, get busy() { return busy; } };
}
