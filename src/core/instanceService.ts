import { prisma } from "./db";
import { RESERVED_PATHS } from "./config";
import { isKnownLocale } from "./i18n/locales";
import { getModule } from "./modules/registry";
import { buildContext } from "./modules/context";
import { listInstances, toInstanceView } from "./instances";
import { retireInstance } from "./modules/retired";
import { releaseManaged } from "./managedRedirects";
import { eraseOwnedFiles } from "./services/files";
import { forgetAllChoices } from "./modules/choiceCache";
import { eraseInstanceRows } from "./instanceLifecycle";

// Creation lives in instanceLifecycle.ts (addInstance); these names stay importable from here.
export { createInstance, defaultNames, freeKey, runInstanceCreateHook, type NewInstance } from "./instanceLifecycle";

export const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
const PATH_RE = /^[a-z0-9-]*$/;

/** Renvoie une clé i18n d'erreur, ou null si le chemin public est utilisable. */
export async function validateBasePath(basePath: string, ignoreId?: string): Promise<string | null> {
  if (!PATH_RE.test(basePath)) return "instances.error.path";
  if (basePath && (RESERVED_PATHS.has(basePath) || isKnownLocale(basePath))) return "instances.error.reserved";
  const clash = await prisma.moduleInstance.findUnique({ where: { basePath } });
  if (clash && clash.id !== ignoreId) return "instances.error.pathUsed";
  if (basePath && (await prisma.redirect.findFirst({ where: { OR: [{ path: basePath }, { path: { startsWith: `${basePath}/` } }] } }))) {
    return "instances.error.redirectClash";
  }
  return null;
}

/**
 * Retire une instance. `keepData: true` : ses réglages, contenus et stockage sont RANGÉS (inertes, retrouvables, voir modules/retired.ts) ; le module n'est
 * pas prévenu (rien n'est détruit). `keepData: false` : tout est effacé, et le module est prévenu (`onInstanceDelete`) pour nettoyer ce qu'il a pu créer ailleurs.
 */
export async function removeInstance(id: string, opts: { keepData: boolean }): Promise<boolean> {
  if (!opts.keepData) {
    if (!(await prisma.moduleInstance.findUnique({ where: { id }, select: { id: true } }))) return false;
    await deleteInstance(id);
    return true;
  }
  return (await retireInstance(id, "delete")) !== null;
}

export async function deleteInstance(id: string): Promise<void> {
  try { await deleteInstanceRow(id); } finally { forgetAllChoices(); }
}

async function deleteInstanceRow(id: string): Promise<void> {
  const row = await prisma.moduleInstance.findUnique({ where: { id }, include: { translations: true } });
  if (!row) return;
  await releaseManaged(id);   // son adresse courte (managedRedirects.ts) part avec elle
  const mod = await getModule(row.moduleId);
  if (mod?.def.hooks?.onInstanceDelete) {
    try {
      await mod.def.hooks.onInstanceDelete(await buildContext(mod, toInstanceView(row)));
    } catch (error) {
      console.error(`[modules] onInstanceDelete failed for ${row.key}:`, error);
    }
  }
  await eraseInstanceRows([id]);
  // Suppression définitive : les fichiers que l'instance avait revendiqués (ctx.api.files) partent aussi (ils n'ont plus d'autre propriétaire).
  await eraseOwnedFiles({ instanceId: id }, "system");
  // Les réglages de l'accueil qui pointaient sur cette instance sont nettoyés à la lecture (voir getHomeSections).
}

export async function instanceCount(moduleId: string): Promise<number> {
  return (await listInstances()).filter((i) => i.moduleId === moduleId).length;
}
