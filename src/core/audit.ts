import { prisma } from "@/core/db";

/** Lecture du journal d'audit (qui a fait quoi, quand) : recherche texte, pagination, plus récent d'abord. Les écritures passent par `audit()` (permissions.ts). */
export type AuditRow = { id: string; actor: string; action: string; target: string; createdAt: Date };
export const AUDIT_PAGE_SIZE = 100;

export async function listAudit(opts: { q?: string; page?: number } = {}): Promise<{ rows: AuditRow[]; total: number; page: number; pages: number }> {
  const q = (opts.q ?? "").trim().slice(0, 100);
  const where = q ? { OR: [{ actor: { contains: q } }, { action: { contains: q } }, { target: { contains: q } }] } : {};
  const total = await prisma.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.trunc(opts.page ?? 1) || 1));
  const rows = await prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE });
  return { rows, total, page, pages };
}
