// Base SQLite jetable pour les tests qui touchent la base. Chaque fichier de test tourne dans son processus : il obtient
// SA copie d'un modèle migré (construit une fois, reconstruit si les migrations changent) — rapide et sans interférence.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = path.join(root, "tests/.tmp");
const template = path.join(tmp, "template.db");

function newestMigration() {
  const dir = path.join(root, "prisma/migrations");
  return Math.max(...fs.readdirSync(dir, { recursive: true }).map((f) => fs.statSync(path.join(dir, String(f))).mtimeMs));
}

function ensureTemplate() {
  fs.mkdirSync(tmp, { recursive: true });
  if (fs.existsSync(template) && fs.statSync(template).mtimeMs > newestMigration()) return;
  fs.rmSync(template, { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: `file:${template}` }, stdio: "pipe" });
}

/**
 * À appeler tout en haut d'un test, AVANT d'importer le moindre module du cœur (les imports dynamiques viennent après) :
 *   const db = await useTestDb();
 *   const { prisma } = await import("@/core/db");
 */
export async function useTestDb() {
  ensureTemplate();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-test-"));
  const file = path.join(dir, "test.db");
  fs.copyFileSync(template, file);
  process.env.DATABASE_URL = `file:${file}`;
  process.env.DATA_DIR = dir;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  const { prisma } = await import("@/core/db");
  const tables = ["ApiToken", "AuditLog", "ModuleRecord", "EntryTranslation", "Entry", "InstanceTranslation", "ModuleInstance", "Redirect", "Setting", "Module", "User"];
  return {
    dir,
    prisma,
    /** Vide toutes les tables (entre deux tests). Le registre des modules livrés est recréé à la demande. */
    async reset() {
      for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
      globalThis.curiosaBuiltinsSynced = false; globalThis.curiosaBuiltinsSyncing = null;
      globalThis.curiosaModuleCache?.clear?.();
      // Modules installés depuis git : on repart d'un dossier vide.
      fs.rmSync(path.join(dir, "modules"), { recursive: true, force: true });
    },
    async close() {
      await prisma.$disconnect();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
