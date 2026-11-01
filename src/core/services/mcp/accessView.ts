/**
 * Ce qu'on montre d'un accès d'assistant IA, sans jargon. Logique pure : testée telle quelle, utilisée par les pages.
 * Les droits eux-mêmes se décident dans access.ts ; ici on ne fait que les résumer.
 */

type Lifecycle = { revokedAt: Date | null; expiresAt?: Date | null };

export type AccessState = "active" | "revoked" | "expired";

/** Révoqué l'emporte sur expiré (c'est la décision de la personne). Aujourd'hui aucun accès n'expire tout seul : `expiresAt` reste vide. */
export function accessState(row: Lifecycle, now: Date): AccessState {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** Les accès actifs d'un côté (ordre conservé), les expirés ou révoqués de l'autre. */
export function splitAccesses<T extends Lifecycle>(rows: T[], now: Date): { active: T[]; inactive: T[] } {
  const active: T[] = [];
  const inactive: T[] = [];
  for (const r of rows) (accessState(r, now) === "active" ? active : inactive).push(r);
  return { active, inactive };
}

/** Une action autorisée, vue sous l'angle « que change-t-elle ». */
export type AllowedTool = { readOnly: boolean; destructive?: boolean; source: string };

/** Phrases possibles, dans l'ordre où on les affiche. */
export type Ability = "none" | "read" | "write" | "delete" | "maintenance.watch" | "maintenance.act";

/** Source des outils d'entretien du site (voir core/maintenance/tools.ts). */
const MAINTENANCE_SOURCE = "maintenance";

/** « Ce qu'il peut faire », en quelques phrases courtes, à partir des actions réellement autorisées pour cet accès. */
export function abilities(allowed: AllowedTool[]): Ability[] {
  if (allowed.length === 0) return ["none"];
  const site = allowed.filter((x) => x.source !== MAINTENANCE_SOURCE);
  const upkeep = allowed.filter((x) => x.source === MAINTENANCE_SOURCE);
  const out: Ability[] = [];
  if (site.length > 0) out.push(site.some((x) => !x.readOnly) ? "write" : "read");
  if (site.some((x) => x.destructive)) out.push("delete");
  if (upkeep.length > 0) out.push(upkeep.some((x) => !x.readOnly) ? "maintenance.act" : "maintenance.watch");
  return out;
}
