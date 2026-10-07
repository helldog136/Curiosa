import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cache } from "react";
import type { Module } from "@prisma/client";
import { prisma } from "../db";
import { MODULES_DIR } from "../config";
import { BUILTIN_MODULES } from "@/modules-builtin";
import { parseManifest, type ParsedManifest } from "./manifest";
import type { ModuleDefinition } from "./types";

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
  vitrineModuleCache?: Map<string, LoadedModule>;
  vitrineBuiltinsSynced?: boolean;
};
const loadedCache = (globalCache.vitrineModuleCache ??= new Map());

export function moduleDir(id: string): string {
  return path.join(MODULES_DIR, id);
}

/** Crée la ligne de base des modules livrés avec le cœur la première fois qu'on les voit. */
async function syncBuiltins(): Promise<void> {
  if (globalCache.vitrineBuiltinsSynced) return;
  for (const b of BUILTIN_MODULES) {
    const existing = await prisma.module.findUnique({ where: { id: b.manifest.id } });
    if (!existing) {
      await prisma.module.create({
        data: {
          id: b.manifest.id,
          source: "builtin",
          version: b.manifest.version,
          enabled: b.manifest.defaultEnabled ?? false,
        },
      });
    } else if (existing.version !== b.manifest.version) {
      await prisma.module.update({ where: { id: existing.id }, data: { version: b.manifest.version } });
    }
  }
  globalCache.vitrineBuiltinsSynced = true;
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
    if (row.source === "builtin") {
      const builtin = BUILTIN_MODULES.find((b) => b.manifest.id === row.id);
      if (!builtin) return null;
      const loaded: LoadedModule = {
        row,
        manifest: builtin.manifest,
        def: builtin.definition,
        locales: builtin.locales ?? {},
      };
      loadedCache.set(cacheKey, loaded);
      return loaded;
    }

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
  await syncBuiltins();
  return prisma.module.findMany({ orderBy: { id: "asc" } });
}

/** Modules actifs et chargeables. Un module cassé est ignoré, jamais fatal pour le site. */
export const getEnabledModules = cache(async (): Promise<LoadedModule[]> => {
  const rows = (await listModuleRows()).filter((r) => r.enabled);
  const loaded = await Promise.all(rows.map(loadModule));
  return loaded.filter((m): m is LoadedModule => m !== null);
});

export async function getModule(id: string): Promise<LoadedModule | null> {
  await syncBuiltins();
  const row = await prisma.module.findUnique({ where: { id } });
  return row ? loadModule(row) : null;
}
