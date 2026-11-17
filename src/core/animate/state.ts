/**
 * THE PRINCIPLE'S STATE (core 0.30.0): what a module sends to `CuriosaAnimate` for one element. Values and times only, never a shape or a colour.
 *
 *   genre       "gauge" | "levels" | "counter"
 *   format      "count" (default) | "time" (seconds: a countdown, e.g. a subathon) | "money" | "percent"
 *   value       the current value (count, money, percent; for "levels": the progress inside the current level)
 *   target, min the gauge's span (levels: the goal of the current level); progress = (value - min) / (target - min), clamped to 0..1, the rest is overflow
 *   level       levels only: the current level number
 *   milestones  up to 12 values drawn as ticks (gauge)
 *   timer       { endsAt: ms, total?: ms, pausedAt?: ms|null }: a countdown. With format "time" the VALUE is the time left (endsAt - now), so a subathon
 *               gauge only moves `endsAt` when a sub or a donation adds time, and sends an `extend` highlight with the seconds added as `amount`.
 *   rebase      { from, at }: the value was recalibrated (a fresh reading): it glides from `from`, without a highlight (it may go down, never celebrated).
 *   highlights  [{ id, at: ms, kind: "step" | "extend" | "milestone" | "complete" | "drop", amount?, intensity? 0..1 }], the most recent 40 kept.
 *               The engine merges bursts (closer than 1.5 s), queues celebrations (one at a time, 3 waiting at most) and ends every phase by itself.
 *   label       the module's words (60 characters), drawn as given
 *   ended       true: the countdown or the event is over (phase "ended")
 *
 * Times are SERVER milliseconds: a module gives the element the server's `now` (handle.setClock) so two overlay pages show the same instant, and a page that
 * reloads shows the current state at once (old highlights are already over: nothing is replayed).
 */
import { FORMATS, GENRES, HIGHLIGHTS, TIMING } from "./spec";

export type AnimateHighlight = { id: string; at: number; kind: (typeof HIGHLIGHTS)[number]; amount?: number; intensity?: number };
export type AnimateState = {
  genre: keyof typeof GENRES; format?: (typeof FORMATS)[number]; value: number; target?: number; min?: number; level?: number; milestones?: number[];
  timer?: { endsAt: number; total?: number; pausedAt?: number | null }; rebase?: { from: number; at: number }; highlights?: AnimateHighlight[]; label?: string; currency?: string; ended?: boolean;
};
export type StateProblem = { path: string; problem: string };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Every problem of a state at once (the engine would clamp or drop them silently; a module's tests should see them). */
export function checkAnimateState(raw: unknown): { ok: boolean; problems: StateProblem[] } {
  const problems: StateProblem[] = [];
  const bad = (path: string, problem: string) => problems.push({ path, problem });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problems: [{ path: "", problem: "not an object" }] };
  const s = raw as Record<string, unknown>;
  if (!(typeof s.genre === "string" && s.genre in GENRES)) bad("genre", `one of ${Object.keys(GENRES).join(", ")}`);
  if (s.format !== undefined && !(FORMATS as readonly unknown[]).includes(s.format)) bad("format", `one of ${FORMATS.join(", ")}`);
  if (!finite(s.value)) bad("value", "a finite number");
  for (const k of ["target", "min", "level"]) if (s[k] !== undefined && !finite(s[k])) bad(k, "a finite number");
  if (s.format === "time" && !(s.timer && typeof s.timer === "object")) bad("timer", "a time gauge needs { endsAt }");
  if (s.timer !== undefined) { const t = s.timer as Record<string, unknown>; if (!t || typeof t !== "object" || !finite(t.endsAt)) bad("timer.endsAt", "milliseconds"); }
  if (s.rebase !== undefined) { const r = s.rebase as Record<string, unknown>; if (!r || !finite(r.from) || !finite(r.at)) bad("rebase", "{ from, at }"); }
  if (s.milestones !== undefined && (!Array.isArray(s.milestones) || s.milestones.length > 12 || !s.milestones.every(finite))) bad("milestones", "up to 12 numbers");
  if (s.label !== undefined && (typeof s.label !== "string" || s.label.length > 60)) bad("label", "a text of 60 characters at most");
  if (s.highlights !== undefined) {
    if (!Array.isArray(s.highlights)) bad("highlights", "a list");
    else {
      if (s.highlights.length > TIMING.maxHighlights) bad("highlights", `at most ${TIMING.maxHighlights} (older ones are ignored)`);
      s.highlights.forEach((h: unknown, i: number) => {
        const x = h as Record<string, unknown>;
        if (!x || typeof x !== "object") { bad(`highlights.${i}`, "an object"); return; }
        if (typeof x.id !== "string" || !x.id) bad(`highlights.${i}.id`, "a stable text (the same highlight keeps its id: it is never replayed)");
        if (!finite(x.at)) bad(`highlights.${i}.at`, "milliseconds");
        if (!(HIGHLIGHTS as readonly unknown[]).includes(x.kind)) bad(`highlights.${i}.kind`, `one of ${HIGHLIGHTS.join(", ")}`);
        if (x.amount !== undefined && !finite(x.amount)) bad(`highlights.${i}.amount`, "a number");
        if (x.intensity !== undefined && !(finite(x.intensity) && x.intensity >= 0 && x.intensity <= 1)) bad(`highlights.${i}.intensity`, "0 to 1");
      });
    }
  }
  return { ok: problems.length === 0, problems };
}
