/**
 * Plage de dates d'un sujet (`from` / `to`) et type de champ `datetime` : fonctions pures, sans base de données.
 *
 * Un consommateur peut demander à `ctx.api.topics.collect(sujet, { from, to })` les éléments d'une période (un calendrier, par exemple).
 * Le cœur valide la plage UNE fois, ici, puis la transmet aux fournisseurs sous forme de `Date` ; un fournisseur qui l'ignore continue de marcher
 * (ses éléments restent valides, c'est au consommateur de filtrer s'il en a besoin).
 */

/** Plus longue plage acceptée entre `from` et `to`, en jours. */
export const MAX_WINDOW_DAYS = 400;
/** Instants acceptés : entre 1970 et la fin de 2100 (au-delà, c'est une erreur de saisie, pas une demande). */
const MIN_MS = Date.UTC(1970, 0, 1);
const MAX_MS = Date.UTC(2101, 0, 1);

export type TopicWindow = { from?: Date; to?: Date };
export type TopicWindowInput = { from?: Date | string | null; to?: Date | string | null };

export class TopicWindowError extends Error {
  readonly reason: "invalid" | "order" | "span";
  constructor(reason: "invalid" | "order" | "span", message: string) {
    super(message);
    this.name = "TopicWindowError";
    this.reason = reason;
  }
}

/** ISO 8601 : `2026-10-14`, `2026-10-14T20:30`, `…:45`, `…:45.123`, avec `Z` ou un décalage `+02:00` facultatifs. */
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Millisecondes d'une chaîne ISO 8601 stricte (date réelle : le 31 février est refusé), sinon null. Sans décalage, l'heure est lue en UTC. */
export function isoToMs(value: string): number | null {
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, s = 0] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => (x === undefined ? 0 : Number(x)));
  if (mo! < 1 || mo! > 12 || d! < 1 || h! > 23 || mi! > 59 || s! > 59) return null;
  if (d! > new Date(Date.UTC(y!, mo!, 0)).getUTCDate()) return null;
  const zone = m[7];
  if (zone && zone !== "Z") {
    const hh = Number(zone.slice(1, 3)), mm = Number(zone.slice(-2));
    if (hh > 23 || mm > 59) return null;
  }
  let text = value.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (!zone && m[4] !== undefined) text += "Z";   // sans décalage, JavaScript lirait l'heure locale du serveur : on la lit en UTC
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** Type de champ `datetime` : une chaîne ISO 8601 valide. */
export const isIsoDatetime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && isoToMs(value) !== null;

function instant(name: string, value: Date | string | null | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? isoToMs(value) : NaN;
  if (ms === null || !Number.isFinite(ms) || ms < MIN_MS || ms >= MAX_MS) throw new TopicWindowError("invalid", `topics.collect: "${name}" must be a Date or an ISO 8601 string between 1970 and 2100`);
  return new Date(ms);
}

/** Valide la plage demandée : `from <= to`, au plus MAX_WINDOW_DAYS jours. Lève TopicWindowError. Absent = pas de borne. */
export function parseTopicWindow(input: TopicWindowInput | undefined): TopicWindow {
  const from = instant("from", input?.from);
  const to = instant("to", input?.to);
  if (from && to) {
    if (from.getTime() > to.getTime()) throw new TopicWindowError("order", 'topics.collect: "from" must not be after "to"');
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) throw new TopicWindowError("span", `topics.collect: the window must not exceed ${MAX_WINDOW_DAYS} days`);
  }
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}
