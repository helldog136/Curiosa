import type { BadgeTone } from "@/core/blocks";
import { Badge } from "./Badge";

/** The shape that goes with each tone, so the state is never told by colour alone (R28): the word is always written too. */
const GLYPH: Record<BadgeTone, string> = { ok: "✓", warn: "▲", danger: "✕", info: "i", accent: "●", neutral: "–" };

/**
 * STATE PILL (C3c): one short word in a coloured pill with a shape in front of it (check, triangle, cross...). The colour comes from `Badge`; the shape and the
 * written word mean it still reads in grey, in high contrast and for a screen reader (the shape is hidden from it, the word is read). Use it for a state of a thing
 * (configured, degraded, paused), never for a label that is the same on every row (R14). A precision goes in `title` (R32).
 */
export function StatusPill({ tone = "neutral", children, title, testid }: { tone?: BadgeTone; children: React.ReactNode; title?: string; testid?: string }) {
  return (
    <Badge tone={tone} title={title} testid={testid}>
      <span aria-hidden="true" data-pill-glyph={tone} className="mr-1 text-[0.7rem] leading-none">{GLYPH[tone]}</span>
      {children}
    </Badge>
  );
}
