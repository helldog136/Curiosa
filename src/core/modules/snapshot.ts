import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";

/**
 * COPIE DE CHARGEMENT D'UN MODULE (« génération »). Node garde en mémoire tout fichier déjà importé, sans jamais pouvoir l'oublier, et une adresse
 * `?v=` ne vaut que pour LE fichier qu'on importe : ses voisins (`import … from "./source.mjs"`) gardent l'ancienne copie. Le cœur ne peut donc pas
 * recharger un module « en place ». À chaque chargement, il copie le dossier du module dans un dossier NEUF et importe le fichier principal DEPUIS CETTE COPIE :
 * toute la famille de fichiers a alors des adresses que Node n'a jamais vues (imports statiques, dynamiques, ou imports de voisins qui importent eux-mêmes),
 * sans rien demander aux auteurs de modules.
 *
 * Les copies vivent dans `<DATA_DIR>/modules-run/<pid>/<module>/<n>` : un dossier par processus, effacé au premier usage (un redémarrage repart de zéro), et les
 * dossiers de processus disparus sont nettoyés. On garde les 4 dernières générations de chaque module (l'ancien code peut encore avoir une requête en cours).
 * Le dossier d'installation (`<DATA_DIR>/modules/<id>`) reste LA référence : sauvegardes, pages-scripts, droits et manifeste continuent de le lire.
 */
export const KEEP_GENERATIONS = 4;
const SKIP = new Set([".git", "node_modules"]);

type State = { root: string; counters: Map<string, number>; ready: boolean };
const holder = globalThis as unknown as { curiosaRunState?: Map<string, State> };
const states = (holder.curiosaRunState ??= new Map());

export const runRoot = (dataDir: string = DATA_DIR): string => path.join(dataDir, "modules-run");

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};

/** Prépare le dossier de CE processus : l'efface (un autre processus qui avait le même numéro est mort), et nettoie ceux des processus disparus. */
function prepare(base: string): State {
  const key = base;
  let state = states.get(key);
  if (state?.ready) return state;
  state = { root: path.join(base, String(process.pid)), counters: new Map(), ready: true };
  try {
    fs.rmSync(state.root, { recursive: true, force: true });
    for (const name of fs.readdirSync(base)) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid !== process.pid && !alive(pid)) fs.rmSync(path.join(base, name), { recursive: true, force: true });
    }
  } catch { /* le dossier n'existe pas encore : rien à nettoyer */ }
  fs.mkdirSync(state.root, { recursive: true });
  states.set(key, state);
  return state;
}

/** Copie `source` (dossier d'un module) dans un dossier neuf et renvoie ce dossier. Jamais de `.git` ni de `node_modules`. */
export function snapshotModule(id: string, source: string, dataDir: string = DATA_DIR): string {
  const state = prepare(runRoot(dataDir));
  const n = (state.counters.get(id) ?? 0) + 1;
  state.counters.set(id, n);
  const parent = path.join(state.root, id);
  const dest = path.join(parent, String(n));
  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(source, dest, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
  return dest;
}

/** Tests : oublie l'état d'un dossier de données (un « redémarrage »). */
export function resetSnapshotsForTests(dataDir: string = DATA_DIR): void {
  states.delete(runRoot(dataDir));
}

/**
 * Garde les 4 dernières copies de ce module et supprime les plus anciennes. À appeler APRÈS un chargement réussi (jamais après un échec : un module cassé,
 * ré-essayé à chaque requête, chasserait sinon les copies du code qui fonctionne). Les modules déjà importés restent en mémoire : seuls leurs imports tardifs liraient le disque.
 */
export function pruneSnapshots(id: string, dataDir: string = DATA_DIR): void {
  const parent = path.join(prepare(runRoot(dataDir)).root, id);
  try {
    const all = fs.readdirSync(parent).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    for (const n of all.slice(0, Math.max(0, all.length - KEEP_GENERATIONS))) fs.rmSync(path.join(parent, String(n)), { recursive: true, force: true });
  } catch { /* dossier absent : rien à nettoyer */ }
}

/** Efface une copie dont le chargement a échoué (un module cassé est ré-essayé à chaque requête : il ne doit pas laisser une copie par requête). */
export function discardSnapshot(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
