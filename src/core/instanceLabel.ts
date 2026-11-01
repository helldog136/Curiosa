/**
 * TROIS NOMS pour une instance de module, pour trois publics :
 *
 *   surnom (nickname)     libellé d'ADMIN pour distinguer deux instances du même module (« Actus », « Chaîne 2 »).
 *                         Superflu — donc jamais demandé ni affiché — tant qu'il n'y a qu'une instance.
 *   nom public            traduit par langue, affiché sur le site (menu, titre de page).
 *   identifiant technique dérivé du surnom à la création ; sert aux URL (/overlays/<id>, /m/<id>/…), aux outils MCP
 *                         et aux réglages. Montré en mode avancé seulement.
 *
 * Fonctions pures (sans dépendance) : testées sans base de données.
 */

const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const NICKNAME_MAX = 40;

const slug = (input: string) =>
  input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

/** Identifiant technique proposé : le surnom « Chaîne 2 » donne « chaine-2 » ; sans surnom exploitable, l'identifiant du module. */
export function keyFromNickname(moduleId: string, nickname?: string | null): string {
  const s = slug(nickname ?? "");
  if (KEY_RE.test(s)) return s;
  // Trop court, ou commence par un chiffre ("2024") : on préfixe par le module plutôt que de refuser.
  const prefixed = slug(`${moduleId}-${s}`);
  return KEY_RE.test(prefixed) ? prefixed : slug(moduleId) || "instance";
}

export type NicknameCheck = { ok: true; value: string } | { ok: false; reason: "empty" | "long" | "taken" };

/** Un surnom est unique parmi les instances du MÊME module (sans tenir compte de la casse ni des accents). */
export function checkNickname(input: string, takenByOthers: string[]): NicknameCheck {
  const value = input.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, reason: "empty" };
  if (value.length > NICKNAME_MAX) return { ok: false, reason: "long" };
  const norm = (s: string) => slug(s);
  if (takenByOthers.some((o) => norm(o) === norm(value))) return { ok: false, reason: "taken" };
  return { ok: true, value };
}

/** Un surnom n'a de sens que s'il faut distinguer plusieurs instances. */
export const needsNickname = (siblings: number) => siblings > 1;

/**
 * Libellé d'admin d'une instance : quand elle est seule de son espèce, son nom public (celui que l'admin a pu modifier ; au départ
 * c'est le nom du module, qui sert aussi de repli) ; sinon son surnom (à défaut, son nom public, puis son identifiant).
 */
export function instanceLabel(i: { nickname?: string | null; publicName?: string | null; key: string }, moduleName: string, siblings: number): string {
  if (!needsNickname(siblings)) return i.publicName?.trim() || moduleName;
  return i.nickname?.trim() || i.publicName?.trim() || i.key;
}

/** Surnom proposé pour une nouvelle instance : « Blog 2 », « Blog 3 »… (le premier libre). */
export function suggestNickname(moduleName: string, existing: string[]): string {
  const taken = new Set(existing.map(slug));
  for (let n = 2; n < 100; n++) if (!taken.has(slug(`${moduleName} ${n}`))) return `${moduleName} ${n}`;
  return `${moduleName} ${Date.now()}`;
}
