import { forgetUpkeepSummary } from "./legacyUpkeep";
import { prisma } from "@/core/db";
import { withDeadline, TIMED_OUT } from "@/core/deadline";
import { getInstanceById } from "@/core/instances";
import { readVersion } from "@/core/updates/service";
import { dataStatusOf, dataVersionOf, markMigrationTimeout, migrateInstance, targetVersion, type MigrationOutcome } from "./dataMigrations";
import { sweepFromText } from "./choice";
import { isEmptyStored } from "./legacySettings";
import { LEGACY_MARKER, legacyReport, readLegacyMarker, type LegacyReport } from "./legacyReport";
import { getModule, readGitManifest } from "./registry";

/**
 * BALAYAGE DE CONVERSION AU DÉMARRAGE (0.2.0, contrat 10). Appelé par `register()` (src/instrumentation.ts), que Next attend AVANT de servir la
 * moindre requête : il est donc BORNÉ (20 s en tout, `SWEEP_BUDGET_MS`), sans réseau, et ne lève jamais. Étapes, toutes idempotentes :
 *   1. migrations de données en attente : une instance à la fois, dans le temps qui reste. Une instance mise à l'écart (échec, plancher, délai)
 *      n'est pas relancée d'office : « Réessayer » reste au propriétaire. Une conversion qui dépasse le temps est laissée finir en arrière-plan,
 *      l'instance étant mise à l'écart (`timeout`) d'ici là ;
 *   2. les valeurs VIDES de réglages hérités (`legacySettings`) et de réglages orphelins sont effacées (rien à reprendre). Une valeur non vide n'est
 *      jamais touchée ;
 *   3. les anciennes valeurs texte d'un réglage « choix » sont remplacées par l'identifiant (borné, jamais bloquant) ;
 *   4. si plus rien n'est à convertir, le marqueur `core.legacyCleared` est posé (une fois : sa date reste celle de la fin de la conversion).
 *      Sinon il n'est pas posé, le démarrage suivant reprend où celui-ci s'est arrêté, et l'admin l'explique (bandeau + page Entretien).
 * Journal : des nombres et des identifiants de modules, jamais une valeur de réglage.
 * Retiré (version minimale de mise à jour relevée à 0.2.0) : le rangement des modules « éteints » et la conversion des lignes `bundled` / `builtin` au
 * démarrage. Le démarrage de la 0.2.0, que tout site plus ancien traverse d'abord, les a faits. Une ligne `bundled` / `builtin` qui resterait est
 * signalée par le rapport (legacyReport.ts) et la personne choisit : la retirer en gardant ses données, ou la garder telle quelle.
 */
export const SWEEP_BUDGET_MS = 20_000;

export type SweepCounts = { migrated: number; setAside: number; emptied: number };
export type SweepResult = {
  /** Le marqueur est posé (maintenant ou avant). */
  done: boolean;
  /** Le temps est écoulé avant la fin : le démarrage suivant reprendra. */
  timedOut: boolean;
  /** Un autre balayage tournait déjà (« Relancer » pendant le démarrage) : rien n'a été fait. */
  busy?: boolean;
  counts: SweepCounts;
  remaining: LegacyReport["totals"] | null;
};

export type SweepOptions = {
  budgetMs?: number;
  now?: () => number;
  /** Tests : remplace la migration d'une instance (trou noir, lenteur). */
  migrate?: typeof migrateInstance;
  log?: (line: string) => void;
};

const globalSweep = globalThis as unknown as { curiosaLegacySweep?: boolean };

/** Instances dont les données attendent une conversion (ni mises à l'écart, ni plus récentes). Sans charger le code d'aucun module. */
async function pendingInstances(): Promise<{ id: string; moduleId: string }[]> {
  const rows = await prisma.module.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const out: { id: string; moduleId: string }[] = [];
  for (const row of rows) {
    const manifest = readGitManifest(row.id);
    if (!manifest || (manifest.dataVersion ?? 1) <= 1) continue;
    const instances = await prisma.moduleInstance.findMany({ where: { moduleId: row.id }, select: { id: true }, orderBy: { createdAt: "asc" } });
    for (const i of instances) {
      if ((await dataVersionOf(i.id)) >= targetVersion({ manifest })) continue;
      if (await dataStatusOf(i.id)) continue;
      out.push({ id: i.id, moduleId: row.id });
    }
  }
  return out;
}

/** Étape 4 : efface les valeurs VIDES des réglages hérités et orphelins des instances dont le module est lisible. Rend le nombre de lignes effacées. */
export async function sweepEmptyValues(): Promise<number> {
  const rows = await prisma.module.findMany({ select: { id: true } });
  let removed = 0;
  for (const row of rows) {
    const manifest = readGitManifest(row.id);
    if (!manifest) continue;
    const declared = new Set(manifest.settings.map((f) => f.key));
    const instances = await prisma.moduleInstance.findMany({ where: { moduleId: row.id }, select: { id: true } });
    for (const inst of instances) {
      const prefix = `instance.${inst.id}.`;
      const settings = await prisma.setting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, locale: true, value: true } });
      for (const s of settings) {
        const key = s.key.slice(prefix.length);
        if (key.startsWith("__") || key.includes(".") || declared.has(key) || !isEmptyStored(s.value)) continue;
        removed += (await prisma.setting.deleteMany({ where: { key: s.key, locale: s.locale } })).count;
      }
    }
  }
  return removed;
}

/** Le balayage complet (voir en tête). Ne lève jamais ; borné par `budgetMs`. */
export async function runLegacySweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const counts: SweepCounts = { migrated: 0, setAside: 0, emptied: 0 };
  if (globalSweep.curiosaLegacySweep) return { done: false, timedOut: false, busy: true, counts, remaining: null };
  globalSweep.curiosaLegacySweep = true;
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? SWEEP_BUDGET_MS;
  const deadline = now() + budget;
  const left = () => Math.max(0, deadline - now());
  const log = opts.log ?? ((line: string) => console.log(line));
  const migrate = opts.migrate ?? migrateInstance;
  let timedOut = false;
  // Le drapeau « en cours » tombe quand le TRAVAIL se termine (pas quand on cesse de l'attendre) : jamais deux balayages en même temps.
  const work = (async (): Promise<SweepResult> => {
    // 1. Migrations en attente, une instance à la fois.
    for (const p of await pendingInstances()) {
      if (left() <= 0) { timedOut = true; break; }
      const mod = await getModule(p.moduleId);
      const instance = await getInstanceById(p.id);
      if (!mod || !instance) continue;
      const r: MigrationOutcome | typeof TIMED_OUT = await withDeadline(() => migrate(mod, instance), left()).catch((e): MigrationOutcome => ({ key: instance.key, from: 0, to: 0, status: "failed", error: String((e as Error)?.name ?? "error") }));
      if (r === TIMED_OUT) {
        await markMigrationTimeout(p.id).catch(() => {});
        counts.setAside++;
        timedOut = true;
        break;
      }
      if (r.status === "ok") counts.migrated++;
      else if (r.status === "failed" || r.status === "newer") counts.setAside++;
    }
    // 2. Valeurs vides.
    if (!timedOut && left() > 0) counts.emptied = await sweepEmptyValues();
    else timedOut = true;
    // 3. Anciennes valeurs texte d'un réglage « choix » : remplacées par l'identifiant quand une seule option porte exactement ce nom (borné, jamais bloquant).
    if (!timedOut && left() > 0) await sweepFromText({ budgetMs: left() }).catch(() => undefined);
    // 4. Marqueur.
    const report = await legacyReport();
    const marker = await readLegacyMarker();
    let done = marker !== null;
    if (!timedOut && report.converted && !marker) {
      await prisma.setting.upsert({
        where: { key_locale: { key: LEGACY_MARKER, locale: "" } },
        create: { key: LEGACY_MARKER, locale: "", value: JSON.stringify({ version: readVersion(), at: new Date(now()).toISOString(), counts }) },
        update: {},
      });
      done = true;
    } else if (marker && report.totals.sourceRows) {
      // Des lignes héritées sont revenues (sauvegarde ancienne restaurée) : la conversion n'est plus terminée.
      await prisma.setting.deleteMany({ where: { key: LEGACY_MARKER } });
      done = false;
    }
    return { done, timedOut, counts, remaining: report.totals };
  })().finally(() => { globalSweep.curiosaLegacySweep = false; forgetUpkeepSummary(); });
  try {
    // Délai dur : un peu plus que le budget, pour que l'étape en cours puisse noter son propre dépassement (instance mise à l'écart).
    const result = await withDeadline(() => work, budget + 1_000);
    if (result === TIMED_OUT) {
      log(`[legacy] startup conversion stopped after ${Math.round(budget / 1000)} s; it resumes at the next start (${summary(counts)})`);
      return { done: false, timedOut: true, counts, remaining: null };
    }
    const r = result.remaining;
    log(`[legacy] startup conversion ${result.done ? "complete" : "not complete"}: ${summary(counts)}${r && !result.done ? `; remaining: old module rows ${r.sourceRows}, instances behind ${r.behind}, set aside ${r.failed}` : ""}`);
    return result;
  } catch (error) {
    log(`[legacy] startup conversion failed (${(error as Error)?.name ?? "error"}); it resumes at the next start`);
    return { done: false, timedOut, counts, remaining: null };
  }
}

const summary = (c: SweepCounts) =>
  `instances migrated ${c.migrated}, instances set aside by a migration ${c.setAside}, empty values removed ${c.emptied}`;
