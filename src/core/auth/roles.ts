/**
 * RÔLES (0.2.0) : rôles prédéfinis, rôles personnalisés et affectations. Toutes les règles de sécurité sont ICI, côté serveur ; les actions de la page Équipe
 * ne font que passer l'identifiant de la personne connectée (jamais lu dans le formulaire) et les valeurs envoyées.
 *
 * - Seuls les niveaux qui détiennent `core:roles` (rôles) ou `core:team` (affectations) agissent : le propriétaire et, selon `LEVEL_RESERVED`, le coordinateur
 *   technique (l'acteur est RELU en base à chaque appel). Voir team.ts pour « qui peut gérer qui ».
 * - Anti-élévation : un rôle ne contient que des droits connus que son créateur possède, jamais un droit réservé ; un rôle qu'on affecte ne donne que des droits
 *   que l'acteur possède ; les rôles `owner` (jamais) et `coordinator` (propriétaire seul) ne s'affectent pas autrement ; un identifiant forgé est refusé.
 * - Anti-verrouillage : une personne garde au moins un rôle ; un rôle en usage ne se supprime qu'avec une réaffectation ; le propriétaire est intouchable.
 * - `User.role` (niveau historique, lu par un ancien cœur) et `User.coordinator` sont recalculés à chaque changement : le plus haut rôle prédéfini, sinon « none »
 *   (le coordinateur s'écrit « admin » + drapeau, voir `columnsOf`).
 */
import { prisma } from "../db";
import { accessOf, currentCatalogue, levelOf } from "./access";
import { columnsOf, parseStoredRights, isReserved, isSystemKey, levelFromKeys, SYSTEM_ROLE_KEYS, type Level, type RightInfo } from "./rights";
import { canManageMember, grantableLevels } from "./team";

const SYSTEM_NAMES: Record<(typeof SYSTEM_ROLE_KEYS)[number], string> = { owner: "Owner", coordinator: "Technical coordination", admin: "Administration", editor: "Editorial" };
export const ROLE_NAME_MAX = 60;
export const ROLE_DESCRIPTION_MAX = 300;
/** Plafond de rôles personnalisés (dézoom permanent : la page Équipe reste lisible et bornée). */
export const MAX_CUSTOM_ROLES = 50;

async function audit(actor: string, action: string, target = ""): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target } }).catch(() => {});
}

/** Crée les trois rôles prédéfinis s'ils manquent (idempotent, sans jamais changer un rôle existant hormis son caractère « système »). */
export async function ensureSystemRoles(): Promise<void> {
  for (const key of SYSTEM_ROLE_KEYS) {
    await prisma.role.upsert({ where: { key }, create: { key, name: SYSTEM_NAMES[key], system: true, rights: "[]" }, update: { system: true, rights: "[]" } });
  }
}

/**
 * Accorde les affectations prédéfinies sur `User.role` (source de vérité du niveau) : chaque personne a exactement le rôle prédéfini égal à son niveau
 * (aucun pour « none »). Idempotent ; appelé au démarrage, après une restauration et après chaque changement. Les rôles personnalisés ne sont pas touchés.
 */
export async function syncSystemAssignments(): Promise<{ added: number; removed: number }> {
  await ensureSystemRoles();
  const system = await prisma.role.findMany({ where: { system: true }, select: { id: true, key: true } });
  const idOf = new Map(system.map((r) => [r.key, r.id]));
  const keyOf = new Map(system.map((r) => [r.id, r.key]));
  let added = 0, removed = 0;
  // Le drapeau « coordinateur » ne vaut que sur un compte « admin » : si un ancien cœur a changé `role`, le drapeau périmé est effacé (jamais de retour d'un niveau perdu).
  await prisma.user.updateMany({ where: { coordinator: true, NOT: { role: "admin" } }, data: { coordinator: false } });
  // Par tranches : l'équipe est petite, mais rien n'est lu sans borne.
  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({ select: { id: true, role: true, coordinator: true, roles: { select: { roleId: true } } }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (users.length === 0) break;
    for (const u of users) {
      const level = levelOf(u);
      const want = level === "none" ? null : idOf.get(level) ?? null;
      const wrong = u.roles.filter((r) => keyOf.has(r.roleId) && r.roleId !== want).map((r) => r.roleId);
      if (wrong.length) { await prisma.userRole.deleteMany({ where: { userId: u.id, roleId: { in: wrong } } }); removed += wrong.length; }
      if (want && !u.roles.some((r) => r.roleId === want)) { await prisma.userRole.create({ data: { userId: u.id, roleId: want } }); added++; }
    }
    cursor = users.at(-1)!.id;
    if (users.length < 200) break;
  }
  return { added, removed };
}

/** Au démarrage : rôles prédéfinis + affectation initiale depuis `User.role`. Ne lève jamais (le site public doit démarrer). */
export async function initRoles(): Promise<void> {
  try {
    const r = await syncSystemAssignments();
    if (r.added || r.removed) console.log(`[roles] system role assignments synced: +${r.added} -${r.removed}`);
  } catch (error) {
    console.error("[roles] init failed:", (error as Error)?.message);
  }
}

export type RoleFailure = "denied" | "name" | "rights" | "system" | "missing" | "inUse" | "replacement" | "owner" | "empty" | "role" | "limit" | "level";
export type RoleResult<T = object> = ({ ok: true } & T) | { ok: false; reason: RoleFailure };

type Actor = { id: string; email: string; level: Level; rights: Set<string> };

/**
 * L'acteur, relu en base : il doit détenir ce droit réservé (`core:roles` pour les rôles, `core:team` pour les personnes), ne pas avoir de mot de passe temporaire
 * à remplacer. Retourne aussi son niveau et ses droits (anti-élévation).
 */
async function actorWith(actorId: string, right: "core:roles" | "core:team", catalogue: RightInfo[]): Promise<Actor | null> {
  const row = await prisma.user.findUnique({ where: { id: String(actorId ?? "") }, select: { id: true, email: true, role: true, coordinator: true, mustChangePassword: true } });
  if (!row || row.mustChangePassword) return null;
  const access = await accessOf(row, catalogue);
  return access.rights.has(right) ? { id: row.id, email: row.email, level: access.level, rights: access.rights } : null;
}

/** Les droits d'un rôle (liste JSON), valides seulement. */
const storedRights = (raw: string, catalogue: RightInfo[]): string[] => parseStoredRights(raw, catalogue);
const withinRights = (rights: string[], actor: Actor): boolean => rights.every((r) => actor.rights.has(r));

const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "role";

/** Droits demandés → droits acceptés. Un seul droit inconnu, réservé ou que l'acteur n'a pas suffit à refuser TOUT le formulaire (jamais d'enregistrement partiel silencieux). */
function checkRights(requested: unknown, actorRights: Set<string>, catalogue: RightInfo[]): string[] | null {
  if (!Array.isArray(requested)) return null;
  const known = new Set(catalogue.map((r) => r.id));
  const out = new Set<string>();
  for (const r of requested) {
    if (typeof r !== "string" || !known.has(r) || isReserved(r) || !actorRights.has(r)) return null;
    out.add(r);
  }
  return [...out].sort();
}

function cleanName(input: { name?: unknown; description?: unknown }): { name: string; description: string } | null {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  const description = String(input.description ?? "").replace(/\s+/g, " ").trim().slice(0, ROLE_DESCRIPTION_MAX);
  if (!name || name.length > ROLE_NAME_MAX) return null;
  return { name, description };
}

export async function createRole(actorId: string, input: { name?: unknown; description?: unknown; rights?: unknown }): Promise<RoleResult<{ id: string; key: string }>> {
  const catalogue = await currentCatalogue();
  const actor = await actorWith(actorId, "core:roles", catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const text = cleanName(input);
  if (!text) return { ok: false, reason: "name" };
  const rights = checkRights(input.rights, actor.rights, catalogue);
  if (!rights) return { ok: false, reason: "rights" };
  if ((await prisma.role.count({ where: { system: false } })) >= MAX_CUSTOM_ROLES) return { ok: false, reason: "limit" };
  if (await prisma.role.findFirst({ where: { name: text.name } })) return { ok: false, reason: "name" };
  await ensureSystemRoles();
  const base = `r-${slugify(text.name)}`;
  let key = base;
  for (let i = 2; await prisma.role.findUnique({ where: { key } }); i++) key = `${base}-${i}`;
  const role = await prisma.role.create({ data: { key, name: text.name, description: text.description, system: false, rights: JSON.stringify(rights) } });
  await audit(actor.email, "role.create", `${key}:${rights.join(",")}`);
  return { ok: true, id: role.id, key };
}

export async function updateRole(actorId: string, roleId: string, input: { name?: unknown; description?: unknown; rights?: unknown }): Promise<RoleResult> {
  const catalogue = await currentCatalogue();
  const actor = await actorWith(actorId, "core:roles", catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const role = await prisma.role.findUnique({ where: { id: String(roleId ?? "") } });
  if (!role) return { ok: false, reason: "missing" };
  if (role.system || isSystemKey(role.key)) return { ok: false, reason: "system" };
  // Anti-élévation : on ne remodèle pas un rôle qui donne des droits qu'on n'a pas soi-même.
  if (!withinRights(storedRights(role.rights, catalogue), actor)) return { ok: false, reason: "rights" };
  const text = cleanName(input);
  if (!text) return { ok: false, reason: "name" };
  const rights = checkRights(input.rights, actor.rights, catalogue);
  if (!rights) return { ok: false, reason: "rights" };
  if (await prisma.role.findFirst({ where: { name: text.name, NOT: { id: role.id } } })) return { ok: false, reason: "name" };
  await prisma.role.update({ where: { id: role.id }, data: { name: text.name, description: text.description, rights: JSON.stringify(rights) } });
  await audit(actor.email, "role.update", `${role.key}:${rights.join(",")}`);
  return { ok: true };
}

/** Recalcule `User.role` et `User.coordinator` d'une personne (le plus haut rôle prédéfini, sinon « none »). */
async function recomputeLevel(tx: Pick<typeof prisma, "userRole" | "user">, userId: string): Promise<Level> {
  const rows = await tx.userRole.findMany({ where: { userId }, include: { role: { select: { key: true, system: true } } } });
  // Le niveau actuel de la ligne compte aussi : une affectation prédéfinie manquante (pas encore synchronisée) ne doit jamais retirer un niveau à quelqu'un.
  const now = await tx.user.findUnique({ where: { id: userId }, select: { role: true, coordinator: true } });
  const level = levelFromKeys([...rows.filter((r) => r.role.system).map((r) => r.role.key), levelOf(now)]);
  await tx.user.update({ where: { id: userId }, data: columnsOf(level) });
  return level;
}

/**
 * Supprime un rôle personnalisé. En usage : `replacementId` est obligatoire (un autre rôle, jamais `owner`) et chaque personne qui l'avait le reçoit
 * (elle ne se retrouve donc jamais sans rôle). Tout ou rien (une transaction).
 */
export async function deleteRole(actorId: string, roleId: string, replacementId?: string | null): Promise<RoleResult<{ moved: number }>> {
  const catalogue = await currentCatalogue();
  const actor = await actorWith(actorId, "core:roles", catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const role = await prisma.role.findUnique({ where: { id: String(roleId ?? "") }, include: { users: { select: { userId: true } } } });
  if (!role) return { ok: false, reason: "missing" };
  if (role.system || isSystemKey(role.key)) return { ok: false, reason: "system" };
  if (!withinRights(storedRights(role.rights, catalogue), actor)) return { ok: false, reason: "rights" };
  const holders = role.users.map((u) => u.userId);
  // Supprimer un rôle réaffecte ses membres : un coordinateur ne touche donc pas un rôle tenu par un autre coordinateur (ni par le propriétaire).
  if (holders.length) {
    const rows = await prisma.user.findMany({ where: { id: { in: holders } }, select: { id: true, role: true, coordinator: true } });
    if (actor.level !== "owner" && rows.some((h) => levelOf(h) === "coordinator" || levelOf(h) === "owner")) return { ok: false, reason: "level" };
  }
  let replacement: { id: string; key: string; system: boolean } | null = null;
  if (holders.length > 0) {
    if (!replacementId) return { ok: false, reason: "inUse" };
    replacement = await prisma.role.findUnique({ where: { id: String(replacementId) }, select: { id: true, key: true, system: true } });
    if (!replacement || replacement.id === role.id || replacement.key === "owner" || (replacement.key === "coordinator" && actor.level !== "owner")) return { ok: false, reason: "replacement" };
    if (!replacement.system) {
      const rep = await prisma.role.findUnique({ where: { id: replacement.id }, select: { rights: true } });
      if (!withinRights(storedRights(rep?.rights ?? "[]", catalogue), actor)) return { ok: false, reason: "rights" };
    }
  }
  await prisma.$transaction(async (tx) => {
    for (const userId of holders) {
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (levelOf(owner) === "owner") continue; // jamais : le propriétaire n'a pas de rôle personnalisé ; par prudence on ne le touche pas
      // Un seul rôle prédéfini par personne : réaffecter vers admin/editor remplace son rôle prédéfini actuel par le plus haut des deux.
      if (replacement!.system) {
        const current = await tx.userRole.findMany({ where: { userId, role: { system: true } }, include: { role: { select: { key: true } } } });
        const best = levelFromKeys([replacement!.key, ...current.map((c) => c.role.key)]);
        if (best === replacement!.key) await tx.userRole.deleteMany({ where: { userId, roleId: { in: current.map((c) => c.roleId) } } });
        if (best === replacement!.key) await tx.userRole.create({ data: { userId, roleId: replacement!.id } });
      } else {
        await tx.userRole.upsert({ where: { userId_roleId: { userId, roleId: replacement!.id } }, create: { userId, roleId: replacement!.id }, update: {} });
      }
    }
    await tx.userRole.deleteMany({ where: { roleId: role.id } });
    await tx.role.delete({ where: { id: role.id } });
    for (const userId of holders) {
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (levelOf(owner) !== "owner") await recomputeLevel(tx, userId);
    }
  });
  await audit(actor.email, "role.delete", `${role.key}${replacement ? `->${replacement.key}` : ""}:${holders.length}`);
  return { ok: true, moved: holders.length };
}

/**
 * Les rôles d'une personne (puces cumulables). Il faut détenir `core:team` ; la cible n'est jamais le propriétaire, ni soi-même, ni (sauf pour le propriétaire)
 * un coordinateur ; au moins un rôle ; `owner` et tout identifiant inconnu sont refusés ; le niveau attribué doit être de ceux que l'acteur peut attribuer
 * (`grantableLevels` : seul le propriétaire nomme un coordinateur) ; un rôle personnalisé AJOUTÉ ne donne que des droits que l'acteur possède.
 * Parmi les rôles prédéfinis, seul le plus haut est gardé (c'est le niveau).
 */
export async function setUserRoles(actorId: string, targetId: string, roleIds: unknown): Promise<RoleResult<{ level: Level }>> {
  const catalogue = await currentCatalogue();
  const actor = await actorWith(actorId, "core:team", catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const target = await prisma.user.findUnique({ where: { id: String(targetId ?? "") }, select: { id: true, email: true, role: true, coordinator: true, roles: { select: { roleId: true } } } });
  if (!target) return { ok: false, reason: "missing" };
  const current = levelOf(target);
  if (current === "owner" || target.id === actor.id) return { ok: false, reason: "owner" };
  if (!canManageMember(actor.level, current)) return { ok: false, reason: "level" };
  if (!Array.isArray(roleIds)) return { ok: false, reason: "role" };
  const ids = [...new Set(roleIds.map((r) => String(r ?? "")))].filter(Boolean);
  if (ids.length === 0) return { ok: false, reason: "empty" };
  if (ids.length > MAX_CUSTOM_ROLES + 3) return { ok: false, reason: "role" };
  await ensureSystemRoles();
  const roles = await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, system: true, rights: true } });
  if (roles.length !== ids.length || roles.some((r) => r.key === "owner" || (r.system && !isSystemKey(r.key)))) return { ok: false, reason: "role" };
  const level = levelFromKeys(roles.filter((r) => r.system).map((r) => r.key));
  if (level !== current && level !== "none" && !grantableLevels(actor.level).includes(level)) return { ok: false, reason: "level" };
  const held = new Set(target.roles.map((r) => r.roleId));
  for (const r of roles) if (!r.system && !held.has(r.id) && !withinRights(storedRights(r.rights, catalogue), actor)) return { ok: false, reason: "rights" };
  const keep = roles.filter((r) => !r.system || r.key === level);
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: target.id } });
    for (const r of keep) await tx.userRole.create({ data: { userId: target.id, roleId: r.id } });
    await tx.user.update({ where: { id: target.id }, data: columnsOf(level) });
  });
  await audit(actor.email, "user.roles", `${target.email}:${keep.map((r) => r.key).sort().join(",")}`);
  return { ok: true, level };
}

/** Rôle prédéfini d'une personne nouvellement créée (après `prisma.user.create`) : son affectation suit `User.role`. */
export async function assignInitialRole(userId: string): Promise<void> {
  await ensureSystemRoles();
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, coordinator: true } });
  const level = levelOf(u);
  if (level === "none") return;
  const role = await prisma.role.findUnique({ where: { key: level }, select: { id: true } });
  if (role) await prisma.userRole.upsert({ where: { userId_roleId: { userId, roleId: role.id } }, create: { userId, roleId: role.id }, update: {} });
}

export type RoleSummary = { id: string; key: string; name: string; description: string; system: boolean; rights: string[]; users: number };

/** Tous les rôles (prédéfinis d'abord), avec le nombre de personnes, pour la page Équipe. Borné par `MAX_CUSTOM_ROLES`. */
export async function listRoles(): Promise<RoleSummary[]> {
  await ensureSystemRoles();
  const rows = await prisma.role.findMany({ include: { _count: { select: { users: true } } }, orderBy: [{ system: "desc" }, { name: "asc" }], take: MAX_CUSTOM_ROLES + SYSTEM_ROLE_KEYS.length + 10 });
  const order = (k: string) => (isSystemKey(k) ? SYSTEM_ROLE_KEYS.indexOf(k) : 99);
  return rows
    .map((r) => { let rights: string[] = []; try { const v = JSON.parse(r.rights); if (Array.isArray(v)) rights = v.filter((x) => typeof x === "string"); } catch { /* illisible = vide */ } return { id: r.id, key: r.key, name: r.name, description: r.description, system: r.system, rights, users: r._count.users }; })
    .sort((a, b) => order(a.key) - order(b.key));
}
