import { prisma } from "@/core/db";
import type { ParsedManifest } from "./manifest";
import type { ModuleContext } from "./types";

/**
 * RÉGLAGES HÉRITÉS (0.2.0, contrat 10) — `legacySettings` du manifeste : des réglages qu'une version précédente du module affichait et qu'il reprend
 * lui-même (vers un autre module, un service…). Le cœur :
 *   - ne les affiche JAMAIS (ni en mode simple, ni en mode avancé : ils ne sont pas dans `settings`, le formulaire ne les connaît pas) ;
 *   - les donne au module de l'instance, et à lui seul, par `ctx.legacy.get` (en mémoire : jamais de journal, d'audit, de réponse ou de message avec la valeur) ;
 *   - les efface sur `ctx.legacy.clear`, pour une clé DÉCLARÉE seulement. C'est le module qui décide quand sa reprise est confirmée (contrat 11 :
 *     « effacer après `ready` ») ; à la différence de `clearSetting` (seeding.ts), aucune graine n'est exigée. L'audit dit quelle clé, jamais la valeur ;
 *   - compte les valeurs encore présentes dans le rapport d'entretien (legacyReport.ts), sans jamais les lire au-delà de « vide ou non ».
 */
export class LegacySettingError extends Error {
  readonly code = "undeclared";
  constructor(moduleId: string, key: string) {
    super(`"${String(key).slice(0, 60)}" is not declared in legacySettings of "${moduleId}"`);
    this.name = "LegacySettingError";
  }
}

const settingKey = (instanceId: string, key: string) => `instance.${instanceId}.${key}`;

/** Clés héritées déclarées par un manifeste. */
export const legacyKeys = (manifest: Pick<ParsedManifest, "legacySettings">): string[] => (manifest.legacySettings ?? []).map((l) => l.key);

/** Une valeur stockée (JSON) est-elle vide ? Vide = rien à reprendre : "", espaces, null, ou JSON illisible. */
export function isEmptyStored(raw: string): boolean {
  try {
    const v = JSON.parse(raw) as unknown;
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  } catch {
    return true;
  }
}

/** Lit une valeur stockée : la valeur sans langue d'abord, sinon la première non vide (ordre des langues stable). Null si rien d'utilisable. */
export async function readLegacyValue(instanceId: string, key: string): Promise<string | number | boolean | null> {
  const rows = await prisma.setting.findMany({ where: { key: settingKey(instanceId, key) }, orderBy: { locale: "asc" } });
  for (const row of rows) {
    if (isEmptyStored(row.value)) continue;
    let v: unknown;
    try { v = JSON.parse(row.value); } catch { continue; }
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "boolean") return v;
  }
  return null;
}

export function makeLegacy(manifest: Pick<ParsedManifest, "id" | "legacySettings">, instanceId: string): NonNullable<ModuleContext["legacy"]> {
  const declared = new Set(legacyKeys(manifest));
  const check = (key: string) => { if (typeof key !== "string" || !declared.has(key)) throw new LegacySettingError(manifest.id, key); };
  return {
    keys: () => [...declared],
    async get(key) {
      check(key);
      return readLegacyValue(instanceId, key);
    },
    async clear(key) {
      check(key);
      const { count } = await prisma.setting.deleteMany({ where: { key: settingKey(instanceId, key) } });
      if (count) await prisma.auditLog.create({ data: { actor: "system", action: "module.legacy.clear", target: `${manifest.id}: ${key}` } }).catch(() => {});   // la clé, jamais la valeur
    },
  };
}
