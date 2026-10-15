// Réglages à remplir d'un module : lesquels manquent, comment les nommer, comment y mener. Logique pure (ni base ni React), testée telle quelle.

/** Ce que la règle lit d'un réglage du manifeste. */
export type FillField = { key: string; type: string; default?: unknown; translatable?: boolean; advanced?: boolean; optional?: boolean };

/** Types de réglages qu'on « remplit » (clé, adresse, identifiant…) : les cases, listes, nombres et couleurs ont toujours une valeur. */
const FILLABLE = ["secret", "text", "url", "link"];

/**
 * Les réglages à remplir qui manquent : champ vide, sans valeur par défaut, ni technique (« avancé »), ni déclaré facultatif (`optional`),
 * ni traduisible, ni dans un groupe facultatif. `stored[clé]` = valeurs enregistrées par langue (un secret enregistré compte comme rempli).
 * L'ordre du manifeste est conservé.
 */
export function missingSettings<T extends FillField>(fields: readonly T[], groupedKeys: ReadonlySet<string>, stored: Record<string, Record<string, unknown> | undefined>): T[] {
  return fields.filter((f) =>
    !f.advanced && !f.optional && !groupedKeys.has(f.key) && FILLABLE.includes(f.type) && f.default === undefined && !f.translatable
    && !Object.values(stored[f.key] ?? {}).some((v) => v !== undefined && v !== ""));
}

/** Libellé court d'un réglage pour une pastille : sans la précision entre parenthèses à la fin (« Adresse du calendrier (iCal, secrète) » → « Adresse du calendrier »). */
export function shortLabel(label: string): string {
  const short = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return short === "" ? label.trim() : short;
}

/** Ce que dit la pastille « à configurer » : rien, le nom du réglage s'il n'y en a qu'un, sinon seulement leur nombre (la liste est dans la fenêtre de réglages). */
export type MissingSummary = { kind: "none" } | { kind: "one"; label: string } | { kind: "many"; count: number };

export function summarizeMissing(labels: readonly string[]): MissingSummary {
  if (labels.length === 0) return { kind: "none" };
  if (labels.length === 1) return { kind: "one", label: shortLabel(labels[0]!) };
  return { kind: "many", count: labels.length };
}

/**
 * Plusieurs instances d'un même module : une seule à régler → ses réglages ; plusieurs → le total, sans les nommer
 * (chaque instance dit elle-même ce qui lui manque dans la liste dépliée).
 */
export function summarizeMissingAcross(perInstance: readonly (readonly string[])[]): MissingSummary {
  const filled = perInstance.filter((l) => l.length > 0);
  if (filled.length === 1) return summarizeMissing(filled[0]!);
  return summarizeMissing(filled.flat());
}

/** Identifiant du champ d'un réglage dans le formulaire (ancre des liens « Il reste à renseigner »). Même valeur que `name` et `id` de la saisie. */
export const settingFieldId = (key: string): string => `s__${key}`;

/** Les entrées de l'encadré « Il reste à renseigner » : libellé complet (celui du champ) et ancre. */
export function missingLinks(fields: readonly { key: string }[], labelOf: (key: string) => string): { key: string; label: string; href: string; id: string }[] {
  return fields.map((f) => ({ key: f.key, label: labelOf(f.key), id: settingFieldId(f.key), href: `#${settingFieldId(f.key)}` }));
}
