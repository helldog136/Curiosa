-- Journal central (prochaine version) : cinq colonnes AJOUTÉES à AuditLog, aucune ligne existante ne change de sens ni ne disparaît (un ancien cœur ignore les colonnes :
-- toutes ont une valeur par défaut). `module` / `instance` : à quel module appartient la ligne (vide = le cœur). `level` : info, warn ou error.
-- `actorKind` : person, module, assistant ou system. `data` : JSON borné (au plus 5 champs de 200 caractères, déclarés par le module), vide pour les lignes génériques.
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "module" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AuditLog" ADD COLUMN "instance" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AuditLog" ADD COLUMN "level" TEXT NOT NULL DEFAULT 'info';
ALTER TABLE "AuditLog" ADD COLUMN "actorKind" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "AuditLog" ADD COLUMN "data" TEXT NOT NULL DEFAULT '';
-- Les lignes d'avant gardent leur acteur tel quel ; seule leur origine est déduite de sa forme (adresse e-mail = personne, « mcp: » = assistant, « module: » = module, le reste = système).
UPDATE "AuditLog" SET "actorKind" = CASE
  WHEN "actor" LIKE 'mcp:%' THEN 'assistant'
  WHEN "actor" LIKE 'module:%' THEN 'module'
  WHEN "actor" LIKE '%@%' THEN 'person'
  ELSE 'system' END;
-- CreateIndex
CREATE INDEX "AuditLog_module_createdAt_idx" ON "AuditLog"("module", "createdAt");
CREATE INDEX "AuditLog_instance_createdAt_idx" ON "AuditLog"("instance", "createdAt");
