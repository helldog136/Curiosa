-- Overlay skins (0.8.0): one column added to OverlayPage, nothing existing changes. `look` is bounded JSON (default skin, skin per context rules; 200 rules at most).
-- An older core ignores the column.
ALTER TABLE "OverlayPage" ADD COLUMN "look" TEXT NOT NULL DEFAULT '{}';
