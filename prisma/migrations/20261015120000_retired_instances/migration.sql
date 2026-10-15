-- CreateTable
CREATE TABLE "RetiredInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "moduleName" TEXT NOT NULL,
    "repoUrl" TEXT,
    "ref" TEXT,
    "subdir" TEXT,
    "reason" TEXT NOT NULL,
    "retiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "repoUrl" TEXT,
    "ref" TEXT,
    "commit" TEXT,
    "subdir" TEXT,
    "tree" TEXT,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Module" ("commit", "enabled", "id", "installedAt", "ref", "repoUrl", "source", "subdir", "tree", "updatedAt", "version") SELECT "commit", "enabled", "id", "installedAt", "ref", "repoUrl", "source", "subdir", "tree", "updatedAt", "version" FROM "Module";
DROP TABLE "Module";
ALTER TABLE "new_Module" RENAME TO "Module";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RetiredInstance_moduleId_idx" ON "RetiredInstance"("moduleId");

