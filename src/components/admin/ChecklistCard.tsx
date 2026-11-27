import type { ReactNode } from "react";
import { ui } from "./ui";

export type ChecklistStep = { id: string; label: string; done: boolean; /** The action of this step (button or link): shown only on the first step still to do. */ action?: ReactNode };
export type ChecklistLabels = { done: string; todo: string; /** « {n} of {total} done ». */ progress: string };

/** Pure: how far along and which step is next. */
export function checklistState(steps: readonly { done: boolean }[]): { done: number; total: number; next: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, next: steps.findIndex((s) => !s.done), complete: steps.length > 0 && done === steps.length };
}

/**
 * CHECKLIST CARD (C3c, R8, R26, R33.5): the set-up steps of a thing that needs outside work (three at most, R8), each marked done or to do by a shape AND a hidden
 * word, with the action of the NEXT step beside it. Setup instructions exist only while the set-up is not done (R33): when every step is done the card draws
 * nothing, unless `keepWhenDone` is set (a page that wants to show the finished list).
 */
export function ChecklistCard({ title, steps, labels, keepWhenDone = false, level = 3, testid }: { title: string; steps: ChecklistStep[]; labels: ChecklistLabels; keepWhenDone?: boolean; level?: 2 | 3 | 4; testid?: string }) {
  const st = checklistState(steps);
  if (steps.length === 0 || (st.complete && !keepWhenDone)) return null;
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  const progress = labels.progress.replace("{n}", String(st.done)).replace("{total}", String(st.total));
  return (
    <section data-checklist="" data-testid={testid ?? "checklist-card"} className={`${ui.card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Heading className="min-w-0 break-words text-base font-semibold">{title}</Heading>
        <span className="ml-auto text-sm text-muted" data-checklist-progress="">{progress}</span>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} data-step={s.done ? "done" : "todo"} aria-current={i === st.next ? "step" : undefined} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
            <span aria-hidden="true" data-step-glyph={s.done ? "done" : "todo"} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${s.done ? "border-ok-text bg-ok-soft text-ok-text" : "border-line-strong text-muted"}`}>{s.done ? "✓" : i + 1}</span>
            <span className={`min-w-0 flex-1 break-words text-sm ${s.done ? "text-muted" : "font-medium"}`}>
              {s.label}
              <span className="sr-only">{`, ${s.done ? labels.done : labels.todo}`}</span>
            </span>
            {i === st.next && s.action ? <span className="flex flex-wrap items-center gap-2" data-step-action="">{s.action}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
