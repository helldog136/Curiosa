import { readVersion } from "../updates/service";

/**
 * VERSION MINIMALE DU CŒUR. Un module peut déclarer le cœur le plus ancien qui le fait fonctionner :
 *   - manifeste (module.json) : `"minCore": "0.1.10"`
 *   - entrée de l'index du catalogue : `"requires": { "core": "0.1.10" }` (même numéro, lisible SANS télécharger le module)
 * Absent = aucune exigence (tous les modules actuels).
 *
 * COMPARAISON : sur majeure.mineure.correctif seulement, EN IGNORANT l'étiquette de pré-version du cœur : 0.1.10-rc.1 satisfait « 0.1.10 »
 * (le propriétaire teste les release candidates). Les nombres se comparent comme des nombres : 0.1.10 est plus récent que 0.1.9.
 * Ce champ ne sert qu'à REFUSER d'entrer ou de monter de version : un module déjà installé et chargé n'est jamais désactivé à cause de lui.
 */
export const CORE_VERSION_RE = /^\d+\.\d+\.\d+$/;

export type CoreRequirement = { core?: string };

/** « 1.2.3 », « v1.2.3 », « 1.2.3-rc.1 », « 1.2.3+abc » → [1, 2, 3] ; tout autre texte → null. */
export function parseCoreVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === "string" ? /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.+-]*)?$/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Entrée d'index → exigence valide, ou rien (champ absent ou mal formé : ignoré, jamais bloquant). */
export function sanitizeRequires(v: unknown): CoreRequirement | undefined {
  const core = v && typeof v === "object" ? (v as { core?: unknown }).core : undefined;
  return typeof core === "string" && CORE_VERSION_RE.test(core) ? { core } : undefined;
}

/** Exigence portée par un manifeste (`minCore`). */
export const requirementOf = (m: { minCore?: string }): CoreRequirement | undefined => (m.minCore ? { core: m.minCore } : undefined);

/** Le cœur `coreVersion` satisfait-il l'exigence ? Sans exigence, ou si l'une des versions est illisible : oui (on ne bloque jamais sur un doute). */
export function isCompatible(requires: CoreRequirement | null | undefined, coreVersion: string): boolean {
  const need = parseCoreVersion(requires?.core);
  const have = parseCoreVersion(coreVersion);
  if (!need || !have) return true;
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i]! > need[i]!;
  return true;
}

export type Incompat = { /** Clé de traduction du message. */ key: "modules.core.needs"; /** Texte court pour une pastille (« Demande Curiosa X ou plus (vous avez Y) »). */ badgeKey: "modules.core.badge"; params: { version: string; current: string }; /** Version demandée. */ needs: string };

/** Pourquoi le module est refusé (clé + paramètres de traduction), ou null s'il est compatible. */
export function describeIncompat(requires: CoreRequirement | null | undefined, coreVersion: string): Incompat | null {
  if (isCompatible(requires, coreVersion) || !requires?.core) return null;
  return { key: "modules.core.needs", badgeKey: "modules.core.badge", params: { version: requires.core, current: coreVersion.replace(/^v/, "") }, needs: requires.core };
}

let override: string | null = null;
/** Pour les tests : impose une version de cœur (null = lire package.json). */
export function setCoreVersionForTests(v: string | null): void { override = v; }

/** Version du cœur en cours d'exécution (package.json, comme la page Mises à jour). */
export function getCoreVersion(): string { return override ?? readVersion(); }

/** Raccourci : l'exigence est-elle refusée par CE cœur ? */
export const incompatWithThisCore = (requires: CoreRequirement | null | undefined): Incompat | null => describeIncompat(requires, getCoreVersion());
