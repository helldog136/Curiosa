import path from "node:path";
import { pathToFileURL } from "node:url";
import type { HostingWarning } from "../../../scripts/update-proc.mjs";

type ProcModule = typeof import("../../../scripts/update-proc.mjs");

/**
 * Situations dangereuses pour une mise à jour supervisée, repérées AVANT d'installer (lecture de /proc seulement, aucune commande, aucun secret) :
 * un second gestionnaire pour CE site (même dossier ou même port : un pm2 ou un serveur de jeu sans rapport n'alarme pas), ou une unité qui
 * lance le site par npx / npm (trois processus). Jamais bloquant : la page dit quoi faire. Hors Linux, ou sans /proc lisible : liste vide.
 * Le module est celui de la tâche de mise à jour (scripts/update-proc.mjs), chargé à l'exécution : une seule logique, et le bundler
 * n'a pas à tracer ses lectures de /proc.
 */
export async function inspectHosting(opts: { supervised: boolean; appDir?: string }): Promise<HostingWarning[]> {
  if (!opts.supervised || process.platform !== "linux") return [];
  try {
    const appDir = opts.appDir ?? process.cwd();
    const url = pathToFileURL(path.join(appDir, "scripts", "update-proc.mjs")).href;
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as ProcModule;
    const sys = mod.systemProc();
    const port = mod.resolveSitePort({ env: process.env, sys, serverPid: process.pid });
    return mod.detectHosting({ appDir, port, procs: sys.procs(), selfPid: process.pid, serverPid: process.pid });
  } catch { return []; }
}
export type { HostingWarning };
