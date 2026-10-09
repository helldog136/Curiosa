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
  // Les fichiers de test tournent en parallèle : à froid, plusieurs processus arrivent ici en même temps. Chacun construit SA copie
  // sous un nom unique puis la pose d'un coup (rename atomique) : personne ne lit jamais une base à moitié construite.
  const mine = path.join(tmp, `template.${process.pid}.db`);
  fs.rmSync(mine, { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: `file:${mine}` }, stdio: "pipe" });
  fs.renameSync(mine, template);
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
  // Une seule connexion : les réglages ci-dessous (propres à la connexion) s'appliquent à toutes les requêtes du test.
  process.env.DATABASE_URL = `file:${file}?connection_limit=1`;
  process.env.DATA_DIR = dir;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  // Les dépôts git des tests sont jetables, y compris ceux que l'installateur crée lui-même : modèle vide, pas de fsync, pas de ramasse-miettes (même résultat, bien plus vite).
  Object.assign(process.env, { GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: "init.templateDir", GIT_CONFIG_VALUE_0: "", GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "none", GIT_CONFIG_KEY_2: "gc.auto", GIT_CONFIG_VALUE_2: "0" });
  // Modules livrés des tests : de petites fixtures, jamais les vrais modules (le cœur n'en contient aucun).
  process.env.CURIOSA_EXTRAS_DIR ??= path.join(root, "tests/fixtures/extras");
  const { prisma } = await import("@/core/db");
  // Base jetable, détruite à la fin du test : on n'attend pas les écritures sur disque (synchronous=OFF, journal en mémoire). Aucun effet sur ce qui est vérifié.
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=MEMORY");
  await prisma.$queryRawUnsafe("PRAGMA synchronous=OFF");
  const tables = ["VisitSeen", "VisitDaily", "ApiToken", "AuditLog", "ModuleRecord", "EntryTranslation", "Entry", "InstanceTranslation", "ModuleInstance", "Redirect", "Setting", "Module", "AuthLock", "TrustedIp", "RecoveryCode", "Passkey", "PasskeyChallenge", "User"];
  return {
    dir,
    prisma,
    /** Installe un module de test (tests/fixtures/modules/<id>) : fichiers copiés + ligne en base, activé. */
    async fixture(id, enabled = true) {
      const { installFixtureFiles } = await import("./fixtureModules.mjs");
      installFixtureFiles(dir, id);
      const version = JSON.parse(fs.readFileSync(path.join(dir, "modules", id, "module.json"), "utf8")).version;
      return prisma.module.upsert({ where: { id }, create: { id, source: "bundled", version, enabled }, update: { enabled } });
    },
    /** Vide toutes les tables (entre deux tests). Les migrations de mise à jour repassent à la demande. */
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
