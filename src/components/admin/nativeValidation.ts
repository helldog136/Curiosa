import type { FieldErrorMap } from "@/core/fieldErrors";

/**
 * Validation des champs « du navigateur » (obligatoire, adresse, nombre, longueur, format) dite DANS LA LANGUE de l'interface et sous le champ (R22) :
 * le formulaire est envoyé avec `noValidate`, et ce module relit l'état de chaque champ (`el.validity`) pour écrire le même message, avec un exemple, que
 * ceux du serveur. Sans lui, la bulle du navigateur (dans SA langue, posée sur le libellé) remplace la règle. Pur : testable sans navigateur.
 */

/** Les clés de texte (`progress.invalid.<clé>`) que ce module demande. */
export const INVALID_KEYS = ["required", "choose", "check", "file", "email", "url", "number", "numberBetween", "numberMin", "numberMax", "tooShort", "tooLong", "pattern", "other"] as const;
export type InvalidKey = (typeof INVALID_KEYS)[number];
export type InvalidText = (key: InvalidKey, vars?: Record<string, string | number>) => string;

/** Ce que ce module lit d'un champ (un sous-ensemble de HTMLInputElement : les tests passent de simples objets). */
export type NativeField = {
  name: string; type?: string; tagName?: string; title?: string; value?: string;
  min?: string; max?: string; minLength?: number; maxLength?: number;
  validity: { valid: boolean; valueMissing?: boolean; typeMismatch?: boolean; patternMismatch?: boolean; tooShort?: boolean; tooLong?: boolean; rangeUnderflow?: boolean; rangeOverflow?: boolean; stepMismatch?: boolean; badInput?: boolean };
};

const isNum = (s: string | undefined): s is string => s !== undefined && s !== "" && Number.isFinite(Number(s));

/** Le message d'un champ invalide, ou `null` s'il est valide. */
export function messageFor(el: NativeField, text: InvalidText): string | null {
  const v = el.validity;
  if (v.valid) return null;
  const type = (el.type ?? "").toLowerCase();
  const tag = (el.tagName ?? "").toLowerCase();
  if (v.valueMissing) {
    if (type === "file") return text("file");
    if (type === "checkbox") return text("check");
    if (type === "radio" || tag === "select") return text("choose");
    return text("required");
  }
  if (v.typeMismatch) return type === "url" ? text("url") : type === "email" ? text("email") : text("other");
  if (v.badInput) return text("number");
  if (v.tooShort) return text("tooShort", { min: el.minLength ?? 0 });
  if (v.tooLong) return text("tooLong", { max: el.maxLength ?? 0 });
  if (v.rangeUnderflow || v.rangeOverflow || v.stepMismatch) {
    const lo = isNum(el.min) ? el.min : undefined, hi = isNum(el.max) ? el.max : undefined;
    if (lo !== undefined && hi !== undefined) return text("numberBetween", { min: lo, max: hi });
    if (lo !== undefined) return text("numberMin", { min: lo });
    if (hi !== undefined) return text("numberMax", { max: hi });
    return text("number");
  }
  if (v.patternMismatch) return el.title ? el.title : text("pattern");
  return text("other");
}

/** Un message par champ NOMMÉ invalide (le premier d'un groupe de boutons radio) ; le premier champ du formulaire reste le premier de la liste. */
export function collectNativeErrors(fields: Iterable<NativeField>, text: InvalidText): FieldErrorMap {
  const out: FieldErrorMap = {};
  for (const el of fields) {
    if (!el.name || out[el.name]) continue;
    const m = messageFor(el, text);
    if (m) out[el.name] = m;
  }
  return out;
}

/** Les champs d'un formulaire qu'on peut valider ET montrer : ni cachés (onglet masqué), ni désactivés. Une zone repliée (`details`) compte : elle s'ouvre sur le champ en erreur. */
export function validatableFields(form: HTMLFormElement): NativeField[] {
  const list: NativeField[] = [];
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (el.disabled || !el.name || (el as HTMLInputElement).type === "hidden") continue;
    const folded = el.closest("details:not([open])");
    const shown = folded || el.offsetParent !== null || getComputedStyle(el).position === "fixed" || el.classList.contains("sr-only");
    if (!shown || el.closest("[hidden]")) continue;
    list.push(el);
  }
  return list;
}
