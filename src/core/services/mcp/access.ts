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
import { ownerCeilingAllows, type OwnerState, type ToolRequirement } from "./ownerCeiling";

export type ToolAccessInfo = {
  name: string; readOnly: boolean; default: boolean;
  /** (0.46.0) What a personal AI needs from its owner for this tool (ownerCeiling.ts). Absent: classified by name for a core tool, hidden from personal AIs otherwise. */
  requires?: ToolRequirement; instanceId?: string; moduleId?: string;
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

/**
 * FULL POWERS (core 0.35.0, fullPowers.ts). One switch per access, set ONLY by the owner in the admin (never by a tool, never by an access):
 * the access then holds every right of the CURRENT catalogue, computed on each request, so a tool added by an update or a new module is granted at once.
 * What stays outside, because it protects the core itself: see `neverUnderFullPowers`. The ceiling stays (a read-only access is never raised), the approval
 * setting, the hourly limits and the upload limits are separate checks that this file does not touch.
 */
export type AccessToken = {
  scope: Scope; grants: Grants; fullPowers?: boolean;
  /** (0.46.0) Present ONLY for a personal AI (an access that belongs to a user): the owner as seen now. Absent = an independent access, whose behaviour is unchanged. */
  personal?: OwnerState;
  /** (0.47.0) The access existed before every access had an owner: undeclared module tools use the coarse fallback (ownerCeiling.ts). */
  coarse?: boolean;
};

/**
 * Tools that no switch grants, by name (the short name for a module tool, `<instance>__<tool>`). They would let an access manage accesses, rights or
 * full powers, or reach a secret. No such tool exists today (a test fails if one appears under one of these words and is not listed in `FULL_POWERS_KEPT_OUT`):
 * the rule is here so that a tool added later with such a purpose is NOT granted automatically and stays a one-by-one choice of the owner.
 * `maintenance_my_access` only reads what this access can do: it is not management.
 */
const NEVER_UNDER_FULL_POWERS = /(^|_)(token|tokens|secret|secrets|credential|credentials|password|passwords|oauth|grant|grants|rights|permission|permissions|fullpowers|full_powers|access_create|access_revoke|access_set|approval)(_|$)/;
/** Reads of the own access that the word list above would catch by mistake. */
const MANAGEMENT_LOOKALIKES = new Set(["maintenance_my_access", "maintenance_request_status"]);
export const neverUnderFullPowers = (tool: Pick<ToolAccessInfo, "name">): boolean => {
  if (MANAGEMENT_LOOKALIKES.has(tool.name)) return false;
  const short = tool.name.includes("__") ? tool.name.split("__").slice(1).join("__") : tool.name;
  return NEVER_UNDER_FULL_POWERS.test(short.replace(/^maintenance_/, ""));
};

/** Does full powers grant this tool? The ceiling still applies, and so does the exclusion list. */
export function grantedByFullPowers(tool: ToolAccessInfo, token: AccessToken): boolean {
  return token.fullPowers === true && withinCeiling(tool, token.scope) && !neverUnderFullPowers(tool);
}

/** Le jeton peut-il voir et appeler cette action ? */
export function canUse(tool: ToolAccessInfo, token: AccessToken): boolean {
  if (token.personal !== undefined) {
    // A personal AI: the owner's CURRENT rights are a ceiling on top of the ordinary rules, and full powers apply only to an access that already held them before owners were mandatory (`coarse`; fullPowers.ts never sets them on another one): even then the ceiling comes first.
    return ownerCeilingAllows(tool, token.personal, { coarse: token.coarse }) && ((token.coarse === true && grantedByFullPowers(tool, token)) || (withinCeiling(tool, token.scope) && isGranted(tool, token.grants)));
  }
  return grantedByFullPowers(tool, token) || (withinCeiling(tool, token.scope) && isGranted(tool, token.grants));
}

/** An action worth a journal line of its own under full powers: it deletes, asks for a change of the site's code, or publishes. */
export function dangerousUnderFullPowers(tool: { name: string; readOnly: boolean; destructive?: boolean; request?: boolean; instanceId?: string }): boolean {
  if (tool.readOnly) return false;
  return tool.destructive === true || tool.request === true || (!!tool.instanceId && /__(publish|unpublish|update_published_meta)$/.test(tool.name));
}

/** Nouvelle table de surcharges après avoir accordé/retiré une action (une surcharge égale au défaut est supprimée). */
export function setGrant(grants: Grants, tool: ToolAccessInfo, enabled: boolean): Grants {
  const next = { ...grants };
  if (enabled === defaultFor(tool, grants)) delete next[tool.name];
  else next[tool.name] = enabled;
  return next;
}
