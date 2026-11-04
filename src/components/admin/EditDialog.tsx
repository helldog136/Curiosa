"use client";

import { useRouter, usePathname } from "next/navigation";
import { ModalWindow, type DiscardGuard } from "./ModalWindow";
import { closeMode, softOpenTarget } from "@/core/adminkit/dialog";

/** What the window remembers of the way it was opened. Module level: it survives soft navigations, and a full page load resets it (a deep link). */
let openedBy: string | null = null;

/**
 * A link that opens an edit dialog: a plain click navigates WITHOUT reloading the page (the list keeps its search, its filter and its scroll position) and adds a
 * history entry, so "Back" closes the window. Without JavaScript, with a modifier key (new tab) or for an address outside the admin, it stays an ordinary link
 * that opens the same page in full.
 */
export function DialogLink({ href, className, children, role, label }: { href: string; className?: string; children: React.ReactNode; role?: string; label?: string }) {
  const router = useRouter();
  return (
    <a href={href} role={role} aria-label={label} aria-haspopup="dialog" className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const target = softOpenTarget(href, window.location.href);
        if (!target) return;
        e.preventDefault();
        openedBy = new URL(target, window.location.href).href;
        router.push(target, { scroll: false });
      }}>{children}</a>
  );
}

/**
 * The edit window of a list item: the shared `ModalWindow` (same look as the extension details window) whose open state IS the address (`?edit=…`). Closing goes
 * back in history when this window was opened by a click in the page (so "Back" and "Close" agree), otherwise (reload, shared link) it replaces the address by
 * `closeHref`, the list. Edited fields are protected by the discard question.
 */
export function EditDialog({ title, closeLabel, closeHref, guard, footer, testid = "edit-dialog", children }: {
  title: string; closeLabel: string; closeHref?: string; guard: DiscardGuard; footer: React.ReactNode; testid?: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const leave = () => {
    const mode = closeMode(openedBy, window.location.href);
    openedBy = null;
    if (mode === "back") { router.back(); return; }
    const target = (closeHref && softOpenTarget(closeHref, window.location.href)) ?? pathname;
    router.replace(target, { scroll: false });
  };
  return <ModalWindow size="form" title={title} closeLabel={closeLabel} guard={guard} footer={footer} testid={testid} onClose={leave}>{children}</ModalWindow>;
}
