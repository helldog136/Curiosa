/**
 * État d'une entrée tel qu'on le dit à une personne : « brouillon » (rien ne se voit sur le site), « programmée » (publiée, mais la date de parution
 * n'est pas arrivée), « expirée » (publiée, mais la date de fin est passée) ou « publiée » (visible maintenant).
 */
export type EntryState = "draft" | "scheduled" | "expired" | "published";

export function entryState(e: { status: string; publishedAt: Date | null; expiresAt: Date | null }, now: Date = new Date()): EntryState {
  if (e.status !== "published") return "draft";
  if (e.expiresAt && e.expiresAt.getTime() <= now.getTime()) return "expired";
  if (e.publishedAt && e.publishedAt.getTime() > now.getTime()) return "scheduled";
  return "published";
}
