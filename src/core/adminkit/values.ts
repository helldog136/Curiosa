/**
 * Valeurs des contrôles « une notion = un champ » (pur, testé sans navigateur) : période, date et heure, durée, nombre borné.
 * Format ENREGISTRÉ (et reçu par un module) :
 *   period    "11-01/11-30" (chaque année : mois-jour/mois-jour, la fin peut passer au-delà du 31 décembre) ou "2026-11-01/2026-11-30" (une seule fois)
 *   datetime  "2026-11-30T18:30" (date et heure du site, sans fuseau)
 *   duration  un nombre entier de SECONDES ("90")
 *   number    un nombre
 * Un champ vide n'enregistre rien (le module garde sa valeur par défaut).
 */

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Nombre de jours de chaque mois, février compris (29 : « chaque année » accepte le 29 février). */
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (m: number, y?: number): number => (m === 2 && y !== undefined ? new Date(Date.UTC(y, 2, 0)).getUTCDate() : DAYS[m - 1] ?? 0);
const validDay = (m: number, d: number, y?: number): boolean => Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(m, y);

/* ───────────── période ───────────── */

export type DayRef = { m: number; d: number; y?: number };
export type Period = { yearly: true; from: DayRef; to: DayRef } | { yearly: false; from: Required<DayRef>; to: Required<DayRef> };
export type PeriodReason = "format" | "date" | "order";

const YEARLY_RE = /^(\d{2})-(\d{2})\/(\d{2})-(\d{2})$/;
const ONCE_RE = /^(\d{4})-(\d{2})-(\d{2})\/(\d{4})-(\d{2})-(\d{2})$/;

export function parsePeriod(raw: string): { ok: true; period: Period } | { ok: false; reason: PeriodReason } {
  const text = raw.trim();
  const y = YEARLY_RE.exec(text);
  if (y) {
    const [fm, fd, tm, td] = y.slice(1).map(Number) as [number, number, number, number];
    return validDay(fm, fd) && validDay(tm, td) ? { ok: true, period: { yearly: true, from: { m: fm, d: fd }, to: { m: tm, d: td } } } : { ok: false, reason: "date" };
  }
  const o = ONCE_RE.exec(text);
  if (o) {
    const [fy, fm, fd, ty, tm, td] = o.slice(1).map(Number) as [number, number, number, number, number, number];
    if (fy < 2000 || fy > 2100 || ty < 2000 || ty > 2100 || !validDay(fm, fd, fy) || !validDay(tm, td, ty)) return { ok: false, reason: "date" };
    if (fy * 10000 + fm * 100 + fd > ty * 10000 + tm * 100 + td) return { ok: false, reason: "order" };
    return { ok: true, period: { yearly: false, from: { y: fy, m: fm, d: fd }, to: { y: ty, m: tm, d: td } } };
  }
  return { ok: false, reason: "format" };
}

export function serializePeriod(p: Period): string {
  const one = (x: DayRef) => (p.yearly ? `${pad(x.m)}-${pad(x.d)}` : `${String(x.y).padStart(4, "0")}-${pad(x.m)}-${pad(x.d)}`);
  return `${one(p.from)}/${one(p.to)}`;
}

/** La date en toutes lettres : « 1er novembre » (fr), « 1 November » (en), avec l'année pour une période unique. */
export function dateWords(x: DayRef, locale: string, withYear = false): string {
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2001, x.m - 1, 15)));
  const day = locale.toLowerCase().startsWith("fr") && x.d === 1 ? "1er" : String(x.d);
  return `${day} ${month}${withYear && x.y !== undefined ? ` ${x.y}` : ""}`;
}

/** La phrase d'aperçu : « Du 1er novembre au 30 novembre, chaque année ». `templates` : textes déjà traduits avec {from} et {to}. */
export function describePeriod(p: Period, locale: string, templates: { yearly: string; once: string }): string {
  const fill = (tpl: string, from: string, to: string) => tpl.replace("{from}", from).replace("{to}", to);
  return p.yearly
    ? fill(templates.yearly, dateWords(p.from, locale), dateWords(p.to, locale))
    : fill(templates.once, dateWords(p.from, locale, true), dateWords(p.to, locale, true));
}

/** Le jour `now` (année, mois, jour dans l'heure du site) tombe-t-il dans la période ? Une période « chaque année » peut enjamber le 31 décembre. */
export function periodContains(p: Period, now: { y: number; m: number; d: number }): boolean {
  const key = (m: number, d: number) => m * 100 + d;
  if (!p.yearly) {
    const k = now.y * 10000 + now.m * 100 + now.d;
    return k >= p.from.y * 10000 + p.from.m * 100 + p.from.d && k <= p.to.y * 10000 + p.to.m * 100 + p.to.d;
  }
  const a = key(p.from.m, p.from.d), b = key(p.to.m, p.to.d), k = key(now.m, now.d);
  return a <= b ? k >= a && k <= b : k >= a || k <= b;
}

/* ───────────── date et heure ───────────── */

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** « 2026-11-30T18:30 » : une date réelle (année 2000 à 2100) et une heure réelle. */
export function checkDateTime(raw: string): boolean {
  const m = DATETIME_RE.exec(raw.trim());
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return y >= 2000 && y <= 2100 && validDay(mo, d, y) && h <= 23 && mi <= 59;
}

/** La date et l'heure en toutes lettres, dans la langue donnée : « 30 novembre 2026 à 18:30 ». */
export function describeDateTime(raw: string, locale: string, at: string): string {
  const m = DATETIME_RE.exec(raw.trim());
  if (!m) return raw;
  const [y, mo, d] = m.slice(1, 4).map(Number) as [number, number, number];
  return `${dateWords({ m: mo, d, y }, locale, true)} ${at} ${m[4]}:${m[5]}`;
}

/** Une date seule « 2026-11-30 » en toutes lettres (« 30 novembre 2026 »). */
export function describeDate(raw: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  return m ? dateWords({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, locale, true) : raw;
}

/* ───────────── durée ───────────── */

export const DURATION_UNITS = [
  { id: "s", seconds: 1 },
  { id: "min", seconds: 60 },
  { id: "h", seconds: 3600 },
  { id: "d", seconds: 86400 },
] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number]["id"];

/** Les unités proposées pour des bornes données (en secondes) : celles qui tiennent sous le maximum, au moins les secondes. */
export function durationUnits(max?: number): DurationUnit[] {
  return DURATION_UNITS.filter((u) => u.seconds === 1 || max === undefined || u.seconds <= max).map((u) => u.id);
}

/** Un nombre de secondes → la plus grande unité qui le divise exactement : 5400 → { n: 90, unit: "min" }. */
export function splitDuration(seconds: number, units: readonly DurationUnit[] = ["s", "min", "h", "d"]): { n: number; unit: DurationUnit } {
  const ok = DURATION_UNITS.filter((u) => units.includes(u.id));
  for (const u of [...ok].reverse()) if (seconds !== 0 && seconds % u.seconds === 0) return { n: seconds / u.seconds, unit: u.id };
  return { n: seconds, unit: "s" };
}

export const joinDuration = (n: number, unit: DurationUnit): number => n * (DURATION_UNITS.find((u) => u.id === unit)?.seconds ?? 1);

export type Bounds = { min?: number; max?: number; step?: number };

/** Une durée saisie en secondes (texte) : entier, dans les bornes. */
export function checkDuration(raw: string, bounds: Bounds = {}): { ok: true; value: number } | { ok: false; reason: "duration" | "range" } {
  if (!/^\d{1,9}$/.test(raw.trim())) return { ok: false, reason: "duration" };
  const n = Number(raw);
  if ((bounds.min !== undefined && n < bounds.min) || (bounds.max !== undefined && n > bounds.max)) return { ok: false, reason: "range" };
  return { ok: true, value: n };
}

/** La durée en clair : 5400 → « 1 h 30 », 45 → « 45 s » (symboles universels : s, min, h, j/d). */
export function describeDuration(seconds: number, dayUnit = "d"): string {
  if (seconds === 0) return "0 s";
  const parts: string[] = [];
  let rest = Math.floor(seconds);
  for (const [size, label] of [[86400, dayUnit], [3600, "h"], [60, "min"], [1, "s"]] as const) {
    const n = Math.floor(rest / size);
    if (n > 0) { parts.push(`${n} ${label}`); rest -= n * size; }
  }
  return parts.join(" ");
}

/* ───────────── nombre borné ───────────── */

/** Un nombre saisi (texte non vide) : fini, dans les bornes, sur le pas s'il y en a un (en partant du minimum, ou de 0). */
export function checkBoundedNumber(raw: string, bounds: Bounds = {}): { ok: true; value: number } | { ok: false; reason: "number" | "range" } {
  const text = raw.trim().replace(",", ".");
  const n = Number(text);
  if (text === "" || !Number.isFinite(n) || Math.abs(n) > 1e12) return { ok: false, reason: "number" };
  if ((bounds.min !== undefined && n < bounds.min) || (bounds.max !== undefined && n > bounds.max)) return { ok: false, reason: "range" };
  if (bounds.step !== undefined && bounds.step > 0) {
    const steps = (n - (bounds.min ?? 0)) / bounds.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return { ok: false, reason: "range" };
  }
  return { ok: true, value: n };
}

/** Un exemple de valeur pour un message d'erreur : le défaut s'il est dans les bornes, sinon la borne la plus proche d'une valeur courante. */
export function exampleNumber(bounds: Bounds & { default?: number }): number {
  const { min, max, default: d } = bounds;
  if (typeof d === "number" && (min === undefined || d >= min) && (max === undefined || d <= max)) return d;
  if (min !== undefined && max !== undefined) return Math.round((min + max) / 2 / (bounds.step ?? 1)) * (bounds.step ?? 1) || min;
  return min ?? max ?? 10;
}
