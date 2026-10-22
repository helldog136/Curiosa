import { prisma } from "../db";
import { getSetting, setSetting } from "../settings";
import { canServeOverlay, isOverlayManifest, placementSettingKey } from "./menuPlacement";
import { readGitManifest } from "./registry";

/** Marqueur : la règle de rangement a changé (0.2.6) et les instances EXISTANTES ont déjà été figées. Posé une fois ; les instances créées ensuite suivent la nouvelle règle. */
export const PLACEMENT_FREEZE_MARKER = "core.placementFrozen";
const MAX_INSTANCES = 2000;

/**
 * 0.2.6 : un module qui a une page ou des sections n'est plus rangé d'office « seulement dans Extensions » à cause de la permission « overlay ».
 * Pour ne RIEN changer sur un site existant, chaque instance concernée qui n'a pas de rangement choisi reçoit, UNE fois, le rangement qu'elle avait
 * (« overlays »). Ajoute seulement (aucun réglage lu n'est modifié ni supprimé) ; idempotent ; borné ; ne lève jamais. Renvoie le nombre d'instances figées.
 */
export async function freezeOverlayPlacements(): Promise<number> {
  try {
    if (await getSetting(PLACEMENT_FREEZE_MARKER)) return 0;
    const rows = await prisma.moduleInstance.findMany({ select: { id: true, moduleId: true }, orderBy: { id: "asc" }, take: MAX_INSTANCES + 1 });
    const manifests = new Map<string, ReturnType<typeof readGitManifest>>();
    let frozen = 0;
    for (const row of rows.slice(0, MAX_INSTANCES)) {
      if (!manifests.has(row.moduleId)) manifests.set(row.moduleId, readGitManifest(row.moduleId));
      const manifest = manifests.get(row.moduleId);
      if (!manifest || !canServeOverlay(manifest) || isOverlayManifest(manifest)) continue; // seuls les modules dont le rangement par défaut vient de changer
      const key = placementSettingKey(row.id);
      if ((await getSetting(key)) !== undefined) continue; // un choix de la personne l'emporte toujours
      await setSetting(key, "overlays");
      frozen++;
    }
    if (rows.length <= MAX_INSTANCES) await setSetting(PLACEMENT_FREEZE_MARKER, new Date().toISOString());
    return frozen;
  } catch (error) {
    console.error("[placement] freeze failed:", (error as Error)?.name);
    return 0;
  }
}
