-- (0.46.0) Personal AI assistants. Purely additive: nullable or defaulted columns, no row rewritten. Every existing access keeps ownerId NULL (independent, as before).
ALTER TABLE "ApiToken" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN "pausedAt" DATETIME;
CREATE INDEX "ApiToken_ownerId_idx" ON "ApiToken"("ownerId");
ALTER TABLE "User" ADD COLUMN "personalAi" TEXT NOT NULL DEFAULT 'inherit';
