import { AsyncLocalStorage } from "node:async_hooks";
import { TIMED_OUT, withDeadline } from "../deadline";
import { bumpImportStamp, forgetModule } from "./registry";
import type { Unit } from "./stallMessages";
import { StallTracker, type StallConfig } from "./stallTracker";

/**
 * TEMPS IMPARTI AU CODE DES MODULES, quand il sert une page publique.
 *
 * Règle : « une section ou un module qui se bloque ne peut JAMAIS bloquer toute une page publique, et le journal nomme le fautif ».
 * Chaque appel du cœur à du code de module qui fabrique une page (section d'accueil, emplacement, filtre, page de module, pastille, overlay) passe par
 * `boxed` : le module a `SECTION_TIMEOUT_MS` (8 s) pour répondre. Passé ce délai, l'élément est omis (`STALLED`), la page se termine, et UNE ligne de
 * journal nomme le fautif (voir stallTracker.ts : une ligne par épisode, pas par visite ; « lente » dès 3 s ; réinitialisation automatique d'un module
 * qui reste bloqué). Une exception levée par un module n'est PAS interceptée ici : elle remonte, et l'appelant la journalise comme avant.
 *
 * Les appels que ce module-là fait à son tour pendant qu'il fabrique la page (services d'autres modules, sujets collectés) reçoivent un délai un peu plus court
 * (`boxedInner`) : le fournisseur lent est nommé à la place du consommateur, qui peut alors afficher son repli. Hors d'une page publique (administration,
 * tâches planifiées, routes de module, MCP), `boxedInner` ne limite rien : ces appels peuvent légitimement durer.
 *
 * Réglage : aucun pour la personne qui gère le site. Variable d'environnement facultative pour les développeurs : CURIOSA_SECTION_TIMEOUT_MS (100 à 120000, 8000 par défaut) ;
 * le seuil « lent », la pause entre deux essais et le reste en découlent.
 */
export const DEFAULT_SECTION_TIMEOUT_MS = 8000;
const MIN_MS = 100;
const MAX_MS = 120_000;

export function stallConfig(): StallConfig {
  const raw = Number(process.env.CURIOSA_SECTION_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(raw) && raw >= MIN_MS && raw <= MAX_MS ? Math.round(raw) : DEFAULT_SECTION_TIMEOUT_MS;
  return {
    timeoutMs,
    slowMs: Math.round(timeoutMs * 0.375),   // 3 s pour 8 s
    pauseMs: timeoutMs * 2,                  // pause entre deux essais d'un élément bloqué : 16 s
    resetAfter: 3,                           // épisodes de suite avant de réinitialiser le module
    resetEveryMs: 3_600_000,                 // au plus une réinitialisation par heure et par module
    relogMs: 3_600_000,                      // rappel dans le journal si un blocage dure
  };
}

/** Remet le code d'un module à neuf en mémoire (même mécanisme que la réinstallation : voir reinstall.ts) ; instances, réglages et données ne sont pas touchés. */
export function refreshModule(moduleId: string): void {
  forgetModule(moduleId);
  bumpImportStamp(moduleId);
}

/** Résultat d'un élément qui n'a pas répondu à temps (ou dont le module est en panne en ce moment). */
export const STALLED = Symbol("stalled");
/** Pour les appels qui doivent signaler l'absence de réponse en levant : l'appelant la reconnaît et ne journalise rien de plus. */
export class ModuleStalled extends Error {
  readonly unit: Unit;
  constructor(unit: Unit) { super("module stalled"); this.name = "ModuleStalled"; this.unit = unit; }
}
export const isStalled = (error: unknown): error is ModuleStalled => error instanceof ModuleStalled;

type Scope = { deadline: number };
type Runtime = { scope: AsyncLocalStorage<Scope>; tracker: StallTracker };
// Sur `globalThis` : Next peut charger ce fichier dans plusieurs paquets, et le suivi des blocages doit être UN SEUL pour tout le processus.
const holder = globalThis as unknown as { curiosaStall?: Runtime };
const runtime = (): Runtime =>
  (holder.curiosaStall ??= {
    scope: new AsyncLocalStorage<Scope>(),
    tracker: new StallTracker({ now: Date.now, say: (level, line) => (level === "error" ? console.error(line) : console.warn(line)), reset: refreshModule }, stallConfig),
  });
/** Pour les tests : oublie tous les épisodes en cours. */
export function resetStallState(): void { delete holder.curiosaStall; }

async function execute<T>(unit: Unit, run: () => PromiseLike<T> | T, ms: number, openScope: boolean): Promise<T | typeof STALLED> {
  const { scope, tracker } = runtime();
  if (tracker.gate(unit) === "skip") return STALLED;
  const started = Date.now();
  const store: Scope = { deadline: started + ms };
  let out: T | typeof TIMED_OUT;
  try {
    out = await withDeadline(openScope ? () => scope.run(store, run) : run, ms);
  } catch (error) {
    tracker.answered(unit, Date.now() - started, ms);   // il a répondu (par une erreur) : ce n'est pas un blocage ; l'appelant journalise l'erreur comme avant
    throw error;
  }
  if (out === TIMED_OUT) { tracker.stalled(unit, ms); return STALLED; }
  tracker.answered(unit, Date.now() - started, ms);
  return out;
}

/** Fait tourner du code de module qui fabrique un morceau de page, avec son temps imparti. `STALLED` s'il n'a pas répondu. */
export function boxed<T>(unit: Unit, run: () => PromiseLike<T> | T): Promise<T | typeof STALLED> {
  return execute(unit, run, stallConfig().timeoutMs, true);
}

/** Temps qu'il reste à la page en cours de fabrication, ou null si on n'est pas dans une page publique. */
function remainingMs(): number | null {
  const s = runtime().scope.getStore();
  return s ? s.deadline - Date.now() : null;
}
/**
 * Temps qu'il reste à la page publique en cours (ms), ou null hors page publique. Exposé aux modules par `ctx.api.net.budgetMs()`, et utilisé par
 * `ctx.api.net.request` : dans une page publique, le délai d'un appel réseau ne dépasse jamais ce qu'il reste à la page (moins une marge pour afficher le repli).
 */
export function remainingBudgetMs(): number | null {
  const left = remainingMs();
  return left === null ? null : Math.max(0, left);
}
export const inPublicPage = (): boolean => runtime().scope.getStore() !== undefined;

/**
 * Appel fait PAR un module (ou pour une page) vers un autre module : service, sujet. Dans une page publique, il a un délai un peu plus court que la section qui
 * le contient (un quart de moins, et toujours de quoi finir avant elle). Hors page publique : aucune limite, sauf `always` (l'appelant est lui-même une page
 * publique, comme l'en-tête qui rassemble les boutons des réseaux : délai complet).
 */
export async function boxedInner<T>(unit: Unit, run: () => PromiseLike<T> | T, opts: { always?: boolean } = {}): Promise<T | typeof STALLED> {
  const left = remainingMs();
  if (left === null && !opts.always) return await run();
  const cfg = stallConfig();
  const ms = left === null ? cfg.timeoutMs : Math.max(MIN_MS, Math.min(Math.round(cfg.timeoutMs * 0.75), left - Math.round(cfg.timeoutMs * 0.1)));
  return execute(unit, run, ms, false);
}
