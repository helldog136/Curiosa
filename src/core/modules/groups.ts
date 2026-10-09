import type { OptionalGroupDecl, SettingField } from "./types";

/**
 * Groupes de réglages facultatifs : logique pure (sans base de données ni React), partagée par le manifeste, l'admin et le serveur.
 */

export const MAX_GROUPS = 6;

/** Nom du champ caché qui dit si le groupe est ouvert (« 1 ») ou retiré (« 0 ») dans le formulaire. */
export const groupFlagName = (id: string): string => `__group__${id}`;

/** Problèmes d'une déclaration `optionalGroups` (liste vide = valide). */
export function groupIssues(groups: readonly OptionalGroupDecl[], settings: readonly Pick<SettingField, "key" | "type">[]): string[] {
  const issues: string[] = [];
  if (groups.length > MAX_GROUPS) issues.push(`at most ${MAX_GROUPS} optional groups`);
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  for (const g of groups) {
    if (ids.has(g.id)) issues.push(`duplicate group "${g.id}"`);
    ids.add(g.id);
    if (g.fields.length === 0) issues.push(`group "${g.id}" has no field`);
    for (const key of g.fields) {
      if (!byKey.has(key)) issues.push(`group "${g.id}": unknown setting "${key}"`);
      else if (owner.has(key)) issues.push(`setting "${key}" is in two groups ("${owner.get(key)}" and "${g.id}")`);
      else owner.set(key, g.id);
    }
    for (const key of g.required ?? []) {
      if (!g.fields.includes(key)) issues.push(`group "${g.id}": required "${key}" is not one of its fields`);
      else if (byKey.get(key)?.type === "boolean") issues.push(`group "${g.id}": a checkbox cannot be required ("${key}")`);
    }
  }
  return issues;
}

/** Une valeur enregistrée compte-t-elle comme « renseignée » ? (une case à cocher compte seulement quand elle diffère de son défaut) */
export function hasValue(field: Pick<SettingField, "type" | "default">, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (field.type === "boolean") return value !== (field.default === true);
  return value !== "";
}

/** Le groupe a-t-il au moins une valeur ? `byLocale[clé]` = valeurs enregistrées par langue ("" = non traduit). */
export function groupHasValue(group: Pick<OptionalGroupDecl, "fields">, fields: readonly Pick<SettingField, "key" | "type" | "default">[], byLocale: Record<string, Record<string, unknown> | undefined>): boolean {
  return group.fields.some((key) => {
    const f = fields.find((x) => x.key === key);
    return !!f && Object.values(byLocale[key] ?? {}).some((v) => hasValue(f, v));
  });
}

/**
 * Où s'affiche chaque groupe : à la place de son premier champ (dans l'ordre des réglages). Renvoie, pour une liste de champs
 * visibles, la suite d'éléments à rendre : un champ seul, ou un groupe (une seule fois ; ses autres champs ne sont pas répétés).
 */
export type Slot = { kind: "field"; field: SettingField } | { kind: "group"; group: OptionalGroupDecl; fields: SettingField[] };
export function layoutFields(fields: readonly SettingField[], groups: readonly OptionalGroupDecl[] = []): Slot[] {
  const out: Slot[] = [];
  const done = new Set<string>();
  for (const f of fields) {
    const group = groups.find((g) => g.fields.includes(f.key));
    if (!group) { out.push({ kind: "field", field: f }); continue; }
    if (done.has(group.id)) continue;
    done.add(group.id);
    out.push({ kind: "group", group, fields: fields.filter((x) => group.fields.includes(x.key)) });
  }
  return out;
}

export type GroupVerdict = { action: "keep" } | { action: "clear" } | { action: "error"; missing: string[] };

/**
 * Que faire d'un groupe à l'enregistrement ?
 * - `flag` « 0 » (Retirer) : tout effacer ;
 * - `flag` « 1 » (ouvert) : refuser tant qu'un champ obligatoire n'est pas rempli (`filled[clé]`) ;
 * - sinon (groupe absent du formulaire) : ne rien toucher.
 */
export function judgeGroup(group: Pick<OptionalGroupDecl, "required">, flag: string | null | undefined, filled: Record<string, boolean>): GroupVerdict {
  if (flag === "0") return { action: "clear" };
  if (flag !== "1") return { action: "keep" };
  const missing = (group.required ?? []).filter((key) => !filled[key]);
  return missing.length > 0 ? { action: "error", missing } : { action: "keep" };
}
