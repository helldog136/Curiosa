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

export async function loadModule(row: Module): Promise<LoadedModule | null> {
  const cacheKey = `${row.id}@${row.version}@${row.commit ?? ""}`;
  const hit = loadedCache.get(cacheKey);
  if (hit) return { ...hit, row };

  try {
    const manifest = readGitManifest(row.id);
    if (!manifest) throw new Error("invalid or missing module.json");
    let def: ModuleDefinition = {};
    if (manifest.main) {
      const file = path.join(moduleDir(row.id), manifest.main);
      const mod = (await runtimeImport(`${pathToFileURL(file).href}?v=${row.commit ?? row.version}`)) as {
        default?: ModuleDefinition;
      };
      def = mod.default ?? {};
    }
    const loaded: LoadedModule = { row, manifest, def, locales: readLocales(moduleDir(row.id)) };
    loadedCache.set(cacheKey, loaded);
    return loaded;
  } catch (error) {
    console.error(`[modules] cannot load "${row.id}":`, error);
    return null;
  }
}

export function forgetModule(id: string): void {
  for (const key of loadedCache.keys()) if (key.startsWith(`${id}@`)) loadedCache.delete(key);
}

export async function listModuleRows(): Promise<Module[]> {
  return prisma.module.findMany({ orderBy: { id: "asc" } });
}

/** Modules actifs et chargeables. Un module cassé est ignoré, jamais fatal pour le site. */
export const getEnabledModules = cache(async (): Promise<LoadedModule[]> => {
  const rows = (await listModuleRows()).filter((r) => r.enabled);
  const loaded = await Promise.all(rows.map(loadModule));
  return loaded.filter((m): m is LoadedModule => m !== null);
});

export async function getModule(id: string): Promise<LoadedModule | null> {
  const row = await prisma.module.findUnique({ where: { id } });
  return row ? loadModule(row) : null;
}

export type ActiveInstance = { instance: InstanceView; mod: LoadedModule };

/** Instances actives dont le module est actif et chargeable : ce que le site exécute réellement. */
export const getActiveInstances = cache(async (): Promise<ActiveInstance[]> => {
  const [mods, instances] = await Promise.all([getEnabledModules(), listInstances()]);
  const all = instances.flatMap((instance) => {
    const mod = mods.find((m) => m.manifest.id === instance.moduleId);
    return instance.enabled && mod ? [{ instance, mod }] : [];
  });
  // Une instance dont la migration de données a échoué (ou dont les données sont plus récentes que le code du module) ne tourne pas.
  const sane = await Promise.all(all.map(async (a) => ((await getSetting<{ status?: string }>(`instance.${a.instance.id}.__dataStatus`))?.status ? null : a)));
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
}
