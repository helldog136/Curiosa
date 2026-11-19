"use client";

import { useId, useState, useTransition } from "react";
import { ModalWindow } from "./ModalWindow";
import { PendingButton } from "./PendingButton";
import { removalConfirmed } from "./removalConfirm";
import { ui } from "./ui";
import type { ActionState } from "./ActionForm";

/** Texts of the full powers window, already translated by the server (the client never builds a sentence). */
export type FullPowersLabels = {
  /** The button that opens the window. */
  open: string;
  /** The title of the window: a verb and the access ("Give full powers to Camille"). */
  title: string;
  /** The warning that prevents a loss: always visible in the window. */
  warning: string;
  allowsTitle: string;
  allows: string[];
  outsideTitle: string;
  outside: string[];
  /** The field: the person types the name of the access. */
  typeName: string;
  example: string;
  submit: string;
  cancel: string;
  close: string;
};

/**
 * The CONFIRMATION WINDOW of "Full powers" (access page). The button only opens it: nothing is sent from the page. In the window, the red button stays disabled until
 * the person has typed the name of the access (a deliberate gesture, like erasing a module); Enter in the field never submits; Esc and "Cancel" leave without any change.
 * The server asks for the typed name again and refuses without it: this window decides nothing.
 */
export function FullPowersWindow({ labels, name, grant }: { labels: FullPowersLabels; name: string; grant: (typedName: string) => Promise<ActionState> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const ok = removalConfirmed("erase", { checked: false, typed, name });
  const reset = () => { setOpen(false); setTyped(""); setError(null); };
  const submit = () => {
    if (!ok || pending) return;
    start(async () => {
      const r = await grant(typed);
      if (r?.errors) { setError(Object.values(r.errors)[0] ?? null); return; }
      reset();
    });
  };
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid="fullpowers-open"
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-danger/60 bg-surface px-5 text-sm font-semibold text-danger transition hover:bg-danger/10">
        {labels.open}
      </button>
      {open && (
        <ModalWindow size="form" wrapTitle title={labels.title} closeLabel={labels.close} testid="fullpowers-window" onClose={reset}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              <button type="button" onClick={reset} data-testid="fullpowers-cancel" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">{labels.cancel}</button>
              <PendingButton type="button" variant="dangerSolid" pending={pending} disabled={!ok} onClick={submit} testid="fullpowers-confirm">{labels.submit}</PendingButton>
            </div>
          }>
          {/* No form element: Enter can never submit. The red button is the only way to send, and it is disabled until the name is typed. */}
          <div className="space-y-3 sm:space-y-5" data-testid="fullpowers-body">
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm font-medium leading-5 text-danger sm:p-4 sm:leading-normal" data-testid="fullpowers-warning">{labels.warning}</p>
            <section aria-labelledby={`${id}-allows`} className="space-y-1 sm:space-y-2" data-testid="fullpowers-allows">
              <h3 id={`${id}-allows`} className="text-sm font-semibold">{labels.allowsTitle}</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px] leading-5 sm:space-y-1 sm:text-sm sm:leading-normal">{labels.allows.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
            <section aria-labelledby={`${id}-outside`} className="space-y-1 sm:space-y-2" data-testid="fullpowers-outside">
              <h3 id={`${id}-outside`} className="text-sm font-semibold">{labels.outsideTitle}</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px] leading-5 text-muted sm:space-y-1 sm:text-sm sm:leading-normal">{labels.outside.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
            <div>
              <label htmlFor={`${id}-name`} className={ui.label}>{labels.typeName}</label>
              <input id={`${id}-name`} type="text" value={typed} onChange={(e) => { setTyped(e.target.value); setError(null); }} autoComplete="off" autoCapitalize="off" spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} data-testid="fullpowers-typed" aria-describedby={`${id}-ex`} aria-invalid={error ? true : undefined} className={ui.input} />
              <p id={`${id}-ex`} className={ui.help}>{labels.example}</p>
              {error && <p role="alert" className="mt-1 text-sm text-danger" data-testid="fullpowers-error">{error}</p>}
            </div>
          </div>
        </ModalWindow>
      )}
    </>
  );
}
