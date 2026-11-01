import { prisma } from "../db";
import { getSetting, setSetting } from "../settings";
import { listModuleRows, getModule } from "./registry";
import { offersOf, requiresOf } from "./dependencies";

/**
 * MODULES « INSTALLÉS AUTOMATIQUEMENT » — la marque qu'un module (ou une instance) a été apporté par la cascade des dépendances plutôt que voulu
 * par l'administrateur. Un seul réglage du cœur (`modules.auto`, sans migration de base), sauvegardé avec les autres réglages :
 *   { "contacts": { "for": ["partnerships"], "module": true, "instances": ["<id d'instance>"], "at": 1767225600000 } }
 * Sert à DIRE « installé automatiquement pour Partenariats » et à PROPOSER un nettoyage quand plus personne n'en dépend. Rien n'est jamais supprimé
 * d'office : le nettoyage est une proposition que l'administrateur confirme, avec un avertissement si le module porte des données.
 */
export type AutoEntry = { for: string[]; /** Le module lui-même a été installé par la cascade (sinon seulement une instance). */ module: boolean; instances: string[]; at: number };
export type AutoMap = Record<string, AutoEntry>;
const KEY = "modules.auto";

export async function readAuto(): Promise<AutoMap> {
  const raw = await getSetting<AutoMap>(KEY);
  const out: AutoMap = {};
  if (raw && typeof raw === "object") {
    for (const [id, e] of Object.entries(raw)) {
      if (!e || typeof e !== "object") continue;
      out[id] = { for: Array.isArray(e.for) ? e.for.filter((x): x is string => typeof x === "string") : [], module: e.module === true, instances: Array.isArray(e.instances) ? e.instances.filter((x): x is string => typeof x === "string") : [], at: Number(e.at) || 0 };
    }
  }
  return out;
}
const write = (map: AutoMap) => setSetting(KEY, map);

/** Note qu'un module a été apporté pour `forModule` ; plusieurs consommateurs s'additionnent. Le drapeau `module` ne retombe jamais à faux. */
export async function markAuto(moduleId: string, forModule: string, what: { module?: boolean; instances?: string[] }, now = Date.now()): Promise<void> {
  const map = await readAuto();
  const prev = map[moduleId];
  map[moduleId] = {
    for: [...new Set([...(prev?.for ?? []), forModule])],
    module: (prev?.module ?? false) || what.module === true,
    instances: [...new Set([...(prev?.instances ?? []), ...(what.instances ?? [])])],
    at: prev?.at ?? now,
  };
  await write(map);
}

/** L'administrateur garde ce module (ou il est désinstallé) : la marque disparaît. */
export async function forgetAuto(moduleId: string): Promise<void> {
  const map = await readAuto();
  if (!(moduleId in map)) return;
  delete map[moduleId];
  await write(map);
}

/** Le module porte-t-il du travail de l'administrateur : données saisies (entrées, enregistrements) ou réglages modifiés d'une de ses instances ? */
export async function hasUserData(moduleId: string): Promise<boolean> {
  const instances = await prisma.moduleInstance.findMany({ where: { moduleId }, select: { id: true } });
  if (!instances.length) return false;
  const ids = instances.map((i) => i.id);
  if ((await prisma.moduleRecord.count({ where: { instanceId: { in: ids } } })) > 0) return true;
  if ((await prisma.entry.count({ where: { instanceId: { in: ids } } })) > 0) return true;
  const settings = await prisma.setting.findMany({ where: { OR: ids.map((i) => ({ key: { startsWith: `instance.${i}.` } })) }, select: { key: true } });
  return settings.some((s) => !s.key.split(".").slice(2).join(".").startsWith("__"));
}

export type CleanupSuggestion = { id: string; /** Modules pour lesquels il avait été installé. */ for: string[]; /** Il porte des données ou des réglages : le supprimer les perdrait. */ hasData: boolean };

/** Qui, parmi les modules INSTALLÉS (actifs ou non : un consommateur éteint peut être rallumé), exige un service que ce module offre ? */
export async function usersOf(moduleId: string): Promise<string[]> {
  const mine = await getModule(moduleId);
  if (!mine) return [];
  const offered = new Set(offersOf(mine.manifest));
  const out: string[] = [];
  for (const row of await listModuleRows()) {
    if (row.id === moduleId) continue;
    const m = await getModule(row.id);
    if (m && requiresOf(m.manifest).some((s) => offered.has(s))) out.push(row.id);
  }
  return out;
}

/** Modules installés automatiquement dont plus aucun module installé ne dépend : à PROPOSER au nettoyage (jamais supprimés d'office). */
export async function cleanupSuggestions(): Promise<CleanupSuggestion[]> {
  const out: CleanupSuggestion[] = [];
  const installed = new Set((await listModuleRows()).map((r) => r.id));
  for (const [id, e] of Object.entries(await readAuto())) {
    if (!e.module || !installed.has(id)) continue;
    if ((await usersOf(id)).length) continue;
    out.push({ id, for: e.for.filter((f) => installed.has(f)), hasData: await hasUserData(id) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
