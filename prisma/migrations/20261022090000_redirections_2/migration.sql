-- Redirections 2 : date de fin, message de fin et passages par jour. Ajouts seulement : aucune colonne retirée, renommée ni modifiée
-- (une base existante garde tout ; les anciennes redirections n'ont ni date de fin ni détail par jour, leur total `hits` est conservé).
-- AlterTable
ALTER TABLE "Redirect" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "Redirect" ADD COLUMN "endMessage" TEXT NOT NULL DEFAULT '';
-- CreateTable
CREATE TABLE "RedirectDay" (
    "redirectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("redirectId", "day"),
    CONSTRAINT "RedirectDay_redirectId_fkey" FOREIGN KEY ("redirectId") REFERENCES "Redirect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateIndex
CREATE INDEX "RedirectDay_day_idx" ON "RedirectDay"("day");
