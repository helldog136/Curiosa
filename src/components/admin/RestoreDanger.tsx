"use client";

import { useId, useState } from "react";
import { HelpTip } from "./HelpTip";
import { ui } from "./ui";

/**
 * RESTORE DANGER ZONE (C5f, R3, R24): restoring replaces the whole site, so it is a separate card with a danger edge, the loss written on it and ONE danger button
 * that opens the form (file, password, then the preview the panel shows before anything is replaced). The form stays mounted once opened (a restore in progress
 * is never lost by a click on "Cancel" of the card: the button is disabled while it is open and busy is the panel's own state). The danger is never the default button.
 */
export function RestoreDanger({ title, loss, help, openLabel, closeLabel, children }: { title: string; help?: string; loss: string; openLabel: string; closeLabel: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const region = useId();
  return (
    <section className="space-y-4 rounded-2xl border border-danger-text/40 bg-danger-soft/40 p-5 sm:p-6" data-testid="restore-danger">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">{title}{help ? <HelpTip help={help} name={title} always /> : null}</h2>
          <p className="mt-1 text-sm text-danger-text" data-testid="restore-loss">{loss}</p>
        </div>
        <button type="button" aria-expanded={open} aria-controls={region} onClick={() => setOpen((v) => !v)} className={`${ui.btnDanger} min-h-11`} data-testid="restore-open">
          {open ? closeLabel : openLabel}
        </button>
      </div>
      <div id={region} hidden={!open}>{children}</div>
    </section>
  );
}
