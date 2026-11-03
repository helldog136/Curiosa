/**
 * Le résumé d'un groupe « Plus d'options » replié (pur) : « Fin le 30 novembre 2026 · Message personnalisé ». Il dit ce qui est DÉJÀ réglé là-dedans, pour qu'on
 * n'ait pas à ouvrir le groupe pour le savoir ; un réglage qui garde sa valeur par défaut n'y figure pas.
 */
import { describeDate, describeDateTime, describeDuration, parsePeriod, describePeriod } from "./values";

export type RareField = { key: string; label: string; type: string; openEnded?: boolean; default?: unknown; options?: { value: string; label: string }[]; unit?: string };
type T = (key: string, vars?: Record<string, string | number>) => string;

/** Le réglage a-t-il une valeur propre (différente de son défaut) ? */
export function hasOwnValue(f: Pick<RareField, "type" | "default">, stored: unknown): boolean {
  if (stored === undefined || stored === null || stored === "") return false;
  if (f.type === "boolean") return stored !== (f.default === true);
  return String(stored) !== String(f.default ?? "");
}

/** Une phrase courte pour un réglage qui a une valeur propre : son libellé, suivi de la valeur quand elle apporte quelque chose. */
export function summarizeField(f: RareField, stored: unknown, locale: string, t: T): string {
  switch (f.type) {
    case "boolean": return stored === true ? f.label : t("field.summary.off", { label: f.label });
    case "select": return f.options?.find((o) => o.value === stored)?.label ?? f.label;
    case "period": { const p = parsePeriod(String(stored), { openEnded: f.openEnded === true }); return p.ok ? describePeriod(p.period, locale, { yearly: t("period.sentenceYearly"), once: t("period.sentenceOnce"), since: t("period.sentenceSince"), until: t("period.sentenceUntil") }) : f.label; }
    case "datetime": return `${f.label} : ${describeDateTime(String(stored), locale, t("datetime.at"))}`;
    case "duration": return `${f.label} : ${describeDuration(Number(stored), t("unit.day"))}`;
    case "number": return `${f.label} : ${stored}${f.unit ? ` ${f.unit}` : ""}`;
    case "color": case "secret": case "image": case "video": return f.label;
    default: {
      const text = String(stored).replace(/\s+/g, " ").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${f.label} : ${describeDate(text, locale)}` : `${f.label} : ${text.length > 24 ? `${text.slice(0, 23)}…` : text}`;
    }
  }
}

/** Le résumé de tout un groupe : `parts` (réglages ayant une valeur propre), `summary` (en une ligne) et `count`. */
export function summarizeGroup(fields: RareField[], stored: (key: string) => unknown, locale: string, t: T): { summary: string; count: number } {
  const parts = fields.filter((f) => hasOwnValue(f, stored(f.key))).map((f) => summarizeField(f, stored(f.key), locale, t));
  return { summary: parts.join(" · "), count: parts.length };
}
