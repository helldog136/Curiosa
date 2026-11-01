import type { BadgeTone } from "@/core/blocks";

/** Une pastille : couleur ET texte, jamais la couleur seule. Partagée par le tableau des extensions (`AdminTable`) et les pages du cœur (Équipe, Rôles). */
export const BADGE: Record<BadgeTone, string> = {
  accent: "bg-accent/10 text-accent",
  info: "bg-sky-500/15 text-sky-800",
  ok: "bg-emerald-500/15 text-emerald-800",
  warn: "bg-amber-500/20 text-amber-900",
  danger: "bg-red-500/15 text-red-800",
  neutral: "bg-line/60 text-fg",
};

export function Badge({ tone = "neutral", children, title, testid }: { tone?: BadgeTone; children: React.ReactNode; title?: string; testid?: string }) {
  return <span title={title} data-testid={testid} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[tone]}`}>{children}</span>;
}
