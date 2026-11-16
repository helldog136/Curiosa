-- Saved versions of an overlay page (0.20.0): one column added to OverlayPage, nothing existing changes. Bounded JSON (10 versions at most, newest first).
-- An older core ignores the column.
ALTER TABLE "OverlayPage" ADD COLUMN "versions" TEXT NOT NULL DEFAULT '[]';
