import { legacyReport, type LegacyReport } from "./legacyReport";

/**
 * ENTRETIEN, vu par la personne (0.6.4) : le rapport d'héritage (legacyReport.ts) compte ce qui reste d'une ancienne installation ; ce fichier dit, pour
 * chaque ligne, ce qu'elle DEMANDE à la personne. Trois états, jamais plus :
 *   - « todo »  (À faire) : une action est possible ET utile pour la personne (mettre des extensions à jour, relancer la mise à niveau, choisir pour une extension
 *                que le catalogue ne propose plus). C'est la seule chose que compte la pastille du menu.
 *   - « kept »  (Gardé par prudence) : le site garde quelque chose, sans rien demander (copie de sécurité d'anciennes données, réglage masqué sans effet, reprise qui
 *                se fera à la prochaine mise à jour de l'extension). Jamais « à faire » : rien à cliquer, rien d'urgent.
 *   - « done »  (Terminé) : la ligne est à zéro.
 * Les COPIES DE SÉCURITÉ ne sont jamais « à faire » : le contrat `legacyCollections` (docs/MODULES.md) ne dit pas si l'extension videra la collection ou la gardera
 * (Partenariats garde une copie inerte et l'état de sa reprise) ; dans les deux cas la personne n'a rien à décider, et le cœur ne supprime jamais ces données.
 * Logique pure sur le rapport (testée) ; seule `legacyUpkeepSummary` lit la base, avec une mémoire de 15 secondes pour le menu de toutes les pages.
 */
export type UpkeepGroup = "todo" | "kept" | "done";
/** Les lignes connues : une par rubrique du rapport, plus « finish » (le marqueur de fin n'est pas posé) et une ligne par extension que le catalogue ne propose plus. */
export type UpkeepId = "finish" | "sourceRows" | "absent" | "switchedOff" | "behind" | "failed" | "newer" | "seedsMissing" | "collections" | "legacyValues" | "orphans" | "keptRows";
export type UpkeepRow = {
  id: UpkeepId;
  group: UpkeepGroup;
  /** Combien d'éléments (extensions, copies…) la ligne concerne ; 0 pour « terminé ». */
  n: number;
  /** Quelques noms (l'ordre du rapport) ; jamais une valeur de réglage. */
  names: string[];
  /** Pour « absent » : l'extension concernée (une ligne par extension). */
  moduleId?: string;
};
export type UpkeepState = "todo" | "kept" | "clean";
export type UpkeepSummary = {
  /** « todo » dès qu'il y a une ligne à faire ; « kept » s'il n'y a que des choses gardées par prudence ; « clean » sinon. */
  state: UpkeepState;
  /** Nombre de lignes à faire (le nombre de la pastille du menu). */
  todo: number;
  /** Nombre de lignes gardées par prudence. */
  kept: number;
};

/** Où classer chaque rubrique du rapport quand elle n'est pas à zéro. Une seule table : le menu, la page et l'outil MCP disent la même chose. */
export const UPKEEP_GROUP: Record<"sourceRows" | "switchedOff" | "behind" | "failed" | "newer" | "seedsMissing" | "collections" | "legacyValues" | "orphans", "todo" | "kept"> = {
  sourceRows: "todo",     // des extensions à faire passer au catalogue : « Voir les mises à jour »
  switchedOff: "todo",    // éléments éteints à ranger : « Relancer »
  behind: "todo",         // données en retard : « Relancer »
  failed: "todo",         // mises de côté : à rouvrir et réessayer
  newer: "todo",          // plus récentes que leur extension : mettre l'extension à jour
  seedsMissing: "kept",   // l'extension confie le réglage à une autre à sa prochaine mise à jour : rien à faire
  collections: "kept",    // copie de sécurité d'anciennes données, dans les sauvegardes : rien à faire
  legacyValues: "kept",   // réglage masqué que l'extension efface elle-même : rien à faire
  orphans: "kept",        // réglage que plus personne ne lit : rien à faire
};

/** L'ordre d'affichage des lignes de chaque groupe. */
export const UPKEEP_ORDER: readonly UpkeepId[] = ["finish", "absent", "sourceRows", "switchedOff", "behind", "failed", "newer", "keptRows", "collections", "seedsMissing", "legacyValues", "orphans"];

/** Les lignes de la page : à faire, gardées, ou à zéro (« terminé »). Logique pure. */
export function upkeepRows(r: LegacyReport): UpkeepRow[] {
  const rows: UpkeepRow[] = [];
  const absent = r.sourceRows.filter((m) => m.state === "absent");
  const convertible = r.sourceRows.filter((m) => m.state !== "absent");
  const names: Record<string, string[]> = {
    sourceRows: convertible.map((m) => m.id),
    switchedOff: [...r.switchedOff.modules, ...r.switchedOff.instances],
    behind: r.behind.map((i) => i.key),
    failed: r.failed.map((i) => i.key),
    newer: r.newer.map((i) => i.key),
    seedsMissing: r.seedsMissing.map((i) => i.key),
    collections: [...new Set(r.collections.map((c) => c.key))],
    legacyValues: r.legacyValues.map((i) => i.key),
    orphans: r.orphans.map((i) => i.key),
  };
  const counts: Record<string, number> = {
    sourceRows: convertible.length,
    switchedOff: r.totals.switchedOffModules + r.totals.switchedOffInstances,
    behind: r.totals.behind, failed: r.totals.failed, newer: r.totals.newer, seedsMissing: r.totals.seedsMissing,
    collections: r.totals.collections, legacyValues: r.totals.legacyValues, orphans: r.totals.orphans,
  };
  // Le marqueur de fin n'est pas posé : la mise à niveau doit être refaite (c'est ce que dit le bandeau). Rien d'autre à faire que « Relancer ».
  rows.push({ id: "finish", group: r.marker ? "done" : "todo", n: r.marker ? 0 : 1, names: [] });
  for (const m of absent) rows.push({ id: "absent", group: "todo", n: 1, names: [m.id], moduleId: m.id });
  if (!absent.length) rows.push({ id: "absent", group: "done", n: 0, names: [] });
  for (const id of Object.keys(UPKEEP_GROUP) as (keyof typeof UPKEEP_GROUP)[]) {
    const n = counts[id] ?? 0;
    rows.push({ id, group: n > 0 ? UPKEEP_GROUP[id] : "done", n, names: names[id] ?? [] });
  }
  // Les extensions que la personne a choisi de garder telles quelles : gardées par choix, rien à faire (elle peut revenir dessus).
  rows.push({ id: "keptRows", group: r.keptRows.length ? "kept" : "done", n: r.keptRows.length, names: r.keptRows.map((m) => m.id) });
  const rank = (row: UpkeepRow) => UPKEEP_ORDER.indexOf(row.id);
  return rows.sort((a, b) => rank(a) - rank(b));
}

/** Le résumé du menu : combien à faire, combien gardé, et l'état qui en découle. Logique pure. */
export function upkeepSummary(rows: readonly UpkeepRow[]): UpkeepSummary {
  const todo = rows.filter((r) => r.group === "todo").length;
  const kept = rows.filter((r) => r.group === "kept").length;
  return { state: todo > 0 ? "todo" : kept > 0 ? "kept" : "clean", todo, kept };
}

const TTL_MS = 15_000;
let memo: { at: number; value: UpkeepSummary } | null = null;
/** À appeler quand quelque chose vient de changer (balayage, choix de la personne) pour que le menu le montre tout de suite. */
export function forgetUpkeepSummary(): void { memo = null; }

/**
 * Le résumé pour le menu d'administration (une fois par page, réservé aux personnes qui peuvent ouvrir Entretien). Ne lève jamais : en cas de doute,
 * `null` (aucune pastille), plutôt qu'un faux « À jour » ou une fausse alerte. Lecture seule, sans réseau.
 */
export async function legacyUpkeepSummary(): Promise<UpkeepSummary | null> {
  const now = Date.now();
  if (memo && now - memo.at < TTL_MS) return memo.value;
  try {
    const value = upkeepSummary(upkeepRows(await legacyReport()));
    memo = { at: now, value };
    return value;
  } catch { return null; }
}
