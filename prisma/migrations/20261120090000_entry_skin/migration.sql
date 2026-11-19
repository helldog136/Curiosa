-- (0.45.0) A page can ask for one installed site skin for its own rendering. Nullable, no default: every existing row keeps showing the site skin.
ALTER TABLE "Entry" ADD COLUMN "skin" TEXT;
