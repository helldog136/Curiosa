import { dayKey, lastDays, nextDay, timeKey, zonedToUtc } from "./siteTime";

/**
 * DATE DE FIN d'un lien court, comprise dans le fuseau du site (heure d'été gérée par le fuseau).
 * Une date seule (« 31 mars ») veut dire « jusqu'à la fin de ce jour » : le lien s'arrête à minuit, au début du 1er avril, heure du site.
 * Avec une heure (mode avancé), il s'arrête à cette minute précise.
 */
export type EndFields = { date: string; time: string };

/** L'instant de fin pour une date (AAAA-MM-JJ) et une heure facultative (HH:MM). Date vide = pas de fin (null) ; date ou heure invalide = `undefined`. */
export function endInstant(date: string, time: string, tz: string): Date | null | undefined {
  const d = date.trim(), t = time.trim();
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (t && !/^\d{2}:\d{2}$/.test(t))) return undefined;
  const year = Number(d.slice(0, 4));
  if (year < 2000 || year > 2100 || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return undefined; // 30 février…
  return zonedToUtc(t ? d : nextDay(d), t || "00:00", tz) ?? undefined;
}

/** Les valeurs à remettre dans les champs « date » et « heure » pour un instant de fin enregistré (heure vide quand la fin est à minuit : « jusqu'à la fin du jour »). */
export function endFields(expiresAt: Date | null | undefined, tz: string): EndFields {
  if (!expiresAt) return { date: "", time: "" };
  const time = timeKey(expiresAt, tz);
  if (time === "00:00") return { date: lastDays(dayKey(expiresAt, tz), 2)[0]!, time: "" };
  return { date: dayKey(expiresAt, tz), time };
}

/** La fin, en clair, dans la langue donnée : « 31 mars 2026 » (jusqu'à la fin de ce jour) ou « 31 mars 2026 à 18:30 » (fin à une heure précise). */
export function formatEnd(expiresAt: Date, tz: string, locale: string): string {
  const f = endFields(expiresAt, tz);
  if (!f.time) return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${f.date}T12:00:00Z`));
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: tz }).format(expiresAt);
}
