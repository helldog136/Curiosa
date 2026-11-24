import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { RESERVED_PATHS } from "./config";
import { isKnownLocale } from "./i18n/locales";
import { getModule } from "./modules/registry";
import { hasPage, type ParsedManifest } from "./modules/manifest";
import { buildContext } from "./modules/context";
import { toInstanceView } from "./instances";
import { localized } from "./modules/types";
import { keyFromNickname } from "./instanceLabel";
import { forgetAllChoices } from "./modules/choiceCache";
import { ensureMenuMigrated, setInstanceInMenu } from "./menuStore";
import { suggestsMenu } from "./modules/menuEligibility";
import { getSiteConfig } from "./settings";
import { dataVersionKey, instanceSettingsWhere, seenFeaturesKey } from "./instanceKeys";

/**
 * INSTANCE LIFECYCLE: the one place where an instance is born and where its rows are erased.
 *
 *   addInstance(manifest, opts)  creates the instance (row, translations, menu decision, book-keeping settings) and returns `afterCommit`, the module's
 *                                `onInstanceCreate` hook. The hook is NOT run here: the caller runs it once the transaction (if it passed one with `tx`) is
 *                                committed, because the module reads and writes its own storage there. Without `tx`, call `await afterCommit()` right away.
 *   eraseInstanceRows(ids)       the three kinds of rows an instance owns: its settings, its stored records, the instance itself (translations and entries
 *                                follow by cascade). Hooks, files and short addresses are the business of `deleteInstance` (instanceService.ts), not of this helper.
 *
 * `createInstance` is the lower-level form (explicit names, no hook) that tests and `addInstance` build on.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const reservedPath = (p: string) => p !== "" && (RESERVED_PATHS.has(p) || isKnownLocale(p));

async function freeBasePath(db: Db, base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!reservedPath(candidate) && !(await db.moduleInstance.findUnique({ where: { basePath: candidate } }))) return candidate;
  }
  return `${base}-${Date.now()}`;
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
  /** Surnom d'admin (obligatoire de fait dès qu'il y a plusieurs instances du module) ; l'identifiant technique en est dérivé. */
  nickname?: string;
  /** undefined = valeur par défaut du module ; null = pas de page. */
  basePath?: string | null;
  names: Record<string, string>;
  descriptions?: Record<string, string>;
  /** "suggested" : à la CRÉATION DU SITE seulement (assistant de départ), une page que son module suggère d'être au menu y entre. Absent = l'instance n'entre jamais au menu toute seule. */
  menu?: "suggested";
};

/** Crée une instance d'un module avec les réglages de contenu par défaut de celui-ci. */
export async function createInstance(db: Db, input: NewInstance) {
  try { return await createInstanceRow(db, input); } finally { forgetAllChoices(); }
}

async function createInstanceRow(db: Db, input: NewInstance) {
  const { manifest } = input;
  const content = manifest.content;
  const count = await db.moduleInstance.count();
  const key = input.key ?? (await freeKey(db, keyFromNickname(manifest.id, input.nickname)));
  const mounted = hasPage(manifest);
  // Le menu du site est figé AVANT d'ajouter l'instance : un module installé après la mise à jour n'entre jamais au menu tout seul (voir menuStore.ts).
  await ensureMenuMigrated(db);
  let basePath: string | null = null;
  if (mounted) {
    basePath = input.basePath === undefined ? (content?.basePath ?? manifest.basePath ?? key) : input.basePath;
    // Repli si le chemin est déjà pris ou réservé (un surnom « Admin » ou « EN » ne doit pas voler /admin ni /en).
    if (basePath !== null && (reservedPath(basePath) || (await db.moduleInstance.findUnique({ where: { basePath } })))) basePath = await freeBasePath(db, `${manifest.id}-${key}`);
  }
  const created = await db.moduleInstance.create({
    data: {
      moduleId: manifest.id,
      key,
      nickname: input.nickname?.trim() || null,
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
  if (input.menu === "suggested" && created.basePath && suggestsMenu(manifest)) await setInstanceInMenu(created.id, true, db);
  const put = (key: string, value: unknown) => {
    const json = JSON.stringify(value);
    return db.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value: json }, update: { value: json } });
  };
  // A new instance has seen every feature its manifest declares (see modules/instanceFeatures.ts).
  await put(seenFeaturesKey(created.id), content?.features ?? []);
  // Une instance neuve naît à la version courante des données de son module : aucune migration à lui appliquer.
  if ((manifest.dataVersion ?? 1) > 1) await put(dataVersionKey(created.id), manifest.dataVersion);
  return created;
}

/** Nom proposé pour une première instance, dans chaque langue du site. */
export function defaultNames(manifest: ParsedManifest, locales: string[], nickname?: string): Record<string, string> {
  // Avec un surnom (2e instance et suivantes), le nom public démarre à sa valeur : « Actus » plutôt qu'un second « Blog ».
  return Object.fromEntries(locales.map((l) => [l, nickname ?? localized(manifest.name, l, "en")]));
}

/**
 * Appelle le crochet `hooks.onInstanceCreate` du module, une fois l'instance créée (et la transaction éventuelle terminée :
 * le module peut alors lire et écrire son stockage). Jamais bloquant : une erreur du module est journalisée, pas propagée.
 */
export async function runInstanceCreateHook(id: string): Promise<void> {
  const row = await prisma.moduleInstance.findUnique({ where: { id }, include: { translations: true } });
  if (!row) return;
  const mod = await getModule(row.moduleId);
  const hook = mod?.def.hooks?.onInstanceCreate;
  if (!mod || !hook) return;
  try {
    await hook(await buildContext(mod, toInstanceView(row)));
  } catch (error) {
    console.error(`[modules] onInstanceCreate failed for ${row.key}:`, error);
  }
}

export type AddInstanceOptions = {
  key?: string;
  nickname?: string;
  /** undefined = valeur par défaut du module ; null = pas de page. */
  basePath?: string | null;
  menu?: "suggested";
  /** Names per language. Default: `defaultNames(manifest, locales, nickname)`. */
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  /** The site languages, when the caller already has them. Default: read from the site settings (never inside `tx`: pass `names` or `locales` there). */
  locales?: string[];
  /** Create inside this transaction. Then run `afterCommit` once it is committed, never before. */
  tx?: Prisma.TransactionClient;
};

export type AddedInstance = {
  instance: Awaited<ReturnType<typeof createInstance>>;
  /** The module's `onInstanceCreate` hook. Never throws (a module error is logged). Run it after the commit. */
  afterCommit: () => Promise<void>;
};

/** Creates an instance of a module with its default settings (see the header of this file). */
export async function addInstance(manifest: ParsedManifest, opts: AddInstanceOptions = {}): Promise<AddedInstance> {
  const { tx, key, nickname, basePath, menu, descriptions } = opts;
  let names = opts.names;
  if (!names) {
    if (tx && !opts.locales) throw new Error("addInstance: inside a transaction, pass `names` or `locales` (the site settings are not read from within it)");
    names = defaultNames(manifest, opts.locales ?? (await getSiteConfig()).locales, nickname || undefined);
  }
  const instance = await createInstance(tx ?? prisma, {
    manifest, names,
    ...(key !== undefined ? { key } : {}),
    ...(nickname !== undefined ? { nickname } : {}),
    ...(basePath !== undefined ? { basePath } : {}),
    ...(menu ? { menu } : {}),
    ...(descriptions ? { descriptions } : {}),
  });
  return { instance, afterCommit: () => runInstanceCreateHook(instance.id) };
}

/**
 * The three operations that erase what an instance owns, in this order: its settings (`instance.<id>.*`), its stored records, then the instances themselves
 * (translations and entries follow by cascade). Lazy Prisma operations: spread them into a `prisma.$transaction([...])`, or use `eraseInstanceRows`.
 */
export function instanceRowErasures(db: Db, ids: string[]) {
  return [
    db.setting.deleteMany({ where: { OR: ids.map((id) => instanceSettingsWhere(id)) } }),
    db.moduleRecord.deleteMany({ where: { instanceId: { in: ids } } }),
    db.moduleInstance.deleteMany({ where: { id: { in: ids } } }),
  ] as const;
}

/** Erases the settings, stored records and rows of these instances (no hook, no files: see `deleteInstance`). Missing ids are not an error. */
export async function eraseInstanceRows(ids: string[], db: Db = prisma): Promise<void> {
  if (!ids.length) return;
  for (const operation of instanceRowErasures(db, ids)) await operation;
}
