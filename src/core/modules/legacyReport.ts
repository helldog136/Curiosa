import { prisma } from "@/core/db";
import { readGitManifest } from "./registry";
import { isEmptyStored } from "./legacySettings";
import type { ParsedManifest } from "./manifest";

/**
 * RAPPORT D'HÉRITAGE (0.2.0, contrat 10) — LECTURE SEULE. Ce qui reste d'une ancienne installation, compté sans rien modifier :
 *   - lignes de modules `bundled` / `builtin` (copiées par les premières versions du cœur) ;
 *   - modules et instances « éteints » (`enabled = false`, état supprimé en 0.1.20) ;
 *   - instances dont les données sont en retard (`__dataVersion` < version du module), mises à l'écart (échec, plancher, délai) ou plus récentes que le module ;
 *   - instances d'un module qui déclare `seeds` sans aucune marque `__seeds.*` (reprise pas encore faite) ;
 *   - collections `legacyCollections` non vides ;
 *   - valeurs présentes dans des `legacySettings` (le NOM de la clé seulement, jamais la valeur, même masquée) ;
 *   - réglages orphelins : clé ni déclarée, ni `legacySettings`, ni `__*` (signalés, jamais supprimés en 0.2.0).
 * Les lignes `bundled` / `builtin` : compatibilité sites anciens, à retirer en phase 3 (0.3.0 au plus tard) avec le code qui les convertit.
 * Le cœur ne lit les manifestes que sur le disque (aucun code de module n'est exécuté ici). Listes bornées (LIST_MAX), totaux exacts.
 */
export const LEGACY_MARKER = "core.legacyCleared";
export type LegacyMarker = { version: string; at: string; counts: Record<string, number> };
const LIST_MAX = 50;

export type InstanceItem = { key: string; module: string; from: number; to: number };
export type LegacyReport = {
  marker: LegacyMarker | null;
  sourceRows: { id: string; source: string; version: string }[];
  switchedOff: { modules: string[]; instances: string[] };
  behind: InstanceItem[];
  failed: (InstanceItem & { reason: "floor" | "timeout" | "error"; floor?: number })[];
  newer: InstanceItem[];
  seedsMissing: { key: string; module: string }[];
  collections: { key: string; module: string; collection: string; count: number }[];
  legacyValues: { key: string; module: string; settings: string[] }[];
  orphans: { key: string; module: string; settings: string[] }[];
  /** Totaux exacts (les listes ci-dessus sont bornées). */
  totals: { sourceRows: number; switchedOffModules: number; switchedOffInstances: number; behind: number; failed: number; newer: number; seedsMissing: number; collections: number; legacyValues: number; orphans: number };
  /** Rien ne retient la conversion : aucune ligne héritée, rien d'éteint, aucune instance en retard ou mise à l'écart faute de conversion. */
  converted: boolean;
  /** Rien du tout à signaler (rapport « à zéro »). */
  clean: boolean;
};

const cap = <T>(list: T[]): T[] => list.slice(0, LIST_MAX);

/** Le marqueur posé par le balayage, ou null (lecture prudente : un marqueur illisible vaut « absent »). */
export async function readLegacyMarker(): Promise<LegacyMarker | null> {
  const raw = (await prisma.setting.findUnique({ where: { key_locale: { key: LEGACY_MARKER, locale: "" } } }).catch(() => null))?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LegacyMarker>;
    return typeof v?.version === "string" && typeof v.at === "string" ? { version: v.version, at: v.at, counts: v.counts && typeof v.counts === "object" ? v.counts : {} } : null;
  } catch { return null; }
}

/** Le marqueur manque-t-il ? (bandeau d'avertissement de l'admin). Ne lève jamais : en cas de doute, on n'affiche rien plutôt que d'inquiéter. */
export async function legacyConversionPending(): Promise<boolean> {
  try { return (await readLegacyMarker()) === null; } catch { return false; }
}

function intOf(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  try { const v = Number(JSON.parse(raw)); return Number.isInteger(v) && v >= 1 ? v : null; } catch { return null; }
}

/** Compte tout ce qui reste de l'héritage. Lecture seule, sans réseau. */
export async function legacyReport(): Promise<LegacyReport> {
  const [rows, instances, settings] = await Promise.all([
    prisma.module.findMany({ select: { id: true, source: true, version: true, enabled: true }, orderBy: { id: "asc" } }),
    prisma.moduleInstance.findMany({ select: { id: true, key: true, moduleId: true, enabled: true }, orderBy: [{ moduleId: "asc" }, { key: "asc" }] }),
    prisma.setting.findMany({ where: { key: { startsWith: "instance." } }, select: { key: true, value: true } }),
  ]);
  const manifests = new Map<string, ParsedManifest | null>();
  for (const r of rows) manifests.set(r.id, readGitManifest(r.id));

  // Réglages par instance : clé (sans le préfixe) → valeurs (une par langue).
  const byInstance = new Map<string, Map<string, string[]>>();
  for (const s of settings) {
    const rest = s.key.slice("instance.".length);
    const dot = rest.indexOf(".");
    if (dot <= 0) continue;
    const id = rest.slice(0, dot), key = rest.slice(dot + 1);
    const m = byInstance.get(id) ?? new Map<string, string[]>();
    m.set(key, [...(m.get(key) ?? []), s.value]);
    byInstance.set(id, m);
  }

  const sourceRows = rows.filter((r) => r.source === "bundled" || r.source === "builtin").map((r) => ({ id: r.id, source: r.source, version: r.version }));
  const offModules = rows.filter((r) => !r.enabled).map((r) => r.id);
  const offInstances = instances.filter((i) => !i.enabled).map((i) => i.key);
  const behind: LegacyReport["behind"] = [], failed: LegacyReport["failed"] = [], newer: LegacyReport["newer"] = [];
  const seedsMissing: LegacyReport["seedsMissing"] = [], collections: LegacyReport["collections"] = [];
  const legacyValues: LegacyReport["legacyValues"] = [], orphans: LegacyReport["orphans"] = [];

  for (const inst of instances) {
    const manifest = manifests.get(inst.moduleId);
    if (!manifest) continue;   // module absent ou illisible : rien à comparer (signalé ailleurs par la maintenance)
    const own = byInstance.get(inst.id) ?? new Map<string, string[]>();
    const from = intOf(own.get("__dataVersion")?.[0]) ?? 1;
    const to = manifest.dataVersion ?? 1;
    let status: { status?: string; error?: string; floor?: number } | null = null;
    try { status = own.has("__dataStatus") ? JSON.parse(own.get("__dataStatus")![0]!) : null; } catch { status = null; }
    const item = { key: inst.key, module: inst.moduleId, from, to };
    if (status?.status === "newer" || from > to) newer.push(item);
    else if (status?.status === "failed") failed.push({ ...item, reason: status.error === "floor" ? "floor" : status.error === "timeout" ? "timeout" : "error", ...(Number.isInteger(status.floor) ? { floor: status.floor } : {}) });
    else if (from < to) behind.push(item);

    if (manifest.seeds?.length && ![...own.keys()].some((k) => k.startsWith("__seeds."))) seedsMissing.push({ key: inst.key, module: inst.moduleId });

    for (const collection of manifest.legacyCollections ?? []) {
      const count = await prisma.moduleRecord.count({ where: { instanceId: inst.id, collection } });
      if (count) collections.push({ key: inst.key, module: inst.moduleId, collection, count });
    }

    const declared = new Set(manifest.settings.map((f) => f.key));
    const legacy = new Set((manifest.legacySettings ?? []).map((l) => l.key));
    const present: string[] = [], orphan: string[] = [];
    for (const [key, values] of own) {
      if (key.startsWith("__") || declared.has(key)) continue;
      const filled = values.some((v) => !isEmptyStored(v));
      if (legacy.has(key)) { if (filled) present.push(key); }
      else orphan.push(key);
    }
    if (present.length) legacyValues.push({ key: inst.key, module: inst.moduleId, settings: present.sort() });
    if (orphan.length) orphans.push({ key: inst.key, module: inst.moduleId, settings: orphan.sort() });
  }

  const totals = {
    sourceRows: sourceRows.length, switchedOffModules: offModules.length, switchedOffInstances: offInstances.length,
    behind: behind.length, failed: failed.length, newer: newer.length, seedsMissing: seedsMissing.length,
    collections: collections.length, legacyValues: legacyValues.length, orphans: orphans.length,
  };
  const converted = !totals.sourceRows && !totals.switchedOffModules && !totals.switchedOffInstances && !totals.behind && !totals.failed;
  return {
    marker: await readLegacyMarker(),
    sourceRows: cap(sourceRows), switchedOff: { modules: cap(offModules), instances: cap(offInstances) },
    behind: cap(behind), failed: cap(failed), newer: cap(newer), seedsMissing: cap(seedsMissing), collections: cap(collections),
    legacyValues: cap(legacyValues), orphans: cap(orphans),
    totals, converted, clean: converted && Object.values(totals).every((n) => n === 0),
  };
}

/** Pour l'outil MCP de maintenance : la même chose, en anglais simple, sans aucune valeur de réglage. */
export async function legacyReportForAssistant() {
  const r = await legacyReport();
  return {
    conversionFinished: r.marker !== null,
    ...(r.marker ? { finishedAt: r.marker.at, finishedBy: r.marker.version } : { note: "The startup conversion of data from older versions has not finished yet. The public site works normally. It is retried at every start; the owner can also start it again from the admin page /admin/maintenance/legacy." }),
    totals: r.totals,
    oldModuleRows: r.sourceRows,
    switchedOff: r.switchedOff,
    instancesBehind: r.behind,
    instancesSetAside: r.failed,
    instancesNewerThanModule: r.newer,
    takeoverNotDone: r.seedsMissing,
    collectionsToEmpty: r.collections,
    keptSettingsWithValue: r.legacyValues,
    unknownSettings: r.orphans,
  };
}
