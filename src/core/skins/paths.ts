import path from "node:path";
import { DATA_DIR } from "../config";

/** Dossier des skins installés : `DATA_DIR/skins/<id>/<version>/` (docs/SKINS.md §5.6), à côté de `DATA_DIR/modules`. */
export const SKINS_DIR = path.join(DATA_DIR, "skins");
