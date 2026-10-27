// Constantes du harnais d'images. Tout ce qui rend la capture reproductible est ici : ne rien changer sans refaire les deux captures (référence ET candidate).
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Racine du dépôt du cœur qui contient ce harnais (le code testé est TOUJOURS celui de ce dépôt, construit : `npm run build`). */
export const CORE_DIR = path.resolve(HERE, "../..");

/** Dossier de travail volatil (base, données, journaux). Jamais dans le dépôt. */
export const ROOT = process.env.VISUAL_ROOT || "/dev/shm/visual";
/** Dépôt de modules (curiosa-extras) à la version épinglée par l'instantané ; cloné par `visual:prepare` s'il manque. */
export const EXTRAS_DIR = process.env.VISUAL_EXTRAS || `${ROOT}/extras`;
export const EXTRAS_URL = process.env.VISUAL_EXTRAS_URL || "https://github.com/helldog136/curiosa-extras.git";
export const SNAPSHOT_DIR = `${ROOT}/snapshot`;

/** Plage de ports réservée au harnais. Un profil de thème = un serveur = un port. */
export const PORT_BASE = Number(process.env.VISUAL_PORT_BASE || 3480);
export const PORT_MAX = 3489;

/** Horloge figée (UTC) : un lundi à midi, au milieu de la semaine du planning de démonstration. */
export const FIXED_NOW = "2026-06-15T10:00:00.000Z";
export const SEED = "curiosa-visual-1";

/** Largeurs de capture (hauteur de fenêtre indicative : les captures sont pleine page). */
export const WIDTHS = [390, 768, 1280, 1920];
export const VIEWPORT_HEIGHT = { 390: 844, 768: 1024, 1280: 800, 1920: 1080 };

export const LOCALES = ["fr", "en"];
