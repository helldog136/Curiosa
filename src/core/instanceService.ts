import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { RESERVED_PATHS } from "./config";
import { isKnownLocale } from "./i18n/locales";
import { getModule } from "./modules/registry";
import { hasPage, type ParsedManifest } from "./modules/manifest";
import { buildContext } from "./modules/context";
import { listInstances, toInstanceView } from "./instances";
import { localized } from "./modules/types";

type Db = PrismaClient | Prisma.TransactionClient;

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

/** Clé libre dérivée d'une base : blog, blog-2, blog-3… */
export async function freeKey(db: Db, base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    if (!(await db.moduleInstance.findUnique({ where: { key } }))) return key;
  }
  return `${base}-${Date.now()}`;
}

export type NewInstance = {
  manifest: ParsedManifest;
  key?: string;
  /** undefined = valeur par défaut du module ; null = pas de page. */
  basePath?: string | null;
  names: Record<string, string>;
  descriptions?: Record<string, string>;
};

/** Crée une instance d'un module avec les réglages de contenu par défaut de celui-ci. */
export async function createInstance(db: Db, input: NewInstance) {
  const { manifest } = input;
  const content = manifest.content;
  const count = await db.moduleInstance.count();
  const key = input.key ?? (await freeKey(db, manifest.id));
  const mounted = hasPage(manifest);
  let basePath: string | null = null;
  if (mounted) {
    basePath = input.basePath === undefined ? (content?.basePath ?? key) : input.basePath;
    if (basePath !== null && (await db.moduleInstance.findUnique({ where: { basePath } }))) basePath = key; // repli : chemin déjà pris
  }
  return db.moduleInstance.create({
    data: {
      moduleId: manifest.id,
      key,
      basePath,
      showInNav: content?.showInNav ?? mounted,
      navOrder: count,
      display: content?.display ?? "cards",
      clickAction: content?.clickAction ?? "detail",
      features: JSON.stringify(content?.features ?? []),
      fieldSchema: JSON.stringify(content?.fieldSchema ?? []),
      fallbackToDefault: content?.fallbackToDefault ?? true,
      allowGoLinks: content?.allowGoLinks ?? false,
      translations: {
        create: Object.entries(input.names).map(([locale, name]) => ({
          locale,
          name,
          description: input.descriptions?.[locale] ?? "",
        })),
      },
    },
  });
}

/** Nom proposé pour une première instance, dans chaque langue du site. */
export function defaultNames(manifest: ParsedManifest, locales: string[]): Record<string, string> {
  return Object.fromEntries(locales.map((l) => [l, localized(manifest.name, l, "en")]));
}

export async function deleteInstance(id: string): Promise<void> {
  const row = await prisma.moduleInstance.findUnique({ where: { id }, include: { translations: true } });
  if (!row) return;
  const mod = await getModule(row.moduleId);
  if (mod?.def.hooks?.onInstanceDelete) {
    try {
      await mod.def.hooks.onInstanceDelete(await buildContext(mod, toInstanceView(row)));
    } catch (error) {
      console.error(`[modules] onInstanceDelete failed for ${row.key}:`, error);
    }
  }
  await prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${id}.` } } });
  await prisma.moduleRecord.deleteMany({ where: { instanceId: id } });
  await prisma.moduleInstance.delete({ where: { id } });
  // Les réglages de l'accueil qui pointaient sur cette instance sont nettoyés à la lecture (voir getHomeSections).
}

export async function instanceCount(moduleId: string): Promise<number> {
  return (await listInstances()).filter((i) => i.moduleId === moduleId).length;
}
