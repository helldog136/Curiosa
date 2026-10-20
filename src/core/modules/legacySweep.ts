import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/core/db";
import { MODULES_DIR } from "@/core/config";
import { withDeadline, TIMED_OUT } from "@/core/deadline";
import { getInstanceById } from "@/core/instances";
import { readVersion } from "@/core/updates/service";
import { getCachedCatalogue } from "./catalogue";
import { dataStatusOf, dataVersionOf, markMigrationTimeout, migrateInstance, targetVersion, type MigrationOutcome } from "./dataMigrations";
import { parseRepoUrl } from "./installer";
import { retireLegacyOff } from "./legacyOff";
import { sweepFromText } from "./choice";
import { isEmptyStored } from "./legacySettings";
import { LEGACY_MARKER, legacyReport, readLegacyMarker, type LegacyReport } from "./legacyReport";
import { forgetModule, getModule, moduleDir, readGitManifest, resetModuleRegistry } from "./registry";

const run = promisify(execFile);

/**
 * BALAYAGE DE CONVERSION AU DÉMARRAGE (0.2.0, contrat 10). Appelé par `register()` (src/instrumentation.ts), que Next attend AVANT de servir la
 * moindre requête : il est donc BORNÉ (20 s en tout, `SWEEP_BUDGET_MS`), sans réseau, et ne lève jamais. Étapes, toutes idempotentes :
 *   1. `retireLegacyOff` : ce qui était « éteint » devient « désinstallé, données gardées » ;
 *   2. lignes de modules `bundled` / `builtin` : converties en modules du catalogue SANS réseau quand la dernière copie reçue du catalogue
 *      les connaît à la MÊME version (dossier d'un dépôt de modules) ; l'empreinte du dossier installé est calculée sur place (git, local) : identique
 *      au catalogue → rien à proposer, différente → la mise à jour suivante remet le code du catalogue. Les autres lignes (version différente, module
 *      absent du catalogue, pas de copie du catalogue) sont laissées telles quelles : la mise à jour du module les convertit (réseau, bundledUpdate.ts) ;
 *   3. migrations de données en attente : une instance à la fois, dans le temps qui reste. Une instance mise à l'écart (échec, plancher, délai)
 *      n'est pas relancée d'office : « Réessayer » reste au propriétaire. Une conversion qui dépasse le temps est laissée finir en arrière-plan,
 *      l'instance étant mise à l'écart (`timeout`) d'ici là ;
 *   4. les valeurs VIDES de réglages hérités (`legacySettings`) et de réglages orphelins sont effacées (rien à reprendre). Une valeur non vide n'est
 *      jamais touchée (contrat : rien n'est supprimé en 0.2.0) ;
 *   5. si plus rien n'est à convertir, le marqueur `core.legacyCleared` est posé (une fois : sa date reste celle de la fin de la conversion).
 *      Sinon il n'est pas posé, le démarrage suivant reprend où celui-ci s'est arrêté, et l'admin l'explique (bandeau + page Entretien).
 * Journal : des nombres et des identifiants de modules, jamais une valeur de réglage.
 * ⚠️ À RETIRER EN PHASE 3 (mise à jour d'entretien, 0.3.0 au plus tard) : l'étape 2 (et legacyOff.ts) disparaît avec le code `bundled` ; le balayage et le marqueur restent (garde bloquante).
 */
export const SWEEP_BUDGET_MS = 20_000;

export type SweepCounts = { retiredModules: number; retiredInstances: number; convertedRows: number; migrated: number; setAside: number; emptied: number };
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

/** Empreinte git (arbre) du contenu d'un dossier, calculée localement : la même que `HEAD:<dossier>` du dépôt si les fichiers sont identiques. Null en cas de doute. */
export async function localTreeHash(dir: string, timeoutMs = 5_000): Promise<string | null> {
  if (!fs.existsSync(dir)) return null;
  fs.mkdirSync(MODULES_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(MODULES_DIR, ".legacy-tree-"));
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };
  const base = ["-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", `--git-dir=${tmp}`, `--work-tree=${dir}`];
  try {
    await run("git", ["init", "-q", "--bare", tmp], { timeout: timeoutMs, env });
    await run("git", [...base, "add", "-A", "-f", "--", "."], { timeout: timeoutMs, env, cwd: dir });
    const { stdout } = await run("git", [...base, "write-tree"], { timeout: timeoutMs, env, cwd: dir });
    const hash = stdout.trim();
    return /^[0-9a-f]{40,64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Étape 2 : lignes `bundled` / `builtin` → modules du catalogue, sans réseau. Ne convertit que ce qui est sûr (même identifiant, même version, entrée
 * compatible du catalogue officiel, module dans un dossier de dépôt, manifeste installé lisible). Rend les identifiants convertis.
 */
export async function convertSourceRowsOffline(deadline: number, now: () => number = Date.now): Promise<string[]> {
  const rows = await prisma.module.findMany({ where: { source: { in: ["bundled", "builtin"] } }, orderBy: { id: "asc" } });
  if (!rows.length) return [];
  const market = getCachedCatalogue();
  const done: string[] = [];
  for (const row of rows) {
    if (now() >= deadline) break;
    const entry = market.find((e) => e.id === row.id);
    if (!entry || entry.origin !== "official" || !entry.compatible || entry.needsNewerCore || !entry.repo || !entry.subdir || entry.version !== row.version) continue;
    const manifest = readGitManifest(row.id);
    if (!manifest || manifest.id !== row.id || manifest.version !== row.version) continue;
    const parsed = parseRepoUrl(`${entry.repo}#${entry.ref ?? ""}:${entry.subdir}`);
    if (!parsed.ok || !parsed.repo.subdir) continue;
    const tree = await localTreeHash(moduleDir(row.id), Math.max(500, Math.min(5_000, deadline - now())));
    // Changement de la ligne seulement si elle n'a pas bougé entre-temps (même source) : jamais deux conversions de la même ligne.
    const changed = await prisma.module.updateMany({
      where: { id: row.id, source: row.source, version: row.version },
      data: { source: "git", repoUrl: parsed.repo.url, ref: parsed.repo.ref ?? null, subdir: parsed.repo.subdir, commit: null, tree },
    });
    if (!changed.count) continue;
    forgetModule(row.id);
    await prisma.auditLog.create({ data: { actor: "system", action: "module.legacy.convert", target: `${row.id} ${row.version} (${row.source} -> catalogue)` } }).catch(() => {});
    done.push(row.id);
  }
  return done;
}

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
  const counts: SweepCounts = { retiredModules: 0, retiredInstances: 0, convertedRows: 0, migrated: 0, setAside: 0, emptied: 0 };
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
    // 1. Éteints → désinstallés, données gardées.
    const off = await retireLegacyOff();
    counts.retiredModules = off.modules.length;
    counts.retiredInstances = off.instances.length;
    // 2. Lignes héritées → catalogue (sans réseau).
    counts.convertedRows = (await convertSourceRowsOffline(deadline, now)).length;
    if (counts.convertedRows) resetModuleRegistry();
    // 3. Migrations en attente, une instance à la fois.
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
    // 4. Valeurs vides.
    if (!timedOut && left() > 0) counts.emptied = await sweepEmptyValues();
    else timedOut = true;
    // 4 bis. Anciennes valeurs texte d'un réglage « choix » : remplacées par l'identifiant quand une seule option porte exactement ce nom (borné, jamais bloquant).
    if (!timedOut && left() > 0) await sweepFromText({ budgetMs: left() }).catch(() => undefined);
    // 5. Marqueur.
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
    } else if (marker && (report.totals.sourceRows || report.totals.switchedOffModules || report.totals.switchedOffInstances)) {
      // Des lignes héritées sont revenues (sauvegarde ancienne restaurée) : la conversion n'est plus terminée.
      await prisma.setting.deleteMany({ where: { key: LEGACY_MARKER } });
      done = false;
    }
    return { done, timedOut, counts, remaining: report.totals };
  })().finally(() => { globalSweep.curiosaLegacySweep = false; });
  try {
    // Délai dur : un peu plus que le budget, pour que l'étape en cours puisse noter son propre dépassement (instance mise à l'écart).
    const result = await withDeadline(() => work, budget + 1_000);
    if (result === TIMED_OUT) {
      log(`[legacy] startup conversion stopped after ${Math.round(budget / 1000)} s; it resumes at the next start (${summary(counts)})`);
      return { done: false, timedOut: true, counts, remaining: null };
    }
    const r = result.remaining;
    log(`[legacy] startup conversion ${result.done ? "complete" : "not complete"}: ${summary(counts)}${r && !result.done ? `; remaining: old module rows ${r.sourceRows}, switched off ${r.switchedOffModules + r.switchedOffInstances}, instances behind ${r.behind}, set aside ${r.failed}` : ""}`);
    return result;
  } catch (error) {
    log(`[legacy] startup conversion failed (${(error as Error)?.name ?? "error"}); it resumes at the next start`);
    return { done: false, timedOut, counts, remaining: null };
  }
}

const summary = (c: SweepCounts) =>
  `modules set aside ${c.retiredModules}, instances set aside ${c.retiredInstances}, module rows converted ${c.convertedRows}, instances migrated ${c.migrated}, instances set aside by a migration ${c.setAside}, empty values removed ${c.emptied}`;
