import { recoveredLine, resetLine, slowLine, stalledLine, type Unit } from "./stallMessages";

/**
 * MÉMOIRE DES BLOCAGES. Machine à états pure (horloge, journal et « réinitialiser le module » sont injectés : aucun accès au site ni aux modules),
 * qui décide trois choses pour chaque « chose demandée à un module » (une section, un emplacement, un service…, par instance) :
 *
 *  1. QUOI ÉCRIRE : la phrase « n'a pas répondu en 8 s » UNE fois par épisode de blocage (rappel au plus toutes les heures s'il dure), « est lente » au plus
 *     une fois par heure, « répond de nouveau » à la fin de l'épisode. Jamais une ligne par visite.
 *  2. FAUT-IL REDEMANDER : tant qu'un blocage dure, les visites suivantes n'attendent pas à leur tour (l'élément est omis aussitôt) ; une seule visite à la fois
 *     retente, après une courte pause. Sans cela, chaque visiteur attendrait le délai complet et chaque requête laisserait une attente de plus en mémoire.
 *  3. FAUT-IL RÉINITIALISER LE MODULE : après `resetAfter` épisodes de suite sans une seule réponse, au plus une fois par heure et par module.
 *     « Épisode » = une tentative (la première, puis chaque nouvel essai après la pause) qui dépasse le délai ; les visites simultanées d'un même épisode comptent pour une.
 */
export type StallConfig = { timeoutMs: number; slowMs: number; pauseMs: number; resetAfter: number; resetEveryMs: number; relogMs: number };
export type StallDeps = { now(): number; say(level: "error" | "warn", line: string): void; reset(moduleId: string): void };

type State = { stalledAt: number; pausedUntil: number; probeUntil: number; countedUntil: number; episodes: number; loggedAt: number; slowLoggedAt: number; moduleId: string };
const MAX_KEYS = 500;
const NEVER = -Infinity;
const fresh = (moduleId: string): State => ({ stalledAt: 0, pausedUntil: 0, probeUntil: 0, countedUntil: 0, episodes: 0, loggedAt: 0, slowLoggedAt: NEVER, moduleId });
const keyOf = (u: Unit) => `${u.kind}|${u.instanceKey}|${u.name}`;

export class StallTracker {
  private readonly states = new Map<string, State>();
  private readonly lastReset = new Map<string, number>();
  private readonly deps: StallDeps;
  private readonly config: () => StallConfig;
  constructor(deps: StallDeps, config: () => StallConfig) { this.deps = deps; this.config = config; }

  /** « run » : demander au module. « skip » : il est en panne, ne pas attendre (l'élément est omis). */
  gate(unit: Unit): "run" | "skip" {
    const s = this.states.get(keyOf(unit));
    if (!s?.stalledAt) return "run";
    const now = this.deps.now();
    if (now < s.pausedUntil || now < s.probeUntil) return "skip";
    s.probeUntil = now + this.config().timeoutMs + 1000;   // une seule visite retente ; si elle disparaît sans conclure, la place se libère d'elle-même
    return "run";
  }

  /** Le module a répondu (une réponse, ou une exception : dans les deux cas il n'est pas bloqué) en `tookMs`. */
  answered(unit: Unit, tookMs: number, limitMs: number = this.config().timeoutMs): void {
    const key = keyOf(unit);
    const cfg = this.config();
    const now = this.deps.now();
    let s = this.states.get(key);
    if (s?.stalledAt) {
      this.deps.say("warn", recoveredLine(unit));
      Object.assign(s, { stalledAt: 0, pausedUntil: 0, probeUntil: 0, countedUntil: 0, episodes: 0, loggedAt: 0 });
    }
    if (tookMs >= cfg.slowMs && now - (s?.slowLoggedAt ?? NEVER) >= cfg.relogMs) {
      s ??= this.add(key, unit);
      s.slowLoggedAt = now;
      this.deps.say("warn", slowLine(unit, tookMs, cfg.slowMs, limitMs));
    }
    if (s && !s.stalledAt && s.slowLoggedAt === NEVER) this.states.delete(key);
  }

  /** Le module n'a pas répondu dans le temps imparti. */
  stalled(unit: Unit, limitMs: number = this.config().timeoutMs): void {
    const key = keyOf(unit);
    const cfg = this.config();
    const now = this.deps.now();
    const s = this.states.get(key) ?? this.add(key, unit);
    const first = !s.stalledAt;
    if (first) s.stalledAt = now || 1;
    s.probeUntil = 0;
    if (now >= s.countedUntil) {
      s.episodes++;
      s.countedUntil = now + cfg.pauseMs;
      s.pausedUntil = Math.max(s.pausedUntil, now + cfg.pauseMs);
    }
    if (first || now - s.loggedAt >= cfg.relogMs) {
      s.loggedAt = now || 1;
      this.deps.say("error", stalledLine(unit, limitMs));
    }
    if (s.episodes >= cfg.resetAfter) this.maybeReset(unit.moduleId, s.episodes);
  }

  private add(key: string, unit: Unit): State {
    if (this.states.size >= MAX_KEYS) for (const [k, v] of this.states) if (!v.stalledAt) this.states.delete(k);
    const s = fresh(unit.moduleId);
    this.states.set(key, s);
    return s;
  }

  private maybeReset(moduleId: string, episodes: number): void {
    const cfg = this.config();
    const now = this.deps.now();
    const last = this.lastReset.get(moduleId);
    if (last !== undefined && now - last < cfg.resetEveryMs) return;
    this.lastReset.set(moduleId, now);
    this.deps.say("error", resetLine(moduleId, episodes));
    try { this.deps.reset(moduleId); } catch (error) { this.deps.say("error", `[modules] Réinitialisation du module ${moduleId} impossible : ${(error as Error)?.message ?? "erreur inconnue"}`); }
    // Les prochaines visites retentent aussitôt avec le code rechargé ; le compte repart de zéro.
    for (const s of this.states.values()) if (s.moduleId === moduleId) Object.assign(s, { episodes: 0, pausedUntil: 0, probeUntil: 0, countedUntil: 0 });
  }
}
