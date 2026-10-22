import { getSetting } from "./settings";

/**
 * HEURE DU SITE : le fuseau horaire dans lequel les dates saisies dans l'administration (date de fin d'un lien court…) sont comprises, et dans lequel
 * « aujourd'hui » change. Brique de base : rien ici ne connaît les redirections. L'heure d'été est gérée par le fuseau (nom IANA, « Europe/Brussels »),
 * jamais par un décalage fixe.
 */
export const TIMEZONE_SETTING = "site.timezone";

/** Le nom est-il un fuseau horaire connu de la plateforme (« Europe/Brussels », « UTC »…) ? */
export function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

/** Le fuseau du serveur (celui de la machine), « UTC » si la plateforme ne le dit pas. */
export function systemTimezone(): string {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return isTimezone(tz) ? tz : "UTC"; } catch { return "UTC"; }
}

/** Fuseau du site : le réglage `site.timezone` s'il est valide, sinon celui du serveur. */
export async function siteTimezone(): Promise<string> {
  const saved = await getSetting<string>(TIMEZONE_SETTING).catch(() => undefined);
  return isTimezone(saved) ? saved : systemTimezone();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (formatters.size > 20) formatters.clear();
    formatters.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year!, mo: o.month!, d: o.day!, h: o.hour! % 24, mi: o.minute!, s: o.second! };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Jour « AAAA-MM-JJ » d'un instant dans ce fuseau. */
export function dayKey(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${String(p.y).padStart(4, "0")}-${p2(p.mo)}-${p2(p.d)}`;
}

/** Heure « HH:MM » d'un instant dans ce fuseau. */
export function timeKey(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p2(p.h)}:${p2(p.mi)}`;
}

/** Décalage (ms) du fuseau par rapport à UTC à cet instant. */
function offsetAt(ms: number, tz: string): number {
  const p = parts(new Date(ms), tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * L'instant (UTC) où il est « AAAA-MM-JJ » à « HH:MM » sur les horloges de ce fuseau.
 * Cas de l'heure d'été : une heure qui n'existe pas (le printemps saute de 02:00 à 03:00) donne le premier instant valide qui suit ;
 * une heure qui existe deux fois (l'automne) donne la première (la plus tôt). Entrée invalide : null.
 */
export function zonedToUtc(day: string, time: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day), t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(wall).getUTCDate() !== d) return null; // 31 février…
  // Les décalages possibles autour de cette heure (la veille et le lendemain couvrent tout changement d'heure).
  const candidates = new Set<number>();
  for (const probe of [wall - 36 * 3600_000, wall + 36 * 3600_000]) {
    try { candidates.add(offsetAt(probe, tz)); } catch { return null; }
  }
  const valid = [...candidates].map((off) => wall - off).filter((utc) => {
    const p = parts(new Date(utc), tz);
    return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
  }).sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]!);
  // Heure inexistante (saut de printemps) : on applique le décalage d'AVANT le saut, ce qui avance l'horloge de la durée du saut (02:30 devient 03:30).
  return new Date(wall - Math.min(...candidates));
}

/** Le jour d'après (AAAA-MM-JJ), par le calendrier (aucun fuseau en jeu). */
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Les `n` derniers jours (le plus ancien d'abord), dont `today` (AAAA-MM-JJ). */
export function lastDays(today: string, n: number): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}
