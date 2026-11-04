"use client";

import { useId, useRef, useState, useTransition } from "react";
import { askConfirm } from "./confirmDialog";

export type ApprovalLabels = {
  group: string; ask: string; act: string; askHelp: string; actHelp: string; installNote: string; saved: string; failed: string; actConfirm: string; confirmLabel: string;
};

/**
 * WHO APPROVES RISKY ACTIONS: two choices side by side, the current one always selected (R17: it shows the state, it is not a verb; R19: 2 to 4 choices).
 * A real radio group (arrow keys move and choose, one tab stop, "checked" announced). Choosing "act without asking" asks for a confirmation first.
 * Installing a feature always waits for the owner: the line under the control says so, so it is never a surprise.
 */
export function ApprovalChoice({ current, onChange, labels }: { current: "human" | "direct"; onChange: (mode: "human" | "direct") => Promise<unknown>; labels: ApprovalLabels }) {
  const [mode, setMode] = useState(current);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const id = useId();
  const refs = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)];
  const options = [{ value: "human" as const, label: labels.ask, help: labels.askHelp }, { value: "direct" as const, label: labels.act, help: labels.actHelp }];

  async function choose(next: "human" | "direct") {
    if (next === mode || pending) return;
    if (next === "direct" && !(await askConfirm(labels.actConfirm, { confirmLabel: labels.confirmLabel }))) return;
    const before = mode;
    setMode(next);
    setNote(null);
    start(async () => {
      try { await onChange(next); setNote({ tone: "ok", text: labels.saved }); }
      catch { setMode(before); setNote({ tone: "error", text: labels.failed }); }
    });
  }
  function onKey(e: React.KeyboardEvent, index: number) {
    const move = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    const target = (index + move + options.length) % options.length;
    refs[target]?.current?.focus();
    void choose(options[target]!.value);
  }

  return (
    <div className="space-y-2" data-testid="approval-choice">
      <p id={`${id}-l`} className="text-sm font-medium">{labels.group}</p>
      <div role="radiogroup" aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`} className="flex flex-wrap gap-1.5 rounded-2xl border border-line bg-bg p-1">
        {options.map((o, i) => {
          const on = mode === o.value;
          return (
            <button key={o.value} ref={refs[i]} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={pending} data-value={o.value}
              onClick={() => void choose(o.value)} onKeyDown={(e) => onKey(e, i)}
              className="flex min-h-11 min-w-[10rem] flex-1 items-center justify-center rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-checked:bg-accent aria-checked:text-accent-fg aria-checked:shadow-sm disabled:cursor-progress">
              <span aria-hidden="true" className={`mr-1.5 ${on ? "" : "invisible"}`}>✓</span><span className="[overflow-wrap:anywhere]">{o.label}</span>
            </button>
          );
        })}
      </div>
      <p id={`${id}-h`} className="text-sm leading-6 text-muted" data-testid="approval-help">{options.find((o) => o.value === mode)?.help}</p>
      <p className="text-sm leading-6" data-testid="approval-install-note">{labels.installNote}</p>
      <p role={note?.tone === "error" ? "alert" : "status"} className={`min-h-5 text-sm ${note?.tone === "error" ? "font-medium text-red-700" : "text-emerald-700"}`}>{note ? `${note.tone === "ok" ? "✓" : "⚠"} ${note.text}` : ""}</p>
    </div>
  );
}
