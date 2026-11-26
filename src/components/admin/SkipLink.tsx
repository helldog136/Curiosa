/** Id of the content area of the admin shell: the target of the skip link (and nothing else may use it). */
export const ADMIN_MAIN_ID = "admin-main";

/**
 * « Skip to content »: the first stop of the Tab order on every admin page (WCAG 2.4.1). Invisible until it has the focus, then a clear button in the
 * corner. Self-contained on purpose: one link, no state, the label comes from the page. It targets the `<main id={ADMIN_MAIN_ID} tabIndex={-1}>` of the shell.
 */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href={`#${ADMIN_MAIN_ID}`}
      data-testid="skip-link"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-accent-fg focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-fg"
    >
      {label}
    </a>
  );
}
