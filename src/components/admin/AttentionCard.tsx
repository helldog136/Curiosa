import type { ReactNode } from "react";
import { ui } from "./ui";

export type AttentionTone = "info" | "warn" | "danger";

const EDGE: Record<AttentionTone, string> = { info: "border-l-sky-600", warn: "border-l-warn-text", danger: "border-l-danger-text" };
const GLYPH: Record<AttentionTone, string> = { info: "i", warn: "▲", danger: "✕" };

/**
 * ATTENTION CARD (C3c): something needs a decision or a fix NOW, so the card carries the action that does it (R32, R33: an information box with nothing to do is a
 * pill with a tooltip, not a card). Title = what is wrong, `reason` = why or what is lost (one line), `action` = the button or link that fixes it (required: without
 * it the card draws nothing, so a "good news" or reassurance box cannot be built with it). The tone shows by a shape and a coloured edge, never by colour alone.
 * `alert` makes a screen reader read it as soon as it appears (use it only for what blocks the person).
 */
export function AttentionCard({ title, reason, action, tone = "warn", alert = false, level = 3, testid }: { title: string; reason?: string; action: ReactNode; tone?: AttentionTone; alert?: boolean; level?: 2 | 3 | 4; testid?: string }) {
  if (!action) return null;
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <section data-attention="" data-tone={tone} data-testid={testid ?? "attention-card"} role={alert ? "alert" : undefined}
      className={`${ui.card} flex flex-wrap items-start gap-x-4 gap-y-3 border-l-4 ${EDGE[tone]}`}>
      <span aria-hidden="true" data-attention-glyph={tone} className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">{GLYPH[tone]}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <Heading className="break-words text-base font-semibold">{title}</Heading>
        {reason ? <p className="break-words text-sm text-muted">{reason}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-attention-action="">{action}</div>
    </section>
  );
}
