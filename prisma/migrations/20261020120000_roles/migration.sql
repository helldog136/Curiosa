-- Rôles et droits (0.2.0) : tables ajoutées seulement (aucune colonne retirée ni modifiée). Les rôles prédéfinis et l'affectation
-- initiale (chaque personne reçoit le rôle égal à User.role) sont créés au démarrage par le cœur (src/core/auth/roles.ts), sans effet pour un ancien cœur.
-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "rights" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    PRIMARY KEY ("userId", "roleId"),
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
