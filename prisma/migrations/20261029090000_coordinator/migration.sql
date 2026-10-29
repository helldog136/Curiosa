-- AlterTable : Coordinateur technique (0.4.0). Aucune ligne existante ne change (faux par défaut) ; un ancien cœur ignore cette colonne.
ALTER TABLE "User" ADD COLUMN "coordinator" BOOLEAN NOT NULL DEFAULT false;
