"use client";

import { useEffect, useRef, useState } from "react";
import { ui } from "./ui";
import { MenuIcon } from "./MenuIcon";

const SMALL = "(max-width: 767px)";
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

/**
 * Administration menu. From 768 px the sidebar is sticky: full height, the links scroll inside it, the account block stays at the bottom.
 * On a phone only a bar (site name + « Menu » button) stays at the top, and the menu opens as a sheet under it: Escape closes it and gives the focus back to
 * the button, Tab stays inside the bar and the sheet, the page behind does not scroll. The menu is one markup for both sizes (no second copy of the links).
 */
export function MobileMenu({ brand, menuLabel, search, footer, children }: { brand: React.ReactNode; menuLabel: string; /** The settings search, above the links. */ search?: React.ReactNode; /** The account block, pinned under the links. */ footer?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const small = window.matchMedia(SMALL);
    // Focus the first link of the sheet (the search field would raise the on-screen keyboard).
    root.current?.querySelector<HTMLElement>("#admin-nav nav a, #admin-nav summary")?.focus();
    const lock = () => { document.body.style.overflow = small.matches ? "hidden" : ""; };
    lock();
    const onKey = (e: KeyboardEvent) => {
      if (!small.matches) return;
      if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const nodes = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    small.addEventListener("change", lock);
    return () => { document.removeEventListener("keydown", onKey); small.removeEventListener("change", lock); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <aside ref={root} className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface md:flex md:h-dvh md:w-64 md:flex-col md:self-start md:border-b-0 md:border-r" data-testid="admin-sidebar">
      <div className="flex min-h-[4.5rem] shrink-0 items-center justify-between gap-3 p-4 pb-3">
        {brand}
        <button ref={toggle} type="button" className={`${ui.btn} min-h-11 md:hidden`} aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((o) => !o)}>
          <MenuIcon name={open ? "close" : "menu"} /> {menuLabel}
        </button>
      </div>
      <div id="admin-nav" className={`${open ? "flex" : "hidden"} min-h-0 flex-col bg-surface max-md:absolute max-md:inset-x-0 max-md:top-full max-md:z-40 max-md:h-[calc(100dvh-4.5rem)] max-md:border-t max-md:border-line md:flex md:flex-1`}>
        {search && <div className="shrink-0 px-4 pb-1">{search}</div>}
        <div data-nav-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-surface px-4 py-2" data-testid="admin-sidebar-account">{footer}</div>}
      </div>
    </aside>
  );
}
