import { prisma } from "../db";
import { sessionIsCurrent } from "./sessions";
import { getSetting } from "../settings";
import { levelOfRow, parseStoredRights, RANK as LEVEL_RANK, rightsCatalogue, systemRights, type Level, type ModuleRightsSource, type RightInfo } from "./rights";
import { ACCOUNT_ENROLL_HREF, CHOOSE_PASSWORD_HREF, DENIED_HREF, LOGIN_HREF, NO_ACCESS_HREF } from "@/core/adminLinks";

export type { Level } from "./rights";
/**
 * Les trois paliers que les pages exigent (`adminCtx("editor" | "admin" | "owner")`). Le coordinateur technique (rang 3) passe « admin » (rang 2) et ne passe PAS « owner » (rang 4) :
 * ce qui était réservé au propriétaire pour une opération technique s'exige désormais par DROIT (`adminCtx({ right })`, `can`), voir rights.ts.
 */
export type Role = "owner" | "admin" | "editor";
export const RANK: Record<Role, number> = { editor: 1, admin: 2, owner: 4 };

/**
 * `level` : le niveau historique (colonne `User.role`, recalculée par le cœur : le plus haut rôle prédéfini de la personne, sinon « none »).
 * `roles` : les clés de ses rôles (prédéfini compris). `rights` : l'union de leurs droits (voir rights.ts).
 * `needsTwoFactor` : le propriétaire exige la double vérification de tous et ce compte ne l'a pas encore activée.
 * `mustChangePassword` : le propriétaire a fixé un mot de passe temporaire à cette personne ; tant qu'elle n'a pas choisi le sien, elle n'accède à rien d'autre.
 */
export type AdminUser = {
  id: string; email: string; name: string; level: Level; roles: string[]; rights: ReadonlySet<string>;
  locale: string | null; advanced: boolean; totp: boolean; passkeys: number; twoFactor: boolean; needsTwoFactor: boolean; mustChangePassword: boolean;
};

/** Le niveau lu sur une ligne de la base (utilisateur, ou ligne d'une sauvegarde) : seul endroit du cœur qui lit les colonnes `role` et `coordinator`. Valeur inconnue = « none ». */
export function levelOf(row: { role?: unknown; coordinator?: unknown } | null | undefined): Level {
  return levelOfRow(row);
}

/** Les droits déclarés par les modules installés (lus à chaque requête, comme l'utilisateur : un module retiré ne laisse aucun droit). */
async function installedRightsSources(): Promise<ModuleRightsSource[]> {
  try {
    const { getInstalledModules } = await import("../modules/registry");
    return (await getInstalledModules()).map((m) => ({ moduleId: m.manifest.id, name: m.manifest.name, rights: m.manifest.rights ?? [] }));
  } catch {
    return []; // registre illisible : aucun droit de module (refus par défaut), le cœur reste utilisable
  }
}

export async function currentCatalogue(): Promise<RightInfo[]> {
  return rightsCatalogue(await installedRightsSources());
}

/**
 * Rôles et droits d'une ligne `User`, relus en base. Le niveau prédéfini vient TOUJOURS de `User.role` (même après un passage par un ancien cœur qui l'aurait changé) ;
 * les affectations `UserRole` n'ajoutent que les rôles personnalisés (une affectation prédéfinie qui ne correspond plus à `User.role` est ignorée).
 */
export async function accessOf(user: { id: string; role: string; coordinator?: boolean }, catalogue?: RightInfo[], db: Pick<typeof prisma, "userRole"> = prisma): Promise<{ level: Level; roles: string[]; rights: Set<string> }> {
  const level = levelOf(user);
  const cat = catalogue ?? (await currentCatalogue());
  const rights = systemRights(level, cat);
  const roles: string[] = level === "none" ? [] : [level];
  const custom = await db.userRole.findMany({ where: { userId: user.id, role: { system: false } }, include: { role: { select: { key: true, rights: true } } }, orderBy: { roleId: "asc" } });
  for (const ur of custom) {
    roles.push(ur.role.key);
    for (const r of parseStoredRights(ur.role.rights, cat)) rights.add(r);
  }
  return { level, roles, rights };
}

/** The AdminUser of a `User` row (rights read from the database, two-factor and temporary-password state included). No session rule here. */
async function adminUserOfRow(user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>): Promise<AdminUser> {
  const totp = !!user.totpEnabledAt;
  const passkeys = await prisma.passkey.count({ where: { userId: user.id } });
  const twoFactor = totp || passkeys > 0; // une clé d'accès vaut les deux facteurs à elle seule
  const required = (await getSetting<boolean>("security.require2fa")) === true;
  const access = await accessOf(user);
  return { id: user.id, email: user.email, name: user.name, level: access.level, roles: access.roles, rights: access.rights, locale: user.locale, advanced: user.advanced, totp, passkeys, twoFactor, needsTwoFactor: required && !twoFactor, mustChangePassword: user.mustChangePassword };
}

/** Le compte d'une session (relu en base À CHAQUE REQUÊTE : un compte supprimé, dont les sessions ont été coupées, ou dont un droit a été retiré, le perd immédiatement). Le jeton de session ne décide de rien. Aucune règle de page ici : voir `accessGate`. */
export async function loadAdminUser(id: string | undefined, tokenVersion: unknown): Promise<AdminUser | null> {
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  // A suspended person has no session at all, whatever their token says (the suspension also raises the session number: two locks).
  if (!user || user.suspendedAt) return null;
  // Session coupée (déconnexion de tous les appareils, mot de passe changé ou réinitialisé…) : le jeton d'avant ne vaut plus rien.
  if (!sessionIsCurrent(tokenVersion, user.sessionVersion)) return null;
  return adminUserOfRow(user);
}

/** (0.46.0) The account of a user by id, with no session: for what acts FOR a user without a session (a personal AI). Null when the user does not exist. */
export async function loadAdminUserById(id: string): Promise<{ user: AdminUser; personalAi: string } | null> {
  const row = await prisma.user.findUnique({ where: { id: String(id ?? "") } });
  return row && !row.suspendedAt ? { user: await adminUserOfRow(row), personalAi: row.personalAi } : null;
}

/**
 * Le palier qui vaut pour les pages : le niveau, sauf pour une personne sans rôle prédéfini (« none ») qui a le droit `core:entries.edit` :
 * elle travaille alors comme un éditeur (contenus, redirections, éditeur d'entrée), ce qui garde valables les `adminCtx("editor")` existants.
 */
export function effectiveLevel(user: AdminUser): Level {
  const level = LEVEL_RANK[user.level] === undefined ? "none" : user.level;
  if (level !== "none") return level;
  return user.rights?.has("core:entries.edit") ? "editor" : "none";
}

export function hasRole(user: AdminUser | null, min: Role): user is AdminUser {
  return !!user && (LEVEL_RANK[effectiveLevel(user)] ?? 0) >= RANK[min];
}

/** La personne peut-elle entrer dans l'administration (au moins un palier, ou au moins un droit) ? Sinon elle ne voit que « aucun accès ». */
export function isMember(user: AdminUser | null): boolean {
  if (!user) return false;
  return hasRole(user, "editor") || ((user as AdminUser).rights?.size ?? 0) > 0;
}

/** Un niveau qui administre la technique du site (propriétaire ou coordinateur) : pour les écrans, jamais pour décider d'un droit (utiliser `can`). */
export function isTechnical(user: AdminUser | null): user is AdminUser {
  return !!user && (user.level === "owner" || user.level === "coordinator");
}

export function isOwner(user: AdminUser | null): user is AdminUser {
  return !!user && user.level === "owner";
}

/** Possède le droit (sans regarder l'état de la session). Le propriétaire a tout. */
function holds(user: AdminUser, right: string): boolean {
  return user.level === "owner" || !!user.rights?.has(right);
}

/**
 * La personne a-t-elle ce droit (« core:<id> » ou « <module>:<id> ») ? Refus par défaut : pas de compte, mot de passe temporaire à remplacer,
 * double vérification exigée et pas encore activée → false, quel que soit le rôle.
 */
export function can(user: AdminUser | null, right: string): boolean {
  if (!user || user.mustChangePassword || user.needsTwoFactor) return false;
  return typeof right === "string" && right.length > 0 && holds(user, right);
}

/** Le palier pour l'éditeur d'entrée (`EntryPanelView.role`) : jamais « none » (une personne sans palier qui a `core:entries.edit` vaut « editor »). */
export function panelRole(user: AdminUser): Role {
  const l = effectiveLevel(user);
  // Les modules ne connaissent que owner|admin|editor : le coordinateur y est un administrateur (le propriétaire reste seul « owner »).
  return l === "none" ? "editor" : l === "coordinator" ? "admin" : l;
}

/** Ce qu'une page exige : un palier, n'importe quel accès (« member » : menu, tableau de bord, Mon compte), ou un droit précis. */
export type Need = Role | "member" | { right: string };

export type Gate = "ok" | "login" | "password" | "denied" | "enroll";
/** Où renvoyer chaque refus. */
export const GATE_PATH: Record<Exclude<Gate, "ok">, string> = { login: LOGIN_HREF, password: CHOOSE_PASSWORD_HREF, denied: DENIED_HREF, enroll: ACCOUNT_ENROLL_HREF };
/** Une personne connectée sans AUCUN accès (aucun rôle utile) : renvoyée ici, hors du menu d'admin (sinon « /admin?denied=1 » la renverrait en boucle). */
export const NO_ACCESS_PATH = NO_ACCESS_HREF;

function satisfies(user: AdminUser, need: Need): boolean {
  if (need === "member") return isMember(user);
  if (typeof need === "string") return hasRole(user, need);
  return isMember(user) && typeof need?.right === "string" && holds(user, need.right);
}

/**
 * La seule règle d'accès de l'admin (pages, actions serveur, routes d'API passent toutes par elle). Ordre : connecté → mot de passe temporaire à remplacer
 * (avant tout le reste : une session « forcée » n'a accès à RIEN d'autre, pas même à savoir si elle aurait le droit) → rôle ou droit → double vérification exigée.
 * `allowForced` : seulement la page « Choisissez votre mot de passe » et ses actions. `allowUnenrolled` : seulement « Mon compte » et ses actions.
 */
export function accessGate(user: AdminUser | null, need: Need, opts: { allowUnenrolled?: boolean; allowForced?: boolean } = {}): Gate {
  if (!user) return "login";
  if (user.mustChangePassword && !opts.allowForced) return "password";
  if (!satisfies(user, need)) return "denied";
  if (user.needsTwoFactor && !opts.allowUnenrolled) return "enroll";
  return "ok";
}

/** Où envoyer un refus « denied » : le tableau de bord avec un message, ou la page « aucun accès » pour qui n'a accès à rien. */
export function deniedPath(user: AdminUser | null): string {
  return isMember(user) ? GATE_PATH.denied : NO_ACCESS_PATH;
}

/* ── Refus répétés : au plus une ligne d'audit par personne et par droit toutes les 10 minutes (mémoire bornée, entrées expirées purgées). ── */
const DENIED_EVERY = 10 * 60_000;
const DENIED_MAX = 1000;
const deniedSeen = ((globalThis as unknown as { curiosaDeniedSeen?: Map<string, number> }).curiosaDeniedSeen ??= new Map<string, number>());

/** Vrai si ce refus doit être écrit au journal (pas déjà noté il y a moins de 10 minutes). */
export function shouldAuditDenied(userId: string, what: string, now = Date.now()): boolean {
  const key = `${userId}|${what}`;
  const last = deniedSeen.get(key);
  if (last !== undefined && now - last < DENIED_EVERY) return false;
  if (deniedSeen.size >= DENIED_MAX) {
    for (const [k, t] of deniedSeen) if (now - t >= DENIED_EVERY) deniedSeen.delete(k);
    if (deniedSeen.size >= DENIED_MAX) { const first = deniedSeen.keys().next().value; if (first !== undefined) deniedSeen.delete(first); }
  }
  deniedSeen.set(key, now);
  return true;
}

/* ── Which page was refused (rule R35, admin redesign C2a): kept in memory for the next dashboard view of THAT person, so that the notice can name the missing access. ──
 * Nothing about it travels in the address (a crafted `?denied=` can never make the notice say anything), and it is never read for another person. One entry per person,
 * forgotten after 30 seconds or at the first read; background renders (link prefetch) never write it, see permissions.ts; the memory is bounded like the audit one above. */
const DENIED_NEED_TTL = 30_000;
const deniedNeed = ((globalThis as unknown as { curiosaDeniedNeed?: Map<string, { need: Need; at: number }> }).curiosaDeniedNeed ??= new Map<string, { need: Need; at: number }>());

/** Remembers the need of the page this person was just refused (the last one wins). */
export function rememberDenied(userId: string, need: Need, now = Date.now()): void {
  if (deniedNeed.size >= DENIED_MAX) {
    for (const [k, v] of deniedNeed) if (now - v.at >= DENIED_NEED_TTL) deniedNeed.delete(k);
    if (deniedNeed.size >= DENIED_MAX) { const first = deniedNeed.keys().next().value; if (first !== undefined) deniedNeed.delete(first); }
  }
  deniedNeed.set(userId, { need, at: now });
}

/** The need of the last refusal of this person (and forgets it), or null when none is recent. */
export function takeDenied(userId: string, now = Date.now()): Need | null {
  const seen = deniedNeed.get(userId);
  deniedNeed.delete(userId);
  return seen && now - seen.at < DENIED_NEED_TTL ? seen.need : null;
}

export function needLabel(need: Need): string {
  return typeof need === "string" ? need : `right:${need.right}`;
}
