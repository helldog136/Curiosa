import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db";

/**
 * VERSION DU SCHÉMA DE BASE — pour que les sauvegardes traversent les versions du framework.
 *
 * La version du schéma est le nom de la dernière migration Prisma appliquée (ils commencent par un horodatage : l'ordre alphabétique est
 * l'ordre chronologique). Une sauvegarde la note ; à la restauration :
 *   - plus RÉCENTE que la base actuelle → refusée (« mettez d'abord le framework à jour ») : on ne sait pas lire un schéma futur ;
 *   - plus ANCIENNE → acceptée : les colonnes disparues sont ignorées, les colonnes ajoutées prennent leur valeur par défaut, et les
 *     transformations qui ne se déduisent pas du schéma (renommage…) sont des `schemaUpgrades` explicites (ci-dessous).
 */
export async function currentSchemaVersion(migrationsDir = path.join(process.cwd(), "prisma", "migrations")): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
    if (rows[0]?.migration_name) return rows[0].migration_name;
  } catch { /* base de test créée sans table de suivi : on lit le dossier */ }
  try {
    return fs.readdirSync(migrationsDir).filter((d) => /^\d{8,}_/.test(d)).sort().at(-1) ?? "";
  } catch { return ""; }
}

/** `undefined` = sauvegarde faite avant que la version du schéma soit notée : traitée comme la plus ancienne. */
export const isNewerSchema = (backup: string | undefined, current: string): boolean => !!backup && !!current && backup > current;

type Row = Record<string, unknown>;
export type BackupData = { users: Row[]; settings: Row[]; modules: Row[]; instances: Row[]; instanceTranslations: Row[]; entries: Row[]; entryTranslations: Row[]; redirects: Row[]; records: Row[] };

/**
 * Transformations explicites des données d'une sauvegarde faite AVANT une migration qui change le sens d'une donnée (renommage, découpage…).
 * `before` = nom de la migration ; l'étape s'applique aux sauvegardes dont le schéma est antérieur. À ajouter en même temps que la migration SQL.
 * Ajouter une colonne avec une valeur par défaut, ou en retirer une, n'en demande pas : c'est géré automatiquement.
 */
export type SchemaUpgrade = { before: string; upgrade: (data: BackupData) => void };
export const schemaUpgrades: SchemaUpgrade[] = [];

export function applyUpgrades(data: BackupData, backupSchema: string | undefined, upgrades: SchemaUpgrade[] = schemaUpgrades): void {
  for (const u of [...upgrades].sort((a, b) => a.before.localeCompare(b.before))) if (!backupSchema || backupSchema < u.before) u.upgrade(data);
}

const MODEL_BY_KEY: Record<string, string> = { users: "User", instances: "ModuleInstance", instanceTranslations: "InstanceTranslation", entries: "Entry", entryTranslations: "EntryTranslation", redirects: "Redirect", records: "ModuleRecord" };

/** Ne garde que les colonnes que le schéma actuel connaît : une sauvegarde plus ancienne peut en avoir que cette version a retirées. */
export function pickKnownColumns(key: keyof typeof MODEL_BY_KEY | string, row: Row): Row {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === MODEL_BY_KEY[key]);
  if (!model) return row;
  const known = new Set(model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name));
  return Object.fromEntries(Object.entries(row).filter(([k]) => known.has(k)));
}
