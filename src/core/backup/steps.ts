import crypto from "node:crypto";

/**
 * Travail long découpé en petites étapes : une fonction génératrice fait `yield` entre deux petits morceaux. Le même code sert :
 *  - `runSync` : tout d'un trait (outils, tests, appels historiques) ;
 *  - `runAsync` : cède la main à la boucle d'événements dès que ~`SLICE_MS` ms se sont écoulées, pour qu'une requête ou un minuteur de fond ne soit
 *    jamais retardé par un export ou une restauration (« dézoom permanent » : rien ne bloque la boucle).
 * Les opérations lourdes sans découpage possible (PBKDF2, gzip) passent, elles, par le pool de threads de Node (versions asynchrones).
 */
export type Steps<T> = Generator<void, T, void>;

/** Durée maximale d'un morceau de travail synchrone avant de rendre la main (ms). */
export const SLICE_MS = 8;
/** Taille des morceaux pour le chiffrement et l'empreinte de gros fichiers. */
export const CHUNK_BYTES = 1024 * 1024;

export function runSync<T>(steps: Steps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function runAsync<T>(steps: Steps<T>): Promise<T> {
  let last = Date.now();
  let r = steps.next();
  while (!r.done) {
    if (Date.now() - last >= SLICE_MS) { await tick(); last = Date.now(); }
    r = steps.next();
  }
  return r.value;
}

/** Empreinte SHA-256 par morceaux de 1 Mo (identique à `sha256`). */
export function* sha256Steps(content: Buffer): Steps<string> {
  const h = crypto.createHash("sha256");
  for (let i = 0; i < content.length; i += CHUNK_BYTES) { h.update(content.subarray(i, i + CHUNK_BYTES)); yield; }
  return h.digest("hex");
}
