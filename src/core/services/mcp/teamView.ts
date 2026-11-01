/**
 * Les assistants IA vus comme des membres de l'équipe (page Équipe). Logique pure, testée telle quelle : la page ne fait que l'afficher.
 * La PRÉSENTATION est unifiée avec celle des personnes, pas le modèle : un assistant n'a ni rôle, ni mot de passe, ni double vérification ;
 * ses droits restent ceux de `access.ts` (plafond, actions accordées), résumés ici sans jargon.
 */
import type { Ability } from "./accessView";

/** Ce qui distingue une ligne : une personne ou un assistant IA (colonne « Type » et pastilles de filtre). */
export type MemberKind = "person" | "assistant";

/** Valeur de filtre d'une ligne : le type, puis (personnes) son rôle. Plusieurs valeurs séparées par une espace (voir LiveSearch). */
export function memberFilter(kind: MemberKind, role?: string): string {
  return kind === "person" && role ? `person ${role}` : kind;
}

/**
 * Le résumé court des droits, du plus fort au plus faible : l'entretien du site d'abord, puis l'écriture, puis la lecture.
 * Renvoie la clé de texte du résumé et, à part, si l'assistant peut aussi supprimer.
 */
export type RightsSummary = { level: "none" | "read" | "write" | "upkeep.watch" | "upkeep.act"; canDelete: boolean };
export function summarizeRights(list: readonly Ability[]): RightsSummary {
  const canDelete = list.includes("delete");
  if (list.includes("maintenance.act")) return { level: "upkeep.act", canDelete };
  if (list.includes("write")) return { level: "write", canDelete };
  if (list.includes("read")) return { level: "read", canDelete };
  if (list.includes("maintenance.watch")) return { level: "upkeep.watch", canDelete };
  return { level: "none", canDelete };
}

/** Les seuls états à montrer sur une ligne : l'état normal (accès actif) ne s'écrit pas (R14). */
export type AssistantFlag = "paused" | "waiting" | "neverUsed";

export function assistantFlags(input: { enabled: boolean; pending: number; lastActivity: Date | null }): AssistantFlag[] {
  const out: AssistantFlag[] = [];
  if (!input.enabled) out.push("paused");
  if (input.pending > 0) out.push("waiting");
  if (!input.lastActivity) out.push("neverUsed");
  return out;
}

/** La dernière activité : la plus récente entre la dernière utilisation de l'accès et la dernière ligne du Journal central signée de ce nom. */
export function lastActivity(usedAt: Date | null | undefined, journalAt: Date | null | undefined): Date | null {
  if (usedAt && journalAt) return usedAt.getTime() >= journalAt.getTime() ? usedAt : journalAt;
  return usedAt ?? journalAt ?? null;
}

/** Adresse du Journal d'audit filtré sur ce que cet assistant a fait (origine « assistant » + son nom). */
export function assistantHistoryHref(name: string): string {
  return `/admin/audit?${new URLSearchParams({ kind: "assistant", q: name }).toString()}`;
}
