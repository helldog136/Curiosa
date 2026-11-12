"use client";

import { useId, useState, useTransition } from "react";
import { ModalWindow } from "./ModalWindow";
import { PendingButton } from "./PendingButton";
import { HelpTip } from "./HelpTip";
import { ui } from "./ui";
import { removalConfirmed, type RemovalMode } from "./removalConfirm";

type Action = () => Promise<void>;

/** Texts of the removal window, already translated by the server (the client never builds a sentence). */
export type RemoveWindowLabels = {
  /** The button of the danger zone, also the title of the window: a verb and the object ("Remove the module Partnerships"). */
  button: string;
  /** What will be lost, one line each (the pages, the menu entry…). */
  lost: string[];
  lostHeading: string;
  /** Counts the core can know: label and number. Empty: the core knows of none. */
  impact: { label: string; value: number }[];
  noData: string;
  choice: string;
  keep: string;
  /** Tooltip of "Keep my data aside" (a precision, not a visible sentence). */
  keepHelp: string;
  erase: string;
  /** A warning that prevents a loss: shown when "erase" is chosen. */
  eraseWarning: string;
  /** The checkbox of the "keep" choice. */
  checkbox: string;
  /** The field of the "erase" choice: the person types the name. */
  typeName: string;
  example: string;
  submitKeep: string;
  submitErase: string;
  cancel: string;
  close: string;
};

/**
 * The danger zone's button and its CONFIRMATION WINDOW (module page, General tab). The button only opens the window: nothing is sent from the page, and it sits
 * outside every form, so Enter in a field can never reach it. In the window, a destructive action needs a deliberate gesture: a checkbox ("keep the data aside",
 * reversible) or the typed name of the module ("erase everything", final); until then the red button stays disabled. The window opens with its own panel focused,
 * never the red button; Enter in the name field does nothing; Esc and "Close" leave without removing anything.
 */
export function RemoveWindow({ labels, name, keep, erase }: { labels: RemoveWindowLabels; name: string; keep: Action; erase: Action }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RemovalMode>("keep");
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const radioName = useId();
  const ok = removalConfirmed(mode, { checked, typed, name });
  const reset = () => { setOpen(false); setMode("keep"); setChecked(false); setTyped(""); };
  const submit = () => { if (!ok || pending) return; start(async () => { await (mode === "keep" ? keep : erase)(); }); };
  const shownImpact = labels.impact.filter((i) => i.value > 0);

  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid="remove-open"
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border border-danger/60 bg-surface px-5 text-sm font-semibold text-danger transition hover:bg-danger/10">
        {labels.button}
      </button>
      {open && (
        <ModalWindow size="form" wrapTitle title={labels.button} closeLabel={labels.close} testid="remove-window" onClose={reset}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              <button type="button" onClick={reset} data-testid="remove-cancel" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">{labels.cancel}</button>
              <PendingButton type="button" variant="dangerSolid" pending={pending} disabled={!ok} onClick={submit} testid="remove-confirm">{mode === "keep" ? labels.submitKeep : labels.submitErase}</PendingButton>
            </div>
          }>
          {/* No form element: Enter can never submit. The red button is the only way to send, and it is disabled until the gesture above is done. */}
          <div className="space-y-5" data-testid="remove-body">
            <section aria-labelledby={`${radioName}-lost`} className="space-y-2 rounded-xl border border-danger/40 bg-danger/5 p-4" data-testid="remove-lost">
              <h3 id={`${radioName}-lost`} className="text-sm font-semibold text-danger">{labels.lostHeading}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{labels.lost.map((l) => <li key={l}>{l}</li>)}</ul>
              {shownImpact.length > 0 ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-danger/30 pt-2 text-sm" data-testid="remove-impact">
                  {shownImpact.map((i) => <div key={i.label} className="contents"><dt>{i.label}</dt><dd className="font-semibold tabular-nums">{i.value}</dd></div>)}
                </dl>
              ) : <p className="border-t border-danger/30 pt-2 text-sm" data-testid="remove-impact">{labels.noData}</p>}
            </section>

            <fieldset className="space-y-2">
              <legend className={ui.label}>{labels.choice}</legend>
              <div className="flex items-center gap-1 rounded-xl border border-line pr-3 text-sm has-[:checked]:border-accent">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 pl-3">
                  <input type="radio" name={radioName} checked={mode === "keep"} onChange={() => setMode("keep")} className="h-4 w-4" data-testid="remove-mode-keep" />
                  <span>{labels.keep}</span>
                </label>
                <HelpTip help={labels.keepHelp} name={labels.keep} />
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 text-sm has-[:checked]:border-danger">
                <input type="radio" name={radioName} checked={mode === "erase"} onChange={() => setMode("erase")} className="h-4 w-4" data-testid="remove-mode-erase" />
                <span className="flex-1">{labels.erase}</span>
              </label>
              {mode === "erase" && <p role="alert" className="text-sm font-medium text-danger" data-testid="remove-erase-warning">{labels.eraseWarning}</p>}
            </fieldset>

            {mode === "keep" ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-5 w-5" data-testid="remove-checkbox" />
                <span>{labels.checkbox}</span>
              </label>
            ) : (
              <div>
                <label htmlFor={`${radioName}-name`} className={ui.label}>{labels.typeName}</label>
                <input id={`${radioName}-name`} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
                  onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} data-testid="remove-typed" aria-describedby={`${radioName}-ex`} className={ui.input} />
                <p id={`${radioName}-ex`} className={ui.help}>{labels.example}</p>
              </div>
            )}
          </div>
        </ModalWindow>
      )}
    </>
  );
}
