// Edit dialog (presentation: "dialog"): the pure rules shared by the server (which block goes where) and the tests.
import type { Block } from "@/core/blocks";

type FormBlock = Extract<Block, { type: "adminForm" }>;

/**
 * Does this block show in a window above the page? Only a module `adminForm` of the admin panel (never in an entry editor: `entry`) that asks for it, and
 * without a `file` field (that form posts through a dedicated route and stays in the page).
 */
export function opensInDialog(block: Block, opts: { admin: boolean; entry?: boolean }): block is FormBlock {
  return block.type === "adminForm" && block.presentation === "dialog" && opts.admin && !opts.entry && !block.fields.some((f) => f.kind === "file");
}

/** The blocks in render order: dialogs last, so that a window opening does not shift the position (and the React identity) of the list under it. */
export function dialogsLast<T extends Block>(blocks: T[], opts: { admin: boolean; entry?: boolean }): T[] {
  return [...blocks.filter((b) => !opensInDialog(b, opts)), ...blocks.filter((b) => opensInDialog(b, opts))];
}

/** Lets a row link open the window without reloading: only an address of the admin (`?x=y` or `/admin/…`), never another site. */
export function softOpenTarget(href: string, base: string): string | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  const here = new URL(base);
  if (url.origin !== here.origin || !url.pathname.startsWith("/admin")) return null;
  return url.pathname + url.search;
}

/** How an open edit dialog goes away: "back" when a click in the page opened it (the history entry it added is removed, so "Back" and "Close" agree), else "replace" (reload, shared link). */
export function closeMode(openedBy: string | null, currentHref: string): "back" | "replace" {
  return openedBy !== null && openedBy === currentHref ? "back" : "replace";
}
