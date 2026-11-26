import type { BadgeTone } from "@/core/blocks";

/** Une pastille : couleur ET texte, jamais la couleur seule. Partagée par le tableau des extensions (`AdminTable`) et les pages du cœur (Équipe, Rôles). */
export const BADGE: Record<BadgeTone, string> = {
  accent: "bg-accent-tint text-accent-text",
  info: "bg-sky-500/15 text-sky-800",
  ok: "bg-ok-soft text-ok-text",
  warn: "bg-warn-soft text-warn-text",
  danger: "bg-danger-soft text-danger-text",
  neutral: "bg-neutral-soft text-neutral-text",
};

export function Badge({ tone = "neutral", children, title, testid }: { tone?: BadgeTone; children: React.ReactNode; title?: string; testid?: string }) {
  return <span title={title} data-testid={testid} className={`inline-flex min-h-6 max-w-full items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 ${BADGE[tone]}`}>{children}</span>;
}
