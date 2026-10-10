/** Logique pure des boutons d'action animés (voir AnimatedActionButton) : sans React, donc testable telle quelle. */

export type Phase = "idle" | "working" | "done" | "error";

/** Durée minimale de l'animation : même si l'action est instantanée, on la voit se faire. */
export const MIN_MS = 900;
/** Temps pendant lequel « ✓ » reste affiché avant de passer à la suite (navigation, rafraîchissement). */
export const DONE_MS = 700;
/** Après une mise à jour du site : le serveur redémarre, on laisse 2 s de plus avant de relire la page (sinon le proxy répond « 502 Bad Gateway »). */
export const AFTER_UPDATE_MS = 2000;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Le bouton est occupé (animé, non cliquable) pendant l'action, après sa réussite, ou tant que le serveur travaille encore (`external`). */
export function isBusy(phase: Phase, external = false): boolean {
  return external || phase === "working" || phase === "done";
}

/** Phase affichée : un travail serveur en cours (`external`) compte comme « en cours », sauf si le bouton vient lui-même de finir. */
export function shownPhase(phase: Phase, external = false): Phase {
  return external && (phase === "idle" || phase === "error") ? "working" : phase;
}

/** Barre de remplissage : vide au repos, pleine (en `MIN_MS`) pendant et après l'action. Le mode continu est dessiné en CSS. */
export function fillStyle(phase: Phase): { width: string; transitionDuration: string } {
  const full = phase === "working" || phase === "done";
  return { width: full ? "100%" : "0%", transitionDuration: `${full ? MIN_MS : 0}ms` };
}

/**
 * Lance `run` et ne rend la main qu'au bout de MIN_MS au moins. Renvoie le résultat, ou `null` si l'action a échoué par exception.
 */
export async function runAtLeast<T>(run: () => Promise<T>, minMs = MIN_MS): Promise<T | null> {
  try {
    const [result] = await Promise.all([run(), sleep(minMs)]);
    return result;
  } catch {
    await sleep(0);
    return null;
  }
}
