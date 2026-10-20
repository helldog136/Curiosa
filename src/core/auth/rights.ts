/**
 * DROITS (0.2.0) : le catalogue de tous les droits connus et ce que donnent les rôles prédéfinis. Logique pure, sans base ni Next : testée directement.
 *
 * - Droits du cœur, espace « core: ». Délégables (proposés dans un rôle personnalisé) : `core:entries.edit`, `core:entries.publish`.
 *   Réservés au propriétaire (jamais proposés, refusés côté serveur s'ils arrivent dans un formulaire forgé) : voir `CORE_RESERVED`.
 * - Droits de modules : déclarés dans `rights` du manifeste avec un identifiant LOCAL (« email.view ») ; le cœur les préfixe par l'identifiant
 *   du module (« contacts:email.view ») : un module ne peut donc jamais déclarer un droit qui s'applique à un autre.
 *   Le droit implicite `<module>:open` ouvre la page d'administration du module.
 * - Rôles prédéfinis : owner = tout ; admin = tout sauf les droits réservés, et les droits de modules dont `default.admin !== false` ;
 *   editor = modifier et publier les contenus, et les droits de modules dont `default.editor === true` (comportement d'avant la 0.2.0 : un éditeur publie).
 */
import type { LocalizedString } from "../modules/types";

export type Level = "owner" | "admin" | "editor" | "none";
export const SYSTEM_ROLE_KEYS = ["owner", "admin", "editor"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
export const isSystemKey = (k: string): k is SystemRoleKey => (SYSTEM_ROLE_KEYS as readonly string[]).includes(k);

export const CORE_DELEGABLE = ["core:entries.edit", "core:entries.publish"] as const;
export const CORE_RESERVED = ["core:team", "core:roles", "core:backup", "core:updates", "core:modules.install", "core:mcp.tokens", "core:security"] as const;
const RESERVED = new Set<string>(CORE_RESERVED);
export const isReserved = (right: string): boolean => RESERVED.has(right);

/** Identifiant local d'un droit de module (manifeste) : 1 à 3 segments en minuscules, jamais de « : » (le préfixe est l'affaire du cœur). */
export const RIGHT_ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,2}$/;
export const MAX_MODULE_RIGHTS = 20;
/** Le droit implicite de chaque module : ouvrir sa page d'administration. Un module ne le redéclare pas. */
export const OPEN = "open";

export type RightDecl = { id: string; label?: LocalizedString; help?: LocalizedString; sensitive?: boolean; default?: { admin?: boolean; editor?: boolean } };
export type ModuleRightsSource = { moduleId: string; name: LocalizedString; rights?: RightDecl[] | null };

export type RightInfo = {
  /** Identifiant complet : « core:entries.edit » ou « <module>:<droit> ». */
  id: string;
  /** null = droit du cœur. */
  moduleId: string | null;
  moduleName: LocalizedString | null;
  /** Identifiant local (« entries.edit », « open », « email.view »). */
  local: string;
  label: LocalizedString | null;
  help: LocalizedString | null;
  sensitive: boolean;
  reserved: boolean;
  admin: boolean;
  editor: boolean;
};

/** Préfixe imposé par le cœur. Un identifiant local invalide (ou contenant « : ») ne donne aucun droit. */
export function moduleRight(moduleId: string, local: string): string | null {
  return RIGHT_ID_RE.test(local) ? `${moduleId}:${local}` : null;
}

/**
 * Le droit exigé par une `adminAction` de forme objet : identifiant local (« phone.edit ») ou déjà préfixé par CE module (« <module>:phone.edit »).
 * Le droit d'un autre module, ou un identifiant invalide, donne null : l'action est alors toujours refusée.
 */
export function actionRight(moduleId: string, right: unknown): string | null {
  if (typeof right !== "string") return null;
  const i = right.indexOf(":");
  if (i === -1) return moduleRight(moduleId, right);
  return right.slice(0, i) === moduleId ? moduleRight(moduleId, right.slice(i + 1)) : null;
}

/** Tous les droits connus : ceux du cœur, puis par module (« ouvrir », puis ceux du manifeste, 20 au plus, doublons et identifiants invalides ignorés). */
export function rightsCatalogue(modules: ModuleRightsSource[]): RightInfo[] {
  const out: RightInfo[] = [
    ...CORE_DELEGABLE.map((id) => ({ id, moduleId: null, moduleName: null, local: id.slice(5), label: null, help: null, sensitive: false, reserved: false, admin: true, editor: true })),
    ...CORE_RESERVED.map((id) => ({ id, moduleId: null, moduleName: null, local: id.slice(5), label: null, help: null, sensitive: false, reserved: true, admin: false, editor: false })),
  ];
  for (const m of [...modules].sort((a, b) => a.moduleId.localeCompare(b.moduleId))) {
    const seen = new Set<string>([OPEN]);
    out.push({ id: `${m.moduleId}:${OPEN}`, moduleId: m.moduleId, moduleName: m.name, local: OPEN, label: null, help: null, sensitive: false, reserved: false, admin: true, editor: false });
    for (const r of (m.rights ?? []).slice(0, MAX_MODULE_RIGHTS)) {
      const id = typeof r?.id === "string" ? moduleRight(m.moduleId, r.id) : null;
      if (!id || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id, moduleId: m.moduleId, moduleName: m.name, local: r.id, label: r.label ?? null, help: r.help ?? null, sensitive: r.sensitive === true, reserved: false, admin: r.default?.admin !== false, editor: r.default?.editor === true });
    }
  }
  return out;
}

/** Les droits d'un rôle prédéfini (calculés : un module installé plus tard apporte ses droits par défaut sans rien enregistrer). */
export function systemRights(level: Level, catalogue: RightInfo[]): Set<string> {
  if (level === "owner") return new Set(catalogue.map((r) => r.id));
  if (level === "admin") return new Set(catalogue.filter((r) => !r.reserved && r.admin).map((r) => r.id));
  if (level === "editor") return new Set(catalogue.filter((r) => !r.reserved && r.editor).map((r) => r.id));
  return new Set();
}

/** Ce qu'un rôle personnalisé peut contenir : droits connus, jamais réservés. Le reste (droit inconnu, réservé, d'un module retiré) est ignoré. */
export function delegableRights(catalogue: RightInfo[]): Set<string> {
  return new Set(catalogue.filter((r) => !r.reserved).map((r) => r.id));
}

/** Liste JSON d'un rôle → droits valides seulement (défense en profondeur : une ligne modifiée à la main ne donne jamais un droit réservé). */
export function parseStoredRights(raw: string, catalogue: RightInfo[]): string[] {
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const allowed = delegableRights(catalogue);
  return [...new Set(list.filter((r): r is string => typeof r === "string" && allowed.has(r)))];
}

export const RANK: Record<Level, number> = { none: 0, editor: 1, admin: 2, owner: 3 };

/** Niveau historique d'après des clés de rôles : le plus haut rôle prédéfini, sinon « none ». */
export function levelFromKeys(keys: readonly string[]): Level {
  let best: Level = "none";
  for (const k of keys) if (isSystemKey(k) && RANK[k] > RANK[best]) best = k;
  return best;
}
