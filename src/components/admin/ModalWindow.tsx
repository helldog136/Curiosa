"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef } from "react";
import { MODAL_WIDTH, type ModalSize } from "./modalWidth";
import { askConfirm } from "./confirmDialog";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Texts of the "discard your changes?" question asked before closing a window whose fields were edited. */
export type DiscardGuard = { message: string; discard: string; keep: string };

type WindowControls = {
  /** Closes the window. Without `force`, an edited window first asks whether to discard the changes. */
  close: (force?: boolean) => void;
  /** Forgets the edits (after a successful save, so that closing does not ask anything). */
  markClean: () => void;
};
/** Open windows, the last one on top: a window opened above another one (an edit dialog above the settings of an extension) alone answers the keyboard. */
const openWindows: symbol[] = [];

const WindowContext = createContext<WindowControls | null>(null);
/** The controls of the window the caller is rendered in (null outside any window). */
export const useModalWindow = () => useContext(WindowContext);

/**
 * THE window above the page of the admin interface. One component, one look, for every window: the details of an extension before its installation and the settings
 * of an extension (`RouteModal`, intercepted routes) and the edit form of an item of a list (`EditDialog`).
 *
 * Behaviour: Esc, a click beside the panel or the "Close" button close it; the page behind no longer scrolls; the focus enters the window, Tab stays inside (it never
 * leaves into the hidden page) and, on closing, returns to the element that opened it. A confirmation box opened above answers Esc by itself (the window stays).
 * With `guard`, closing a window whose fields were edited asks first ("Discard changes?"). On a phone the panel takes the whole screen; never a horizontal scroll.
 * `title` adds a heading in the top bar (the window is then named by it); `footer` is a bar that stays visible at the bottom while the body scrolls.
 */
export function ModalWindow({ children, label, title, closeLabel, closeHref, onClose, guard, footer, testid = "route-modal", size = "wide" }: {
  children: React.ReactNode;
  /** Name of the window for screen readers (when there is no `title`). */
  label?: string;
  title?: string;
  closeLabel: string;
  /** Where "Close" leads without JavaScript (the button is then a real link; with JavaScript it closes the window as usual). */
  closeHref?: string;
  /** Called when the window must go away (after the guard, if any, agreed). */
  onClose: () => void;
  guard?: DiscardGuard;
  footer?: React.ReactNode;
  testid?: string;
  size?: ModalSize;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dirty = useRef(false);
  const latest = useRef({ onClose, guard });
  useEffect(() => { latest.current = { onClose, guard }; });

  const close = useCallback((force = false) => {
    const { onClose: leave, guard: ask } = latest.current;
    if (force || !ask || !dirty.current) { leave(); return; }
    // The question is a modal box: the page (so this window) is inert while it is open, and Esc or a click beside answer the box, not the window.
    void askConfirm(ask.message, { confirmLabel: ask.discard, cancelLabel: ask.keep, danger: true, focusCancel: true }).then((discard) => { if (discard) leave(); });
  }, []);
  const controls = useMemo<WindowControls>(() => ({ close, markClean: () => { dirty.current = false; } }), [close]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const me = Symbol("window");
    openWindows.push(me);
    const key = (e: KeyboardEvent) => {
      const el = panel.current;
      if (!el || openWindows[openWindows.length - 1] !== me) return;
      // A confirmation box is open above: it answers Esc and Tab by itself.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (!el.contains(active)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
      openWindows.splice(openWindows.indexOf(me), 1);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [close]);

  const edited = () => { dirty.current = true; };
  return (
    <div className="modal-veil fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-start sm:p-4 lg:p-6" data-testid={testid}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title ? undefined : label} aria-labelledby={title ? titleId : undefined} tabIndex={-1} data-testid={`${testid}-panel`}
        onInput={guard ? edited : undefined} onChange={guard ? edited : undefined}
        className={`modal-panel relative flex h-full w-full ${MODAL_WIDTH[size]} flex-col overflow-y-auto overflow-x-hidden overscroll-contain bg-surface px-4 ${footer ? "" : "pb-8"} outline-none sm:h-auto sm:max-h-full sm:rounded-3xl sm:border sm:border-line sm:px-8 sm:shadow-2xl`}>
        {/* The top bar stays visible while the body scrolls: the "Close" button is never lost, and the content passes under it without hiding it. */}
        <div className={`sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-3 border-b border-line/60 bg-surface px-3 py-2 sm:-mx-8 sm:px-5 ${title ? "justify-between" : "justify-end"}`}>
          {title && <h2 id={titleId} className="min-w-0 truncate pl-1 text-lg font-semibold sm:pl-0" title={title}>{title}</h2>}
          {(() => {
            const look = "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-fg shadow-sm transition-colors hover:border-accent hover:text-accent";
            const inner = <><span aria-hidden>✕</span>{closeLabel}</>;
            return closeHref
              ? <a href={closeHref} onClick={(e) => { e.preventDefault(); close(); }} data-testid="modal-close" className={look}>{inner}</a>
              : <button type="button" onClick={() => close()} data-testid="modal-close" className={look}>{inner}</button>;
          })()}
        </div>
        <WindowContext.Provider value={controls}>
          <div className="min-w-0 flex-1 pt-3 [overflow-wrap:anywhere]">{children}</div>
          {footer && (
            <div data-testid={`${testid}-footer`} className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-line/60 bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8">{footer}</div>
          )}
        </WindowContext.Provider>
      </div>
    </div>
  );
}
