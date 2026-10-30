import { MAX_OPTIONS, MAX_TEXT_LENGTH, type OverlayOptionDecl } from "./decl";
import { KEPT_OPTIONS_MAX_BYTES, isPlainObject, type OptionValue, type OptionValues } from "./model";

/**
 * Valeurs des options d'un élément : le cœur les valide d'après la DÉCLARATION (type, bornes, liste de choix), le module les valide encore (il reste propriétaire du sens :
 * une valeur inconnue, comme un événement supprimé, est ignorée par lui sans rien casser). Pur.
 */
export type OptionIssue = "number" | "range" | "integer" | "choice" | "boolean" | "text" | "length";
export type OptionCheck = { ok: true; value: OptionValue } | { ok: false; code: OptionIssue; min?: number; max?: number; limit?: number };

export function defaultOf(o: OverlayOptionDecl): OptionValue {
  switch (o.type) {
    case "boolean": return o.default ?? false;
    case "number": return o.default ?? o.min ?? 0;
    case "text": return o.default ?? "";
    case "choice": return o.default ?? o.choices[0]!.value;
  }
}

export function defaultOptions(decls: readonly OverlayOptionDecl[]): OptionValues {
  return Object.fromEntries(decls.slice(0, MAX_OPTIONS).map((o) => [o.id, defaultOf(o)]));
}

/** Contrôle UNE valeur reçue d'un formulaire (texte, nombre ou booléen). */
export function checkOption(o: OverlayOptionDecl, raw: unknown): OptionCheck {
  switch (o.type) {
    case "boolean":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "on" || raw === "1") return { ok: true, value: true };
      if (raw === "false" || raw === "off" || raw === "0" || raw === "") return { ok: true, value: false };
      return { ok: false, code: "boolean" };
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim().replace(",", ".")) : NaN;
      if (!Number.isFinite(n)) return { ok: false, code: "number", min: o.min, max: o.max };
      if (o.integer && !Number.isInteger(n)) return { ok: false, code: "integer", min: o.min, max: o.max };
      if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) return { ok: false, code: "range", min: o.min, max: o.max };
      return { ok: true, value: n };
    }
    case "choice":
      return typeof raw === "string" && o.choices.some((c) => c.value === raw) ? { ok: true, value: raw } : { ok: false, code: "choice" };
    case "text": {
      if (typeof raw !== "string") return { ok: false, code: "text" };
      const limit = o.maxLength ?? MAX_TEXT_LENGTH;
      const value = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      return value.length > limit ? { ok: false, code: "length", limit } : { ok: true, value };
    }
  }
}

/** Toutes les options d'un élément : une valeur absente prend son défaut, une option inconnue est écartée sans bruit ; les erreurs sont rendues par option. */
export function checkOptions(decls: readonly OverlayOptionDecl[], raw: unknown): { values: OptionValues; errors: Record<string, OptionCheck & { ok: false }> } {
  const given = isPlainObject(raw) ? raw : {};
  const values: OptionValues = {};
  const errors: Record<string, OptionCheck & { ok: false }> = {};
  for (const o of decls.slice(0, MAX_OPTIONS)) {
    if (!(o.id in given)) { values[o.id] = defaultOf(o); continue; }
    const r = checkOption(o, given[o.id]);
    if (r.ok) values[o.id] = r.value; else { errors[o.id] = r; values[o.id] = defaultOf(o); }
  }
  return { values, errors };
}

/** Valeurs d'un élément dont la déclaration n'est plus connue (module retiré) : gardées telles quelles, bornées (rien d'autre qu'un petit objet de valeurs simples). */
export function keepOptions(raw: unknown): OptionValues {
  if (!isPlainObject(raw)) return {};
  const out: OptionValues = {};
  let bytes = 0;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_OPTIONS)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    const value = typeof v === "string" ? v.slice(0, MAX_TEXT_LENGTH) : v;
    bytes += k.length + String(value).length;
    if (bytes > KEPT_OPTIONS_MAX_BYTES) break;
    out[k] = value;
  }
  return out;
}
