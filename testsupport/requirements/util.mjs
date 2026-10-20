// Petits outils partagés par les exigences.

/** Enlève les commentaires JavaScript (// et /* *​/) pour ne pas confondre une explication avec du code. Approximatif mais prudent : « https://… » reste intact. */
export function stripComments(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;,{}()[\]=])\/\/[^\n]*/g, "$1");
}

/** Toutes les chaînes d'un texte localisé (« texte » ou { fr, en }). */
export function texts(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "object") return Object.values(value).flatMap(texts);
  return [];
}

/** La valeur est-elle un texte localisé qui couvre fr ET en (ou un simple texte, valable pour toutes les langues) ? */
export function missingLangs(value) {
  if (typeof value === "string") return value.trim() ? [] : ["fr", "en"];
  if (!value || typeof value !== "object") return ["fr", "en"];
  return ["fr", "en"].filter((l) => !String(value[l] ?? "").trim());
}

/** Tous les réglages (module + options de sections), avec leur provenance. */
export function allSettings(manifest) {
  return [
    ...(manifest.settings ?? []).map((s) => ({ ...s, where: `réglage « ${s.key} »` })),
    ...(manifest.sections ?? []).flatMap((sec) => (sec.options ?? []).map((s) => ({ ...s, where: `option « ${s.key} » de la section « ${sec.id} »` }))),
  ];
}

/** Compare deux versions « x.y.z » : <0, 0, >0. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Marche dans les blocs / résultats : appelle `visit(valeur, chemin)` pour chaque objet et chaque chaîne. */
export function walkValue(value, visit, path = "") {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walkValue(v, visit, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Response)) for (const [k, v] of Object.entries(value)) walkValue(v, visit, path ? `${path}.${k}` : k);
}

/** Phrase courte pour dire où est apparu un résultat de sonde : « la section « recent » ». */
export function whereOf(o) {
  const names = { section: "la section", slot: "l'emplacement", page: "la page", overlay: "l'overlay", export: "le partage", adminPanel: "le panneau d'administration", entryPanel: "la section de l'éditeur d'entrée", entryPanelAction: "l'action de la section d'éditeur", mcp: "l'action MCP", adminAction: "l'action d'administration", route: "la route", backup: "la sauvegarde lisible", news: "le témoin de nouveauté", adminBadge: "la pastille d'administration" };
  return `${names[o.kind] ?? o.kind}${o.name ? ` « ${o.name} »` : ""}`;
}

/**
 * Niveau des règles « réseau » (net.bounded, net.429) : leur niveau CIBLE est « obligatoire », mais le cœur 0.2.0 les livre en « conseil » (décision 7 du
 * propriétaire) ; elles passent en obligatoire au tag de modules « Contacts 2.0 ». Changer cette seule ligne suffit alors.
 */
export const NET_RULES_LEVEL = "advice";

/** Texte entre la parenthèse ouvrante d'indice `open` et sa fermante (parenthèses, crochets, accolades et chaînes simples équilibrés), borné à 4 000 caractères. */
export function balancedArgs(code, open) {
  let depth = 0;
  let quote = null;
  const end = Math.min(code.length, open + 4000);
  for (let i = open; i < end; i++) {
    const c = code[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return { args: code.slice(open + 1, i), close: i }; }
  }
  return { args: code.slice(open + 1, end), close: end };
}
