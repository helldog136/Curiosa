/** Textes d'aide des champs « nombre borné » et « durée » (pur) : l'indication « Entre 5 et 3600 secondes · Vide : 30 s » et le message d'erreur avec exemple. */
import { describeDuration, exampleNumber } from "./values";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Bounded = { type: string; min?: number; max?: number; step?: number; default?: unknown; openEnded?: boolean };

/** Un nombre de secondes pour un message : « 1 h 30 ». */
const secondsText = (t: T, n: number) => describeDuration(n, t("unit.day"));
const show = (t: T, f: Bounded, n: number) => (f.type === "duration" ? secondsText(t, n) : String(n));

/** « Entre 5 et 3600 secondes · Vide : 30 s » : ce que le champ accepte et ce qui se passe quand il reste vide. `unit` : l'unité d'un nombre (« secondes »). */
export function numberHint(t: T, f: Bounded, unit = ""): string {
  const u = unit ? ` ${unit}` : "";
  const parts: string[] = [];
  if (f.min !== undefined && f.max !== undefined) parts.push(t("field.hint.range", { min: show(t, f, f.min), max: show(t, f, f.max), unit: f.type === "duration" ? "" : u }));
  else if (f.min !== undefined) parts.push(t("field.hint.min", { min: show(t, f, f.min), unit: f.type === "duration" ? "" : u }));
  else if (f.max !== undefined) parts.push(t("field.hint.max", { max: show(t, f, f.max), unit: f.type === "duration" ? "" : u }));
  if (f.step !== undefined && f.step !== 1) parts.push(t("field.hint.step", { step: f.step }));
  if (typeof f.default === "number") parts.push(t("field.hint.empty", { value: f.type === "duration" ? secondsText(t, f.default) : `${f.default}${u}` }));
  return parts.join(" · ");
}

/** Le message d'erreur d'un réglage de type nombre, durée, période ou date et heure : la clé de texte et ses variables (toujours un exemple). */
export function valueErrorKey(reason: "number" | "range" | "duration" | "period" | "datetime", f: Bounded, t: T): { key: string; vars: Record<string, string | number> } {
  const example = exampleNumber({ min: f.min, max: f.max, step: f.step, default: typeof f.default === "number" ? f.default : undefined });
  if (reason === "period") return { key: f.openEnded === true ? "instances.error.periodOpen" : "instances.error.period", vars: {} };
  if (reason === "datetime") return { key: "instances.error.datetime", vars: {} };
  if (reason === "duration") return { key: "instances.error.duration", vars: { example: secondsText(t, typeof f.default === "number" ? f.default : 90) } };
  if (reason === "number") return { key: "instances.error.number", vars: { example } };
  const ex = show(t, f, example);
  if (f.min !== undefined && f.max !== undefined) return { key: "instances.error.range", vars: { min: show(t, f, f.min), max: show(t, f, f.max), example: ex } };
  if (f.min !== undefined) return { key: "instances.error.rangeMin", vars: { min: show(t, f, f.min), example: ex } };
  if (f.max !== undefined) return { key: "instances.error.rangeMax", vars: { max: show(t, f, f.max), example: ex } };
  return { key: "instances.error.rangeStep", vars: { step: f.step ?? 1, example: ex } };
}
