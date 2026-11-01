/**
 * Versions d'un skin : `x.y.z` (sans « v »). Pure. Les comparaisons s'appuient sur `updates/versions.ts` (déjà utilisé par les modules).
 */
import { classify, compareVersions, TAG_RE, type UpdateLevel } from "../updates/versions";

export { classify, compareVersions, TAG_RE };
export type { UpdateLevel };

export const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const parts = (v: string): [number, number, number] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.+-]*)?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** Le cœur `core` satisfait-il `minCore` ? Sans exigence ou si une version est illisible : oui (jamais de blocage sur un doute). Les pré-versions comptent comme leur numéro. */
export function coreSatisfies(minCore: string | undefined, core: string): boolean {
  const need = minCore ? parts(minCore) : null;
  const have = parts(core);
  if (!need || !have) return true;
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i]! > need[i]!;
  return true;
}
