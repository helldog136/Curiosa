import { currentUser } from "@/core/permissions";
import { canShowDownload } from "./adminTransfer";
import { getActiveInstances } from "./registry";

/**
 * Le bouton « Télécharger » d'un panneau d'administration (bloc `download`) n'est montré qu'à une personne qui a le droit de télécharger : le même
 * contrôle que la route du cœur (`decideDownload`), sur la personne relue en base à cette requête. Sans droit (ou sans téléchargement de ce nom),
 * pas de bouton : on ne propose pas ce qui répondrait « refusé ». La route reste, elle, la garde qui fait foi.
 */
export async function mayShowDownload(instanceId: string, name: string): Promise<boolean> {
  try {
    const user = await currentUser();
    if (!user) return false;
    const active = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
    if (!active) return false;
    return canShowDownload(user, active.mod.manifest.id, active.mod.def.adminDownloads, name);
  } catch { return false; }
}
