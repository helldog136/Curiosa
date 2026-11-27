import type { ReactNode } from "react";
import { ui } from "./ui";

/**
 * EMPTY STATE (C3c, R18): one sentence that says what to do, ONE action (a button or a link, drawn by the caller with the usual kit buttons) and, if useful, an
 * example that adds in one click (`example`). Never a blank page, never a description of the screen (R32). `action` is required on purpose: an empty state that
 * offers nothing to do has no reason to exist, say it in the page title instead.
 */
export function EmptyState({ title, action, example, level = 3, testid }: { title: string; action: ReactNode; example?: ReactNode; level?: 2 | 3 | 4; testid?: string }) {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <section data-empty-state="" data-testid={testid ?? "empty-state"} className={`${ui.card} flex flex-col items-start gap-3 border-dashed`}>
      <Heading className="min-w-0 break-words text-base font-semibold">{title}</Heading>
      <div className="flex flex-wrap items-center gap-2" data-empty-action="">{action}</div>
      {example ? <div className="flex flex-wrap items-center gap-2" data-empty-example="">{example}</div> : null}
    </section>
  );
}
