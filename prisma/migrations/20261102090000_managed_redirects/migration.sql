-- Adresses courtes gérées par un module (cœur 0.6.1) : une colonne AJOUTÉE à Redirect, vide pour tous les liens existants (aucune ligne ne change de sens).
-- `managedBy` : identifiant de l'instance de module qui gère le lien ; vide = lien créé par une personne. Un ancien cœur ignore la colonne.
-- AlterTable
ALTER TABLE "Redirect" ADD COLUMN "managedBy" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "Redirect_managedBy_key" ON "Redirect"("managedBy");
