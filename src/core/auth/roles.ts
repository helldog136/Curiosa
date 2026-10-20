/**
 * RÔLES (0.2.0) : rôles prédéfinis, rôles personnalisés et affectations. Toutes les règles de sécurité sont ICI, côté serveur ; les actions de la page Équipe
 * ne font que passer l'identifiant de la personne connectée (jamais lu dans le formulaire) et les valeurs envoyées.
 *
 * - Seul le propriétaire gère les rôles et les affectations (l'acteur est RELU en base à chaque appel).
 * - Anti-élévation : un rôle ne contient que des droits connus que son créateur possède, jamais un droit réservé au propriétaire ; le rôle `owner` ne
 *   s'affecte jamais par le formulaire ; un identifiant de rôle forgé (inconnu, `owner`) est refusé.
 * - Anti-verrouillage : une personne garde au moins un rôle ; un rôle en usage ne se supprime qu'avec une réaffectation ; le propriétaire est intouchable.
 * - `User.role` (niveau historique, lu par un ancien cœur) est recalculé à chaque changement : le plus haut rôle prédéfini, sinon « none ».
 */
import { prisma } from "../db";
import { accessOf, currentCatalogue, levelOf } from "./access";
import { isReserved, isSystemKey, levelFromKeys, SYSTEM_ROLE_KEYS, type Level, type RightInfo } from "./rights";

const SYSTEM_NAMES: Record<(typeof SYSTEM_ROLE_KEYS)[number], string> = { owner: "Owner", admin: "Administrator", editor: "Editor" };
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
  // Par tranches : l'équipe est petite, mais rien n'est lu sans borne.
  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({ select: { id: true, role: true, roles: { select: { roleId: true } } }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
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

export type RoleFailure = "denied" | "name" | "rights" | "system" | "missing" | "inUse" | "replacement" | "owner" | "empty" | "role" | "limit";
export type RoleResult<T = object> = ({ ok: true } & T) | { ok: false; reason: RoleFailure };

/** L'acteur, relu en base : seul le propriétaire (niveau « owner ») gère les rôles. Retourne aussi ses droits (anti-élévation). */
async function ownerActor(actorId: string, catalogue: RightInfo[]): Promise<{ email: string; rights: Set<string> } | null> {
  const row = await prisma.user.findUnique({ where: { id: String(actorId ?? "") }, select: { id: true, email: true, role: true, mustChangePassword: true } });
  if (!row || levelOf(row) !== "owner" || row.mustChangePassword) return null;
  return { email: row.email, rights: (await accessOf(row, catalogue)).rights };
}

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
  const actor = await ownerActor(actorId, catalogue);
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
  const actor = await ownerActor(actorId, catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const role = await prisma.role.findUnique({ where: { id: String(roleId ?? "") } });
  if (!role) return { ok: false, reason: "missing" };
  if (role.system || isSystemKey(role.key)) return { ok: false, reason: "system" };
  const text = cleanName(input);
  if (!text) return { ok: false, reason: "name" };
  const rights = checkRights(input.rights, actor.rights, catalogue);
  if (!rights) return { ok: false, reason: "rights" };
  if (await prisma.role.findFirst({ where: { name: text.name, NOT: { id: role.id } } })) return { ok: false, reason: "name" };
  await prisma.role.update({ where: { id: role.id }, data: { name: text.name, description: text.description, rights: JSON.stringify(rights) } });
  await audit(actor.email, "role.update", `${role.key}:${rights.join(",")}`);
  return { ok: true };
}

/** Recalcule `User.role` d'une personne (le plus haut rôle prédéfini, sinon « none »). */
async function recomputeLevel(tx: Pick<typeof prisma, "userRole" | "user">, userId: string): Promise<Level> {
  const rows = await tx.userRole.findMany({ where: { userId }, include: { role: { select: { key: true, system: true } } } });
  const level = levelFromKeys(rows.filter((r) => r.role.system).map((r) => r.role.key));
  await tx.user.update({ where: { id: userId }, data: { role: level } });
  return level;
}

/**
 * Supprime un rôle personnalisé. En usage : `replacementId` est obligatoire (un autre rôle, jamais `owner`) et chaque personne qui l'avait le reçoit
 * (elle ne se retrouve donc jamais sans rôle). Tout ou rien (une transaction).
 */
export async function deleteRole(actorId: string, roleId: string, replacementId?: string | null): Promise<RoleResult<{ moved: number }>> {
  const catalogue = await currentCatalogue();
  const actor = await ownerActor(actorId, catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const role = await prisma.role.findUnique({ where: { id: String(roleId ?? "") }, include: { users: { select: { userId: true } } } });
  if (!role) return { ok: false, reason: "missing" };
  if (role.system || isSystemKey(role.key)) return { ok: false, reason: "system" };
  const holders = role.users.map((u) => u.userId);
  let replacement: { id: string; key: string; system: boolean } | null = null;
  if (holders.length > 0) {
    if (!replacementId) return { ok: false, reason: "inUse" };
    replacement = await prisma.role.findUnique({ where: { id: String(replacementId) }, select: { id: true, key: true, system: true } });
    if (!replacement || replacement.id === role.id || replacement.key === "owner") return { ok: false, reason: "replacement" };
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
 * Les rôles d'une personne (puces cumulables). Propriétaire seulement ; la cible n'est jamais le propriétaire ; au moins un rôle ; `owner` et tout
 * identifiant inconnu sont refusés ; parmi les rôles prédéfinis (admin, editor), seul le plus haut est gardé (c'est le niveau).
 */
export async function setUserRoles(actorId: string, targetId: string, roleIds: unknown): Promise<RoleResult<{ level: Level }>> {
  const catalogue = await currentCatalogue();
  const actor = await ownerActor(actorId, catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const target = await prisma.user.findUnique({ where: { id: String(targetId ?? "") }, select: { id: true, email: true, role: true } });
  if (!target) return { ok: false, reason: "missing" };
  if (levelOf(target) === "owner" || target.id === String(actorId)) return { ok: false, reason: "owner" };
  if (!Array.isArray(roleIds)) return { ok: false, reason: "role" };
  const ids = [...new Set(roleIds.map((r) => String(r ?? "")))].filter(Boolean);
  if (ids.length === 0) return { ok: false, reason: "empty" };
  if (ids.length > MAX_CUSTOM_ROLES + 2) return { ok: false, reason: "role" };
  await ensureSystemRoles();
  const roles = await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, system: true } });
  if (roles.length !== ids.length || roles.some((r) => r.key === "owner" || (r.system && !isSystemKey(r.key)))) return { ok: false, reason: "role" };
  const level = levelFromKeys(roles.filter((r) => r.system).map((r) => r.key));
  const keep = roles.filter((r) => !r.system || r.key === level);
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: target.id } });
    for (const r of keep) await tx.userRole.create({ data: { userId: target.id, roleId: r.id } });
    await tx.user.update({ where: { id: target.id }, data: { role: level } });
  });
  await audit(actor.email, "user.roles", `${target.email}:${keep.map((r) => r.key).sort().join(",")}`);
  return { ok: true, level };
}

/** Rôle prédéfini d'une personne nouvellement créée (après `prisma.user.create`) : son affectation suit `User.role`. */
export async function assignInitialRole(userId: string): Promise<void> {
  await ensureSystemRoles();
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
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
