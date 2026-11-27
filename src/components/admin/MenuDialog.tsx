"use client";

import { useId, useRef } from "react";

/**
 * A "⋯" menu entry that opens a window (C5b). The entry looks like the other entries of `RowMenu`; the window is a native `<dialog>` (Escape closes it, the focus stays inside,
 * the keyboard is enough) holding a form prepared on the server; the success message stays visible until the person closes it.
 * Used where an action needs a sentence of consequences before it runs (« Delete the role »: who loses it) or one more field (« Duplicate »: the name of the copy).
 */
export function MenuDialog({ trigger, title, closeLabel, children, danger = false, testid }: {
  trigger: string; title: string; closeLabel: string; children: React.ReactNode; danger?: boolean; testid?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" role="menuitem" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} data-testid={testid}
        className={danger ? "flex min-h-11 w-full items-center justify-start gap-2 px-4 text-left text-sm font-medium text-red-700 transition hover:bg-red-500/10" : "flex min-h-11 w-full items-center justify-start px-4 text-left text-sm transition hover:bg-bg"}>{trigger}</button>
      <dialog ref={dialog} aria-labelledby={titleId} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}
        className="m-auto max-h-[90vh] w-[min(94vw,34rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60">
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="min-w-0 text-lg font-semibold">{title}</h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel} title={closeLabel} className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted hover:text-fg"><span aria-hidden>×</span></button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
