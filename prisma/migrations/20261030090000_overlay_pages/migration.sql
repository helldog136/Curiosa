-- Pages d'overlay (0.5.0) : une table ajoutée, rien d'existant ne change (un ancien cœur l'ignore). Les éléments et le style sont du JSON borné
-- (30 éléments au plus par page, 20 pages au plus : la page est toujours lue et écrite en entier). Le secret de l'adresse n'est jamais en clair :
-- empreinte SHA-256 (recherche à la lecture de la page publique) et copie chiffrée (pour pouvoir recopier l'adresse dans l'administration).
-- CreateTable
CREATE TABLE "OverlayPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "style" TEXT NOT NULL DEFAULT '{}',
    "elements" TEXT NOT NULL DEFAULT '[]',
    "secretHash" TEXT NOT NULL,
    "secretSealed" TEXT NOT NULL DEFAULT '',
    "testUntil" DATETIME,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
-- CreateIndex
CREATE UNIQUE INDEX "OverlayPage_secretHash_key" ON "OverlayPage"("secretHash");
