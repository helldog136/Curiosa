import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cache } from "react";
import type { Module } from "@prisma/client";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { parseManifest, type ParsedManifest } from "./manifest";
import { listInstances, type InstanceView } from "../instances";
import { getSetting } from "../settings";
import type { ModuleDefinition, SectionDecl } from "./types";
import { forgetLoadFailures, reportLoadFailure } from "./loadLog";
import { invalidatePermissionsPolicy } from "../permissionsPolicy";
import { pageIsOn, pageSettingStorageKey } from "./publicPage";
import { snapshotModule } from "./snapshot";
import { cleanReason, describeShape, shapeProblems } from "./loadCheck";

export type LoadedModule = {
  row: Module;
  manifest: ParsedManifest;
  def: ModuleDefinition;
  locales: Record<string, Record<string, string>>;
};

// `import()` indirect : empêche le bundler de tenter de résoudre un module
// qui n'existe qu'à l'exécution (installé depuis un dépôt git).
const runtimeImport = new Function("specifier", "return import(specifier)") as (s: string) => Promise<unknown>;

const globalCache = globalThis as unknown as {
  curiosaModuleCache?: Map<string, LoadedModule>;
};
const loadedCache = (globalCache.curiosaModuleCache ??= new Map());

/**
 * Compteur de rechargement par module : Node garde en mémoire tout `import()` déjà fait pour une même adresse. Quand le code d'un module change SANS
 * changer de numéro de version ni de commit (réinstallation, voir reinstall.ts), on ajoute ce compteur à l'adresse importée pour que le nouveau code serve tout de suite.
 */
const globalStamps = globalThis as unknown as { curiosaImportStamps?: Map<string, number> };
const importStamps = (globalStamps.curiosaImportStamps ??= new Map());
export function bumpImportStamp(id: string): number {
  const next = (importStamps.get(id) ?? 0) + 1;
  importStamps.set(id, next);
  return next;
}
/** Clé de version de l'import du fichier principal (adresse `?v=`), compteur de rechargement compris. */
export function importVersionKey(id: string, row: { commit?: string | null; version: string }): string {
  const stamp = importStamps.get(id);
  return `${row.commit ?? row.version}${stamp ? `.r${stamp}` : ""}`;
}

export function moduleDir(id: string): string {
  return path.join(MODULES_DIR, id);
}

export function readGitManifest(id: string): ParsedManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(moduleDir(id), "module.json"), "utf8"));
    const parsed = parseManifest(raw);
    return parsed.ok ? parsed.manifest : null;
  } catch {
    return null;
  }
}

function readLocales(dir: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const localesDir = path.join(dir, "locales");
  if (!fs.existsSync(localesDir)) return out;
  for (const file of fs.readdirSync(localesDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      out[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
    } catch {
      // un fichier de langue cassé ne doit pas empêcher le module de charger
    }
  }
  return out;
}

/** Charge le code d'un module depuis une COPIE NEUVE de son dossier (voir snapshot.ts) : tous ses fichiers, voisins compris, ont des adresses que Node n'a jamais vues. Lève en cas d'échec. */
async function importModule(row: Module): Promise<LoadedModule> {
  const manifest = readGitManifest(row.id);
  if (!manifest) throw new Error("invalid or missing module.json");
  let def: ModuleDefinition = {};
  if (manifest.main) {
    const file = path.join(snapshotModule(row.id, moduleDir(row.id)), manifest.main);
    const mod = (await runtimeImport(`${pathToFileURL(file).href}?v=${importVersionKey(row.id, row)}`)) as {
      default?: ModuleDefinition;
    };
    def = mod.default ?? {};
  }
  return { row, manifest, def, locales: readLocales(moduleDir(row.id)) };
}

const cacheKeyOf = (row: Pick<Module, "id" | "version" | "commit">) => `${row.id}@${row.version}@${row.commit ?? ""}`;

export async function loadModule(row: Module): Promise<LoadedModule | null> {
  const cacheKey = cacheKeyOf(row);
  const hit = loadedCache.get(cacheKey);
  if (hit) return { ...hit, row };

  try {
    const loaded = await importModule(row);
    loadedCache.set(cacheKey, loaded);
    forgetLoadFailures(row.id);
    return loaded;
  } catch (error) {
    reportLoadFailure(row.id, error);
    return null;
  }
}

/**
 * CONTRÔLE DE CHARGEMENT dans le processus du site (voir loadCheck.ts) : charge CETTE version depuis une copie neuve, même si une autre copie est en mémoire, et vérifie la forme de ce
 * qu'elle exporte. À appeler APRÈS avoir posé les fichiers et AVANT de basculer la ligne en base. Réussite : le module chargé est gardé en mémoire sous la clé de cette version
 * (voir `forgetModule` et son argument `keep`). Échec : rien n'est gardé, la raison (courte, sans chemin) est renvoyée. Ne lève jamais.
 */
export async function verifyModuleLoad(row: Pick<Module, "id" | "version" | "commit">): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = cacheKeyOf(row);
  loadedCache.delete(key);
  try {
    const loaded = await importModule(row as Module);
    if (loaded.manifest.main) {
      const problems = shapeProblems(describeShape(loaded.def));
      if (problems.length) return { ok: false, reason: problems.slice(0, 3).join("; ") };
    }
    loadedCache.set(key, loaded);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: cleanReason(error) };
  }
}

/** Oublie le module chargé. `keep` : le module qu'on vient de vérifier et de basculer, à garder en mémoire. */
export function forgetModule(id: string, keep?: Pick<Module, "id" | "version" | "commit">): void {
  const kept = keep ? cacheKeyOf(keep) : null;
  for (const key of loadedCache.keys()) if (key.startsWith(`${id}@`) && key !== kept) loadedCache.delete(key);
  invalidatePermissionsPolicy(); // installé, mis à jour, réinstallé ou désinstallé : l'en-tête Permissions-Policy est recalculé (core/permissionsPolicy.ts)
}

export async function listModuleRows(): Promise<Module[]> {
  return prisma.module.findMany({ orderBy: { id: "asc" } });
}

/** Modules installés et chargeables (installé = actif : il n'y a plus d'état intermédiaire). Un module cassé est ignoré, jamais fatal pour le site. */
export const getInstalledModules = cache(async (): Promise<LoadedModule[]> => {
  const rows = await listModuleRows();
  const loaded = await Promise.all(rows.map(loadModule));
  return loaded.filter((m): m is LoadedModule => m !== null);
});

export async function getModule(id: string): Promise<LoadedModule | null> {
  const row = await prisma.module.findUnique({ where: { id } });
  return row ? loadModule(row) : null;
}

/** `pageOn` : faux si le module a un `pageSetting` éteint (absent = allumé). Ne lire que par `hasPublicPage` (publicPage.ts). */
export type ActiveInstance = { instance: InstanceView; mod: LoadedModule; pageOn?: boolean };

/** Instances dont le module est installé et chargeable : ce que le site exécute réellement. */
export const getActiveInstances = cache(async (): Promise<ActiveInstance[]> => {
  const [mods, instances] = await Promise.all([getInstalledModules(), listInstances()]);
  const all = instances.flatMap((instance) => {
    const mod = mods.find((m) => m.manifest.id === instance.moduleId);
    return mod ? [{ instance, mod }] : [];
  });
  // Une instance dont la migration de données a échoué (ou dont les données sont plus récentes que le code du module) ne tourne pas.
  const sane = await Promise.all(all.map(async (a): Promise<ActiveInstance | null> => {
    if ((await getSetting<{ status?: string }>(`instance.${a.instance.id}.__dataStatus`))?.status) return null;
    const key = a.mod.manifest.pageSetting;
    return key ? { ...a, pageOn: pageIsOn(a.mod.manifest, await getSetting(pageSettingStorageKey(a.instance.id, key))) } : a;
  }));
  return sane.filter((a): a is ActiveInstance => a !== null);
});

const LATEST: SectionDecl = {
  id: "latest",
  label: { en: "Latest entries", fr: "Dernières entrées" },
  options: [{ key: "count", type: "number", label: { en: "How many", fr: "Combien" }, default: 3 }],
};

const RANDOM: SectionDecl = {
  id: "random",
  label: { en: "A random entry", fr: "Une entrée au hasard" },
  options: [{ key: "count", type: "number", label: { en: "How many", fr: "Combien" }, default: 1 }],
  size: "small",
};

/**
 * Sections qu'un module propose à l'accueil. Les modules à contenu ont toujours "latest" ; ceux dont les
 * entrées portent un code (codes promo…) ont aussi "random" (un code au hasard).
 */
export function sectionsOf(manifest: ParsedManifest): SectionDecl[] {
  const declared = manifest.sections as SectionDecl[];
  // Pas de page publique (ex. « Blocs de page ») : pas de section « dernières entrées » vers une page qui n'existe pas.
  if (!manifest.content || manifest.page === false) return declared;
  return [
    ...(declared.some((s) => s.id === "latest") ? [] : [LATEST]),
    ...(manifest.content.features.includes("code") && !declared.some((s) => s.id === "random") ? [RANDOM] : []),
    ...declared,
  ];
}

/** Oublie les modules chargés et les migrations de mise à jour (après une restauration, par exemple). */
export function resetModuleRegistry(): void {
  loadedCache.clear();
  invalidatePermissionsPolicy();
}
