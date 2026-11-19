/**
 * « il y a 3 min » / « 3 min ago »: a short, locale-aware age for status lines (the exact date goes in the `title`). Pure; `now` is injectable for tests.
 * Under 45 seconds it says « maintenant » / « now ».
 */
export function relativeAge(at: number | null | undefined, locale: string, now: number = Date.now()): string {
  if (!at) return "—";
  // Intl puts a narrow no-break space before the unit: a plain space keeps the line breakable on a phone.
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const fmt = (n: number, unit: Intl.RelativeTimeFormatUnit) => rtf.format(n, unit).replace(/[\u00a0\u202f]/g, " ");
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return fmt(0, "second");
  if (s < 3600) return fmt(-Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86400) return fmt(-Math.round(s / 3600), "hour");
  return fmt(-Math.round(s / 86400), "day");
}
