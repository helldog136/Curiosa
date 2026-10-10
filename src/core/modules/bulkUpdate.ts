// Mise à jour des modules « en bloc », rattachée à la page Mises à jour : repérer ceux qui sont en retard, les mettre à jour un par un,
// faire le bilan. Aucune dépendance à la base ni au réseau ici : la vérification et la mise à jour réelles sont INJECTÉES (voir updateStatus.ts),
// ce qui permet de tout tester sans réseau.

export type UpdateLevel = "patch" | "minor" | "major";
export type CheckOutcome = { check: { available: boolean; target?: string; level?: UpdateLevel; /** Cœur minimal demandé par la version proposée, si CE cœur est trop ancien. */ needsCore?: string }; failed: boolean };
export type SourcedModule = { id: string; version: string };
export type OutdatedModule = { id: string; current: string; target: string; level?: UpdateLevel; /** La mise à jour demande ce cœur (ou plus) : elle sera sautée tant que le site n'est pas mis à jour. */ needsCore?: string };
export type ModulesReport = {
  checkedAt: number;
  /** Modules vérifiés (avec une source). */
  checked: number;
  outdated: OutdatedModule[];
  /** Modules dont la vérification a échoué (réseau, source absente) : on le dit discrètement, sans bloquer le reste. */
  unchecked: string[];
};

export type UpdateResult = { ok: true; migrations?: { status: string }[] } | { ok: false; error: string; needsCore?: string };
/** Erreur renvoyée par le cœur quand un module demande un cœur plus récent (voir compat.ts) : ce n'est pas un échec, la mise à jour est SAUTÉE. */
export const CORE_TOO_OLD = "modules.error.core";
export type Failure = { id: string; /** Clé de traduction de la raison. */ error: string; migration: boolean };
export type Summary = {
  updated: string[];
  failed: Failure[];
  /** Non tentés parce que la mise à jour s'est arrêtée avant eux. */
  skipped: string[];
  /** Module sur lequel on s'est arrêté (erreur de migration de données). */
  stoppedOn: string | null;
  /** Sautés sans erreur : le module demande un cœur plus récent (`core` = version demandée) ; absent s'il n'y en a aucun. À dire dans le bilan : « mettez d'abord le site à jour ». */
  incompatible?: { id: string; core: string }[];
};

const clean = (v: string) => v.replace(/^v(?=\d)/, "");
export const displayVersion = clean;

/** Vérifie chaque module (lecture seule, quelques-uns à la fois) ; une vérification qui lève une erreur compte comme un échec, jamais comme une exception. */
export async function collectReport(modules: SourcedModule[], check: (id: string) => Promise<CheckOutcome>, now: () => number = Date.now, concurrency = 3): Promise<ModulesReport> {
  const results: (CheckOutcome | null)[] = new Array(modules.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < modules.length) {
      const i = next++;
      results[i] = await check(modules[i]!.id).catch((): CheckOutcome => ({ check: { available: false }, failed: true }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, modules.length) }, worker));
  const report: ModulesReport = { checkedAt: now(), checked: modules.length, outdated: [], unchecked: [] };
  modules.forEach((m, i) => {
    const r = results[i]!;
    if (r.failed) report.unchecked.push(m.id);
    else if (r.check.available) report.outdated.push({ id: m.id, current: clean(m.version), target: clean(r.check.target ?? "?"), level: r.check.level, ...(r.check.needsCore ? { needsCore: r.check.needsCore } : {}) });
  });
  return report;
}

/** Une migration de données qui a échoué (ou qui vient d'une version plus récente) : la mise à jour du module est faite, mais ses données ne suivent pas. */
export const hasMigrationProblem = (r: { migrations?: { status: string }[] }) => !!r.migrations?.some((m) => m.status === "failed" || m.status === "newer");

/**
 * Met à jour les modules UN PAR UN (jamais deux à la fois : chacun touche aux fichiers, à la base et aux données). Une erreur ordinaire d'un module
 * n'arrête pas les autres ; une erreur de MIGRATION s'arrête net (les modules suivants ne sont pas touchés) et nomme le module en cause.
 */
export async function updateSequentially(ids: string[], update: (id: string) => Promise<UpdateResult>): Promise<Summary> {
  const summary: Summary = { updated: [], failed: [], skipped: [], stoppedOn: null };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    let result: UpdateResult;
    try { result = await update(id); } catch { result = { ok: false, error: "error.generic" }; }
    if (!result.ok && result.error === CORE_TOO_OLD) { (summary.incompatible ??= []).push({ id, core: result.needsCore ?? "" }); continue; }
    if (!result.ok) { summary.failed.push({ id, error: result.error, migration: false }); continue; }
    if (hasMigrationProblem(result)) {
      summary.failed.push({ id, error: "modules.error.migration", migration: true });
      summary.stoppedOn = id;
      summary.skipped = ids.slice(i + 1);
      break;
    }
    summary.updated.push(id);
  }
  return summary;
}

/** Résultat de vérification mis en cache quelques minutes : la page s'ouvre vite, et la pastille du menu ne fait pas de réseau à chaque page. */
export function createReportCache(load: () => Promise<ModulesReport>, ttlMs = 5 * 60_000, now: () => number = Date.now) {
  let cached: ModulesReport | null = null;
  let inflight: Promise<ModulesReport> | null = null;
  const fresh = () => !!cached && now() - cached.checkedAt < ttlMs;
  const refresh = () => (inflight ??= load().then((r) => (cached = r)).finally(() => { inflight = null; }));
  return {
    /** Rapport récent, sinon une nouvelle vérification (`force` : toujours). */
    async get(force = false): Promise<ModulesReport> { return !force && fresh() ? cached! : refresh(); },
    /** Sans réseau : ce qu'on sait déjà (éventuellement un peu ancien), et relance une vérification en arrière-plan si besoin. */
    peek(): ModulesReport | null {
      if (!fresh() && !inflight) refresh().catch(() => {});
      return cached;
    },
    /** Retire des modules du rapport (ils viennent d'être mis à jour) sans refaire de réseau. */
    markUpdated(ids: string[]) { if (cached) cached = { ...cached, outdated: cached.outdated.filter((o) => !ids.includes(o.id)) }; },
    clear() { cached = null; },
  };
}
