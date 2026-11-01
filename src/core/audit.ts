import { prisma } from "@/core/db";
import { isActorKind, isLevel, type ActorKind, type JournalLevel } from "@/core/journal/events";

/** Lecture du journal d'audit (qui a fait quoi, quand) : recherche texte, filtres, pagination, plus récent d'abord. Les écritures passent par `audit()` (permissions.ts) ou par `ctx.api.log.write` (journal/write.ts). */
export type AuditRow = {
  id: string; actor: string; action: string; target: string; createdAt: Date;
  /** Module propriétaire de la ligne (identifiant) et instance (clé) ; vides = une ligne du cœur. */
  module: string; instance: string;
  level: string; actorKind: string;
  /** JSON borné des champs déclarés par le module ; vide pour une ligne générique. */
  data: string;
};
export const AUDIT_PAGE_SIZE = 100;
/** Valeur du filtre « extension » qui ne garde que les lignes du cœur (sans extension). Pas un identifiant valide : aucune extension ne peut la porter. */
export const CORE_ONLY = "_core";
/** Périodes proposées par le filtre « Quand » : jours en arrière. */
export const AUDIT_PERIODS = { day: 1, week: 7, month: 30 } as const;
export type AuditPeriod = keyof typeof AUDIT_PERIODS;

export type AuditFilter = {
  q?: string;
  page?: number;
  /** Seulement les lignes de ce module (identifiant). */
  module?: string;
  /** Seulement les lignes de cette instance (clé). */
  instance?: string;
  level?: string;
  /** person | module | assistant | system */
  kind?: string;
  period?: string;
  pageSize?: number;
  /** Date de référence de `period` (tests). */
  now?: Date;
};

/** La condition de recherche d'un filtre (réutilisée par le compte, la liste et l'outil MCP). Un filtre inconnu est ignoré, jamais une erreur. */
export function auditWhere(f: AuditFilter): Record<string, unknown> {
  const q = (f.q ?? "").trim().slice(0, 100);
  const and: Record<string, unknown>[] = [];
  if (q) and.push({ OR: [{ actor: { contains: q } }, { action: { contains: q } }, { target: { contains: q } }, { module: { contains: q } }, { data: { contains: q } }] });
  if (f.module === CORE_ONLY) and.push({ module: "" });
  else if (f.module) and.push({ module: f.module });
  if (f.instance) and.push({ instance: f.instance });
  if (isLevel(f.level)) and.push({ level: f.level });
  if (isActorKind(f.kind)) and.push({ actorKind: f.kind });
  const days = f.period && Object.hasOwn(AUDIT_PERIODS, f.period) ? AUDIT_PERIODS[f.period as AuditPeriod] : 0;
  if (days) and.push({ createdAt: { gte: new Date((f.now ?? new Date()).getTime() - days * 24 * 3600 * 1000) } });
  return and.length ? { AND: and } : {};
}

export async function listAudit(opts: AuditFilter = {}): Promise<{ rows: AuditRow[]; total: number; page: number; pages: number }> {
  const where = auditWhere(opts);
  const size = Math.min(AUDIT_PAGE_SIZE, Math.max(1, Math.trunc(opts.pageSize ?? AUDIT_PAGE_SIZE) || AUDIT_PAGE_SIZE));
  const total = await prisma.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Math.trunc(opts.page ?? 1) || 1));
  const rows = await prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * size, take: size });
  return { rows, total, page, pages };
}

export type { ActorKind, JournalLevel };
