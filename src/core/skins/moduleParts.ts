/**
 * COUCHE 2 : les pièces des modules (docs/SKINS.md §8). Lit la clé `skin` du `module.json` de chaque module INSTALLÉ (installé = actif : il n'y a pas d'état intermédiaire)
 * et en tire la couche (`buildModuleSkinLayer`, `moduleSkin.ts`) : jetons par défaut, paires de lisibilité, pièces ciblables par les skins.
 *
 * CACHE sans minuteur. La couche est gardée en mémoire avec l'EMPREINTE des modules installés (identifiant, version, commit : une ligne de base, aucune lecture de fichier) ;
 * elle est recalculée quand l'empreinte change OU quand `invalidateModuleSkinLayer()` est appelée (installation, mise à jour, réinstallation, retrait d'un module :
 * `forgetModule` et `resetModuleRegistry` dans `modules/registry.ts`). Aucun module ne déclare de pièce : `EMPTY_MODULE_LAYER`, la composition ne change en rien.
 * Au moindre doute (base ou fichier illisible, manifeste invalide) : le module est ignoré, jamais le site ; le résultat d'une panne de base n'est pas gardé.
 *
 * Le module n'est PAS chargé (pas d'`import()` de son code) : seul son `module.json` est lu, comme le fait `permissionsPolicy.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { MODULES_DIR } from "../config";
import { prisma } from "../db";
import { parseManifest } from "../modules/manifest";
import { invalidateSkinCache } from "./invalidate";
import { buildModuleSkinLayer, EMPTY_MODULE_LAYER, type ModuleSkinLayer } from "./moduleSkin";

export { EMPTY_MODULE_LAYER };
export type { ModuleSkinLayer };

const MAX_MODULES = 500;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MODULE_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

export type InstalledRow = { id: string; version: string; commit?: string | null };

export type LayerSource = {
  /** Modules installés (lecture légère). Peut lever : la couche précédente reste alors en service si elle existe, sinon `EMPTY_MODULE_LAYER` (sans la garder). */
  list(): Promise<InstalledRow[]>;
  /** `module.json` brut d'un module installé, ou `null` s'il manque ou n'est pas lisible. */
  read(id: string): unknown | null;
};

export type LayerCache = { get(): Promise<ModuleSkinLayer>; invalidate(): void };

const signatureOf = (rows: readonly InstalledRow[]) => rows.map((r) => `${r.id}@${r.version}@${r.commit ?? ""}`).sort().join("|");

/** Cache de la couche, pour une source donnée (les tests injectent la leur). */
export function createLayerCache(source: LayerSource): LayerCache {
  let signature: string | null = null;
  let layer: ModuleSkinLayer = EMPTY_MODULE_LAYER;
  let dirty = true;
  return {
    invalidate() { dirty = true; },
    async get() {
      let rows: InstalledRow[];
      try { rows = (await source.list()).filter((r) => MODULE_ID_RE.test(r.id)).slice(0, MAX_MODULES); } catch { return signature === null ? EMPTY_MODULE_LAYER : layer; }
      const sig = signatureOf(rows);
      if (!dirty && sig === signature) return layer;
      const modules: { id: string; skin: unknown }[] = [];
      let incomplete = false; // un fichier illisible n'est pas gardé en mémoire : on réessaie à la page suivante
      for (const r of rows) {
        let raw: unknown;
        try { raw = source.read(r.id); } catch { incomplete = true; continue; }
        if (raw === null || raw === undefined) { incomplete = true; continue; }
        if (typeof raw !== "object" || (raw as { skin?: unknown }).skin === undefined) continue;
        const parsed = parseManifest(raw);
        // un manifeste invalide : le cœur ne chargerait pas ce module, il n'a donc pas de pièces ; une clé `skin` mal formée est décrite par le kit, pas ici
        if (parsed.ok && parsed.manifest.skin) modules.push({ id: parsed.manifest.id, skin: parsed.manifest.skin });
      }
      dirty = incomplete;
      signature = sig;
      layer = buildModuleSkinLayer(modules).layer;
      return layer;
    },
  };
}

function readManifestFile(id: string): unknown | null {
  const file = path.join(MODULES_DIR, id, "module.json");
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const g = globalThis as unknown as { curiosaModuleSkinLayer?: LayerCache };
const cache = (): LayerCache =>
  (g.curiosaModuleSkinLayer ??= createLayerCache({
    list: () => prisma.module.findMany({ select: { id: true, version: true, commit: true }, take: MAX_MODULES }),
    read: readManifestFile,
  }));

/** À appeler quand un module est installé, mis à jour, réinstallé ou désinstallé : la prochaine page vue relit les `module.json`. */
export function invalidateModuleSkinLayer(): void {
  cache().invalidate();
  invalidateSkinCache(); // les feuilles composées contiennent les jetons et les pièces des modules
}

/** La couche « pièces de modules » du site. Ne lève jamais. */
export async function getModuleSkinLayer(): Promise<ModuleSkinLayer> {
  try { return await cache().get(); } catch { return EMPTY_MODULE_LAYER; }
}
