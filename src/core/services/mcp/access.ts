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
export type ToolAccessInfo = {
  name: string; readOnly: boolean; default: boolean;
  /** Défaut pour un jeton « maintenance » (voir MAINTENANCE_PROFILE) : seuls les outils de maintenance peuvent l'avoir à vrai. Absent = faux. */
  profileDefault?: boolean;
};
export type Grants = Record<string, boolean>;
export type Scope = "read" | "write";

/**
 * Jeton « maintenance » : un marqueur dans ses accès (pas une colonne, donc pas de migration). Un tel jeton n'a QUE les outils de maintenance :
 * les actions des modules y sont désactivées par défaut (même celles qui le sont d'ordinaire), y compris celles qu'un module installerait plus tard.
 * L'administrateur peut toujours en accorder une, explicitement.
 */
export const MAINTENANCE_PROFILE = "@profile:maintenance";

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

/** Ce que vaut une action pour ce jeton quand l'administrateur n'a rien précisé : le défaut du module, ou celui du profil « maintenance ». */
export function defaultFor(tool: ToolAccessInfo, grants: Grants): boolean {
  return grants[MAINTENANCE_PROFILE] === true ? tool.profileDefault === true : tool.default;
}

export function isGranted(tool: ToolAccessInfo, grants: Grants): boolean {
  return grants[tool.name] ?? defaultFor(tool, grants);
}

/** Le jeton peut-il voir et appeler cette action ? */
export function canUse(tool: ToolAccessInfo, token: { scope: Scope; grants: Grants }): boolean {
  return withinCeiling(tool, token.scope) && isGranted(tool, token.grants);
}

/** Nouvelle table de surcharges après avoir accordé/retiré une action (une surcharge égale au défaut est supprimée). */
export function setGrant(grants: Grants, tool: ToolAccessInfo, enabled: boolean): Grants {
  const next = { ...grants };
  if (enabled === defaultFor(tool, grants)) delete next[tool.name];
  else next[tool.name] = enabled;
  return next;
}
