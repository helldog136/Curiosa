import { prisma } from "../db";
import { RESERVED_PATHS } from "../config";
import { isKnownLocale } from "../i18n/locales";
import { pickKnownColumns } from "../backup/schema";
import { bumpGenerations } from "../services/store";
import { migrateModuleInstances, type MigrationOutcome } from "./dataMigrations";
import { getModule } from "./registry";
import { localized } from "./types";
import { planRestore, parsePayload, reviveDates, type RetiredLine, type RetiredPayload, type Row } from "./retiredPlan";

/**
 * DONNÉES MISES DE CÔTÉ — ce que devient une instance retirée en « gardant mes données » (désinstallation d'un module, suppression d'une instance).
 *
 * Choix de stockage : une table du CŒUR, `RetiredInstance`, une ligne par instance, avec tout ce qu'elle possédait en un seul bloc JSON inerte. Les données
 * quittent donc les tables vivantes (instances, entrées, réglages, stockage) : le site, l'API, le MCP, les flux, les tâches planifiées, le menu et le
 * module lui-même ne PEUVENT pas les lire — il n'y a aucun filtre à penser, donc aucune fuite possible par oubli. Seul ce fichier lit le bloc, et il ne le
 * rend jamais à un module. Un module reste propriétaire de ses données (SRP) : le cœur ne les interprète pas, il les range et les remet à l'identique
 * (mêmes identifiants, donc mêmes références). La sauvegarde du site les contient (data/retired-instances.json).
 */
export type RetiredReason = "uninstall" | "delete" | "legacy";

const prefix = (id: string) => `instance.${id}.`;
const toLine = (r: { id: string; moduleId: string; key: string; label: string; moduleName: string; reason: string; retiredAt: Date; entryCount: number; recordCount: number; repoUrl: string | null; ref: string | null; subdir: string | null }): RetiredLine => ({ id: r.id, moduleId: r.moduleId, key: r.key, label: r.label, moduleName: r.moduleName, reason: r.reason, retiredAt: r.retiredAt, entryCount: r.entryCount, recordCount: r.recordCount, repoUrl: r.repoUrl, ref: r.ref, subdir: r.subdir });

/** Range une instance (tout ce qu'elle possède) puis l'ôte du site, en une seule opération : tout ou rien. Rien n'est supprimé du bloc rangé. */
export async function retireInstance(id: string, reason: RetiredReason): Promise<RetiredLine | null> {
  const inst = await prisma.moduleInstance.findUnique({ where: { id }, include: { translations: true } });
  if (!inst) return null;
  const [entries, settings, records, moduleRow, mod] = await Promise.all([
    prisma.entry.findMany({ where: { instanceId: id }, include: { translations: true }, orderBy: { createdAt: "asc" } }),
    prisma.setting.findMany({ where: { key: { startsWith: prefix(id) } }, orderBy: [{ key: "asc" }, { locale: "asc" }] }),
    prisma.moduleRecord.findMany({ where: { instanceId: id }, orderBy: { createdAt: "asc" } }),
    prisma.module.findUnique({ where: { id: inst.moduleId } }),
    getModule(inst.moduleId).catch(() => null),
  ]);
  const { translations, ...instance } = inst;
  const payload: RetiredPayload = {
    v: 1,
    instance: JSON.parse(JSON.stringify(instance)) as Row,
    translations: JSON.parse(JSON.stringify(translations)) as Row[],
    entries: JSON.parse(JSON.stringify(entries.map((e) => { const row: Row = { ...e }; delete row.translations; return row; }))) as Row[],
    entryTranslations: JSON.parse(JSON.stringify(entries.flatMap((e) => e.translations))) as Row[],
    settings: settings.map((s) => ({ key: s.key, locale: s.locale, value: s.value })),
    records: JSON.parse(JSON.stringify(records)) as Row[],
  };
  const label = inst.nickname?.trim() || translations.find((t) => t.name.trim())?.name || inst.key;
  const moduleName = mod ? localized(mod.manifest.name, "en", "en") : inst.moduleId;
  const data = {
    moduleId: inst.moduleId, key: inst.key, label, moduleName, reason,
    repoUrl: moduleRow?.repoUrl ?? null, ref: moduleRow?.ref ?? null, subdir: moduleRow?.subdir ?? null,
    entryCount: entries.length, recordCount: records.length, payload: JSON.stringify(payload),
  };
  const [saved] = await prisma.$transaction([
    prisma.retiredInstance.upsert({ where: { id }, create: { id, ...data }, update: { ...data, retiredAt: new Date() } }),
    prisma.setting.deleteMany({ where: { key: { startsWith: prefix(id) } } }),
    prisma.moduleRecord.deleteMany({ where: { instanceId: id } }),
    prisma.moduleInstance.delete({ where: { id } }),   // ses traductions et ses entrées partent avec (suppression en cascade)
  ]);
  return toLine(saved);
}

/** Range toutes les instances d'un module (désinstallation en gardant les données). */
export async function retireModuleInstances(moduleId: string, reason: RetiredReason): Promise<RetiredLine[]> {
  const out: RetiredLine[] = [];
  for (const { id } of await prisma.moduleInstance.findMany({ where: { moduleId }, select: { id: true } })) {
    const line = await retireInstance(id, reason);
    if (line) out.push(line);
  }
  return out;
}

export type RestoreOutcome =
  | { ok: true; id: string; key: string; changed: ("key" | "basePath" | "nickname")[] }
  | { ok: false; id: string; reason: "single" | "exists" | "missing" | "unreadable" | "no-module" };

/** Remet UNE instance rangée, à l'identique (mêmes identifiants) ; seuls l'adresse ou l'identifiant technique changent s'ils ont été pris entre-temps. */
export async function restoreInstance(id: string): Promise<RestoreOutcome> {
  const row = await prisma.retiredInstance.findUnique({ where: { id } });
  if (!row) return { ok: false, id, reason: "missing" };
  const payload = parsePayload(row.payload);
  if (!payload) return { ok: false, id, reason: "unreadable" };
  const mod = await getModule(row.moduleId).catch(() => null);
  if (!mod) return { ok: false, id, reason: "no-module" };

  const [instances, ids] = await Promise.all([
    prisma.moduleInstance.findMany({ select: { id: true, key: true, basePath: true, nickname: true, moduleId: true } }),
    prisma.moduleInstance.findUnique({ where: { id }, select: { id: true } }),
  ]);
  const mine = instances.filter((i) => i.moduleId === row.moduleId);
  const original = payload.instance as { key?: string; basePath?: string | null; nickname?: string | null };
  const plan = planRestore(
    { id, key: String(original.key ?? row.key), basePath: original.basePath ?? null, nickname: original.nickname ?? null },
    {
      ids: new Set(ids ? [id] : []), keys: new Set(instances.map((i) => i.key)), basePaths: new Set(instances.flatMap((i) => (i.basePath === null ? [] : [i.basePath]))),
      nicknames: mine.map((i) => i.nickname).filter((n): n is string => !!n), siblings: mine.length, single: mod.manifest.instances === "single",
      reserved: (p) => RESERVED_PATHS.has(p) || isKnownLocale(p),
    },
  );
  if (!plan.ok) return { ok: false, id, reason: plan.reason };

  const authorIds = [...new Set(payload.entries.map((e) => e.authorId).filter((a): a is string => typeof a === "string"))];
  const knownAuthors = new Set((await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true } })).map((u) => u.id));

  await prisma.$transaction(async (tx) => {
    await tx.setting.deleteMany({ where: { key: { startsWith: prefix(id) } } });   // jamais de reste d'une vie antérieure
    const live = pickKnownColumns("instances", reviveDates("instance", { ...payload.instance, key: plan.key, basePath: plan.basePath, nickname: plan.nickname, enabled: true }));
    await tx.moduleInstance.create({ data: live as never });
    for (const t of payload.translations) await tx.instanceTranslation.create({ data: pickKnownColumns("instanceTranslations", t) as never });
    for (const e of payload.entries) {
      const entry = pickKnownColumns("entries", reviveDates("entry", { ...e, authorId: typeof e.authorId === "string" && knownAuthors.has(e.authorId) ? e.authorId : null }));
      await tx.entry.create({ data: entry as never });
    }
    for (const t of payload.entryTranslations) await tx.entryTranslation.create({ data: pickKnownColumns("entryTranslations", reviveDates("entryTranslation", t)) as never });
    for (const s of payload.settings) await tx.setting.create({ data: { key: s.key, locale: s.locale, value: s.value } });
    for (const r of payload.records) await tx.moduleRecord.create({ data: pickKnownColumns("records", reviveDates("record", r)) as never });
    await tx.retiredInstance.delete({ where: { id } });
  }, { timeout: 120_000, maxWait: 10_000 });
  // Le stockage revient de l'extérieur (données gardées) : la génération augmente à partir de celle gardée avec les réglages.
  await bumpGenerations([id]).catch((e) => console.error("[retired] store generation bump failed:", (e as Error)?.message));
  return { ok: true, id, key: plan.key, changed: plan.changed };
}

export type RestoreReport = { restored: Extract<RestoreOutcome, { ok: true }>[]; kept: Extract<RestoreOutcome, { ok: false }>[]; migrations: MigrationOutcome[] };

/**
 * Réinstallation d'un module : toutes ses instances rangées reviennent, puis leurs données sont mises à niveau si le module a changé de version
 * (même mécanisme qu'une mise à jour). Ce qui ne peut pas revenir (module à instance unique déjà servi…) reste rangé, intact. Ne lève jamais.
 */
export async function restoreModuleInstances(moduleId: string): Promise<RestoreReport> {
  const report: RestoreReport = { restored: [], kept: [], migrations: [] };
  try {
    const rows = await prisma.retiredInstance.findMany({ where: { moduleId }, select: { id: true }, orderBy: [{ retiredAt: "asc" }, { key: "asc" }] });
    for (const { id } of rows) {
      let r: RestoreOutcome;
      try { r = await restoreInstance(id); } catch (error) { console.error(`[retired] restoring ${id} failed:`, (error as Error)?.message); r = { ok: false, id, reason: "unreadable" }; }
      if (r.ok) report.restored.push(r); else report.kept.push(r);
    }
    if (report.restored.length) report.migrations = (await migrateModuleInstances(moduleId).catch(() => [])).filter((m) => m.status !== "none");
  } catch (error) {
    console.error(`[retired] restoring ${moduleId} failed:`, (error as Error)?.message);
  }
  return report;
}

/** Données gardées (sans leur contenu) : pour dire « vos données de X ont été gardées » et proposer de les retrouver ou de les effacer. */
export async function listRetired(moduleId?: string): Promise<RetiredLine[]> {
  const rows = await prisma.retiredInstance.findMany({
    where: moduleId ? { moduleId } : undefined, orderBy: [{ retiredAt: "desc" }, { key: "asc" }],
    select: { id: true, moduleId: true, key: true, label: true, moduleName: true, reason: true, retiredAt: true, entryCount: true, recordCount: true, repoUrl: true, ref: true, subdir: true },
  });
  return rows.map(toLine);
}

/** « Tout effacer » pour des données déjà rangées : un module (toutes ses instances) ou une seule instance. Irréversible. */
export async function eraseRetired(target: { moduleId: string } | { id: string }): Promise<number> {
  const r = await prisma.retiredInstance.deleteMany({ where: "id" in target ? { id: target.id } : { moduleId: target.moduleId } });
  return r.count;
}
