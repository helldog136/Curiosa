import { z } from "zod";

/**
 * CLÉ FACULTATIVE `skin` DU module.json (cœur 0.4.0 ; docs/SKINS.md §8). Un module y déclare ses PIÈCES D'APPARENCE stylables par les skins, et les JETONS propres à ces pièces.
 *
 * Principe fondateur (docs/SKINS.md §0) : un skin ne définit que de l'APPARENCE. Cette déclaration ne peut donc décrire QUE des pièces et des jetons de style :
 * jamais un texte à afficher, un élément à ajouter ou à masquer, une variante de contenu. Les types de jetons sont une liste fermée de valeurs de style (couleur,
 * longueur, ombre, nombre, police, durée, casse) ; aucune propriété CSS n'est nommée ici.
 *
 * Ce fichier ne contient que la FORME (zod, sans dépendance lourde : il est lu par le manifeste, donc aussi par le garde de `permissionsPolicy`). Le contrôle des VALEURS
 * (mêmes bornes que l'assainisseur de feuille) est dans `core/skins/moduleSkin.ts`. Un cœur plus ancien ignore la clé : le module reste valable (`minCore` protège sinon).
 */

/** Version du contrat de pièces de module que ce cœur lit. */
export const MODULE_SKIN_SINCE = 1;

/** Types de jetons permis à un module (liste fermée). Identique à `MODULE_TOKEN_TYPES` de `core/skins/tokens.ts` (un test le vérifie). */
export const MODULE_SKIN_TOKEN_TYPES = ["color", "length", "shadow", "number", "font", "duration", "text-transform"] as const;

/** Plafonds : un module reste un petit vocabulaire (docs/SKINS.md §8.2). */
export const MODULE_SKIN_MAX_PARTS = 12;
export const MODULE_SKIN_MAX_TOKENS = 24;
export const MODULE_SKIN_MAX_DEMO_BYTES = 20 * 1024;
/** Un jeton de module a pour nom `--sk-m-<idDuModule>-<reste>` ; le nom entier reste dans la limite d'une variable de skin (`--sk-` + 61 caractères au plus). */
export const MODULE_SKIN_TOKEN_PREFIX = (moduleId: string): string => `--sk-m-${moduleId}-`;
export const MODULE_SKIN_TOKEN_MAX_NAME = 66;
export const MODULE_SKIN_PART_RE = /^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/;
const TOKEN_NAME_RE = /^--sk-m-[a-z][a-z0-9-]{2,60}$/;

/**
 * Texte permis dans une valeur par défaut, en première garde (la vraie validation, par type, est faite par `core/skins/moduleSkin.ts`) : rien qui ouvre une règle,
 * une URL, une fonction de contenu ou un échappement. Une valeur par défaut est une valeur de STYLE.
 */
const FORBIDDEN_IN_DEFAULT = /[;{}<>\\@\u0000-\u001f]|url\s*\(|attr\s*\(|expression|image-set|element\s*\(|paint\s*\(|env\s*\(|!important|\/\*/i;

const text = z.object({ fr: z.string().trim().min(1).max(120), en: z.string().trim().min(1).max(120) });
const longText = z.object({ fr: z.string().trim().min(1).max(300), en: z.string().trim().min(1).max(300) });

export const moduleSkinToken = z.object({
  /** `--sk-m-<idDuModule>-<pièce>-<propriété>` : le préfixe `--sk-m-<module>-` est vérifié avec l'id du module (voir `moduleSkinIssues`). */
  name: z.string().regex(TOKEN_NAME_RE, "a module skin token is named --sk-m-<module>-<part>-<property> (lowercase letters, digits and dashes)").max(MODULE_SKIN_TOKEN_MAX_NAME),
  type: z.enum(MODULE_SKIN_TOKEN_TYPES),
  /** La valeur d'aujourd'hui, ou une référence à un jeton COMMUN (`var(--sk-radius-card)`, `var(--v-surface)`) : jamais une URL, jamais du texte à afficher. */
  default: z.string().trim().min(1).max(300).refine((v) => !FORBIDDEN_IN_DEFAULT.test(v), "a token default is a style value (no url(), attr(), quotes of a rule, braces or escapes)"),
  /** Couleur de TEXTE seulement : le jeton de fond sur lequel ce texte est posé (contrôle de lisibilité automatique, docs/SKINS.md §7.1 paire 11). */
  on: z.string().regex(TOKEN_NAME_RE).optional(),
}).strict();

export const moduleSkinPart = z.object({
  /** `<idDuModule>.<pièce>` : la valeur de `data-skin-part` que le module pose sur son HTML. */
  id: z.string().regex(MODULE_SKIN_PART_RE, "a part id is <module>.<part> (lowercase letters, digits and dashes)"),
  /** Famille commune de la pièce (`card`, `button`, `badge`…) : facultatif, informatif (le kit vérifie qu'elle existe). */
  kind: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/).optional(),
  name: text,
  description: longText,
  tokens: z.array(moduleSkinToken).max(MODULE_SKIN_MAX_TOKENS).default([]),
}).strict();

export const moduleSkinSchema = z.object({
  since: z.literal(MODULE_SKIN_SINCE),
  parts: z.array(moduleSkinPart).min(1).max(MODULE_SKIN_MAX_PARTS),
  /** Fichier HTML d'aperçu de la pièce pour le banc d'essai (≤ 20 Ko, aucun script) ; sans lui le banc génère un gabarit générique. */
  demo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.html$/, "demo is the name of an .html file at the root of the module").optional(),
}).strict();

export type ModuleSkinDecl = z.infer<typeof moduleSkinSchema>;
export type ModuleSkinPartDecl = z.infer<typeof moduleSkinPart>;

/**
 * Règles qui dépendent de l'id du module et des autres parties de la déclaration (appelé par le `superRefine` du manifeste). Renvoie des messages courts, en anglais
 * comme les autres messages du manifeste.
 */
export function moduleSkinIssues(moduleId: string, skin: ModuleSkinDecl): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const add = (path: (string | number)[], message: string) => out.push({ path, message });
  const prefix = MODULE_SKIN_TOKEN_PREFIX(moduleId);
  const partIds = new Set<string>();
  const tokens = new Map<string, { type: string; at: (string | number)[] }>();
  let total = 0;
  for (const [i, part] of skin.parts.entries()) {
    if (!part.id.startsWith(`${moduleId}.`) || part.id.length === moduleId.length + 1) add(["parts", i, "id"], `part "${part.id}" must start with the module id: "${moduleId}.<part>"`);
    if (part.id.split(".").length !== 2) add(["parts", i, "id"], `part "${part.id}" must have exactly one dot (<module>.<part>)`);
    if (partIds.has(part.id)) add(["parts", i, "id"], `duplicate part "${part.id}"`);
    partIds.add(part.id);
    for (const [j, tok] of part.tokens.entries()) {
      total++;
      const at = ["parts", i, "tokens", j];
      if (!tok.name.startsWith(prefix)) add([...at, "name"], `token "${tok.name}" must start with "${prefix}" (--sk-m-<module id>-)`);
      if (tokens.has(tok.name)) add([...at, "name"], `duplicate token "${tok.name}"`);
      tokens.set(tok.name, { type: tok.type, at });
    }
  }
  if (total > MODULE_SKIN_MAX_TOKENS) add(["parts"], `a module declares ${MODULE_SKIN_MAX_TOKENS} skin tokens at most (found ${total})`);
  for (const part of skin.parts) {
    for (const [j, tok] of part.tokens.entries()) {
      if (tok.on === undefined) continue;
      const at = ["parts", skin.parts.indexOf(part), "tokens", j, "on"];
      if (tok.type !== "color") add(at, `"on" is only for a color token (the text color posed on a background color)`);
      else if (tokens.get(tok.on)?.type !== "color") add(at, `"on" must name another color token of this module ("${tok.on}" is not one)`);
      else if (tok.on === tok.name) add(at, `"on" cannot name the token itself`);
    }
  }
  return out;
}
