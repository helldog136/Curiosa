/**
 * Droits d'un jeton MCP sur les actions. Logique pure (aucune dépendance) : c'est ELLE qui décide, à
 * chaque requête, si un jeton voit et peut appeler une action.
 *
 *   droit effectif = plafond du jeton  ET  (accès accordé au jeton  OU  défaut du module)
 *
 * - le plafond : un jeton « lecture » n'écrit jamais, quoi qu'on lui accorde ;
 * - l'accès : surcharge explicite posée par l'administrateur (`grants[outil] = true|false`) ;
 * - à défaut de surcharge : le défaut déclaré par le module (`default`). Une action destructrice n'a
 *   jamais `default: true` : elle n'est active que si un administrateur l'a accordée à ce jeton.
 */
export type ToolAccessInfo = { name: string; readOnly: boolean; default: boolean };
export type Grants = Record<string, boolean>;
export type Scope = "read" | "write";

/** Parse sans jamais lever : un champ corrompu donne « aucune surcharge ». */
export function parseGrants(raw: string | null | undefined): Grants {
  try {
    const v = JSON.parse(raw ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, on]) => typeof on === "boolean")) as Grants;
  } catch {
    return {};
  }
}

export function withinCeiling(tool: Pick<ToolAccessInfo, "readOnly">, scope: Scope): boolean {
  return scope === "write" || tool.readOnly;
}

export function isGranted(tool: ToolAccessInfo, grants: Grants): boolean {
  return grants[tool.name] ?? tool.default;
}

/** Le jeton peut-il voir et appeler cette action ? */
export function canUse(tool: ToolAccessInfo, token: { scope: Scope; grants: Grants }): boolean {
  return withinCeiling(tool, token.scope) && isGranted(tool, token.grants);
}

/** Nouvelle table de surcharges après avoir accordé/retiré une action (une surcharge égale au défaut est supprimée). */
export function setGrant(grants: Grants, tool: ToolAccessInfo, enabled: boolean): Grants {
  const next = { ...grants };
  if (enabled === tool.default) delete next[tool.name];
  else next[tool.name] = enabled;
  return next;
}
