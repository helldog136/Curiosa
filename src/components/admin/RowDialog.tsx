"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A window above the page for the actions of ONE row of a table (native <dialog>: Escape closes, the keyboard is enough). Its content exists only while it is open, so
 * each opening starts clean. Shared by the skins table (Appearance) and the personal catalogues table (Extensions); the page passes the already translated close label.
 */
export function RowDialog({ open, title, onClose, closeLabel, children }: { open: boolean; title: string; onClose: () => void; closeLabel: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  useEffect(() => { const d = ref.current; if (!d) return; d.addEventListener("close", onClose); return () => d.removeEventListener("close", onClose); }, [onClose]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      className="m-auto max-h-[90vh] w-[min(94vw,34rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60">
      {open && (
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{title}</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label={closeLabel} title={closeLabel} className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted hover:text-fg"><span aria-hidden>×</span></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
