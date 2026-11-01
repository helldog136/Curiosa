import { prisma } from "@/core/db";
import { ACTION_RE_FOR_MODULE, RESERVED_ACTION_RE, cleanText, isLevel, JOURNAL_LIMITS, serializeData, shapeData, type ActorKind, type JournalLevel, type LogEventDecl } from "./events";

/**
 * ÉCRITURE AU JOURNAL CENTRAL (cœur 0.6.0). Un seul chemin pour les modules (`ctx.api.log.write`, voir modules/api.ts) et pour le cœur.
 * Jamais d'exception vers l'appelant. Pas de minuteur de fond : chaque écriture purge, en petites tranches, ce qui dépasse les bornes DU MODULE concerné.
 */

export type JournalActor = { kind: ActorKind; name: string };
export type JournalWrite = {
  action: string;
  target?: unknown;
  level?: unknown;
  data?: unknown;
  /** Qui agit : déduit par le cœur, jamais fourni par un module. */
  actor: JournalActor;
  module: string;
  instance: string;
  /** Les événements déclarés par le module (manifeste) ; absents = lignes génériques sans données. */
  events?: readonly LogEventDecl[];
};

/** Écrit une ligne pour un module. `true` si elle est enregistrée. */
export async function writeModuleLog(input: JournalWrite): Promise<boolean> {
  try {
    const action = typeof input.action === "string" ? input.action.trim() : "";
    if (!ACTION_RE_FOR_MODULE.test(action) || RESERVED_ACTION_RE.test(action)) return false;
    const decl = input.events?.find((e) => e.key === action);
    const level: JournalLevel = isLevel(input.level) ? input.level : decl?.level ?? "info";
    const data = decl ? serializeData(shapeData(decl, input.data)) : "";
    const target = cleanText(input.target) ?? "";
    await prisma.auditLog.create({ data: { actor: input.actor.name.slice(0, 200), actorKind: input.actor.kind, action, target, level, data, module: input.module, instance: input.instance } });
    await purgeModuleLog(input.module, (input.events ?? []).filter((e) => e.frequent === true).map((e) => e.key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remet le journal d'UN module dans ses bornes, par tranches de `purgeSlice` lignes au plus par étape : trop vieilles (90 jours), trop nombreuses (500),
 * puis les événements `frequent` (7 jours, 200 lignes). Les lignes sans module (celles du cœur) ne sont jamais touchées. Ne lève jamais.
 */
export async function purgeModuleLog(module: string, frequentKeys: readonly string[] = [], now: Date = new Date()): Promise<number> {
  if (!module) return 0;
  const L = JOURNAL_LIMITS;
  let removed = 0;
  const drop = async (where: object, take: number): Promise<void> => {
    if (take <= 0) return;
    const rows = await prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.min(take, L.purgeSlice), select: { id: true } });
    if (rows.length === 0) return;
    const res = await prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    removed += res.count;
  };
  try {
    const day = 24 * 3600 * 1000;
    await drop({ module, createdAt: { lt: new Date(now.getTime() - L.retentionDays * day) } }, L.purgeSlice);
    const total = await prisma.auditLog.count({ where: { module } });
    await drop({ module }, total - L.maxPerModule);
    if (frequentKeys.length > 0) {
      const frequent = { module, action: { in: [...frequentKeys] } };
      await drop({ ...frequent, createdAt: { lt: new Date(now.getTime() - L.frequentDays * day) } }, L.purgeSlice);
      const count = await prisma.auditLog.count({ where: frequent });
      await drop(frequent, count - L.frequentMax);
    }
  } catch {
    /* une purge qui échoue ne gêne jamais l'écriture : elle reprendra à la suivante */
  }
  return removed;
}
