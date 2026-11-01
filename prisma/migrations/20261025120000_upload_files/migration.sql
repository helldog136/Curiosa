-- Registre des fichiers envoyés (cœur 0.2.13) : qui l'a envoyé, quand, et quel module en est propriétaire. Migration ADDITIVE : une table neuve, rien n'est retiré ni réécrit.
-- Les fichiers déjà envoyés n'y figurent pas (aucun module ne peut les revendiquer : ils restent au cœur, comme avant).
-- CreateTable
CREATE TABLE "UploadFile" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "uploaderId" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerModule" TEXT,
    "ownerInstance" TEXT,
    "claimedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "UploadFile_ownerInstance_idx" ON "UploadFile"("ownerInstance");

-- CreateIndex
CREATE INDEX "UploadFile_ownerModule_idx" ON "UploadFile"("ownerModule");

-- CreateIndex
CREATE INDEX "UploadFile_createdAt_idx" ON "UploadFile"("createdAt");
