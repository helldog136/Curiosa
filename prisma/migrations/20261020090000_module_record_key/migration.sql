-- Migration ADDITIVE : une colonne facultative et un index. Rien n'est retiré ni réécrit.
ALTER TABLE "ModuleRecord" ADD COLUMN "key" TEXT;

CREATE INDEX "ModuleRecord_instanceId_collection_key_idx" ON "ModuleRecord"("instanceId", "collection", "key");
