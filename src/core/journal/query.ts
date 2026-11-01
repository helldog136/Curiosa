import { AUDIT_PERIODS, CORE_ONLY, type AuditFilter } from "@/core/audit";
import { isActorKind, isLevel } from "./events";

/**
 * Les filtres d'une page de journal, lus dans l'adresse. Pur. `prefix` distingue deux journaux sur une même adresse
 * (l'onglet « Historique » d'un module met « h » devant : `hq`, `hlevel`…, pour ne jamais heurter les paramètres du module).
 * Une valeur inconnue est ignorée (jamais d'erreur, jamais de filtre fantôme).
 */
export type JournalParams = { q: string; module: string; level: string; kind: string; period: string; page: number };
export const JOURNAL_PARAM_KEYS = ["q", "module", "level", "kind", "period", "page"] as const;
export const JOURNAL_PAGE_SIZE = 25;

const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

export function parseJournalParams(sp: Record<string, string | string[] | undefined>, prefix = "", modules: readonly string[] | null = null): JournalParams {
  const get = (k: string) => one(sp[`${prefix}${k}`]);
  const module = get("module");
  const page = Number(get("page"));
  return {
    q: get("q").trim().slice(0, 100),
    module: module === CORE_ONLY || (modules ? modules.includes(module) : /^[a-z][a-z0-9-]{1,39}$/.test(module)) ? module : "",
    level: isLevel(get("level")) ? get("level") : "",
    kind: isActorKind(get("kind")) ? get("kind") : "",
    period: Object.hasOwn(AUDIT_PERIODS, get("period")) ? get("period") : "",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export const toFilter = (p: JournalParams, fixed: Pick<AuditFilter, "module"> = {}): AuditFilter => ({ q: p.q, module: fixed.module ?? p.module, level: p.level, kind: p.kind, period: p.period, page: p.page });

/** L'adresse de la même page avec d'autres valeurs : les paramètres qui ne sont pas ceux du journal (`tab`, le panneau d'un module…) sont gardés tels quels. */
export function journalHref(path: string, sp: Record<string, string | string[] | undefined>, prefix: string, change: Partial<Record<(typeof JOURNAL_PARAM_KEYS)[number], string | number>>): string {
  const params = new URLSearchParams();
  const mine = (k: string) => k.startsWith(prefix) && (JOURNAL_PARAM_KEYS as readonly string[]).includes(k.slice(prefix.length));
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && !mine(k)) params.set(k, v);
  const current = parseJournalParams(sp, prefix);
  const next = { ...current, ...change } as Record<string, string | number>;
  for (const key of JOURNAL_PARAM_KEYS) {
    const value = next[key];
    if (value !== undefined && value !== "" && !(key === "page" && Number(value) <= 1)) params.set(`${prefix}${key}`, String(value));
  }
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}
