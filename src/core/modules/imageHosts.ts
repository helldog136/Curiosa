import { getActiveInstances } from "./registry";
import type { ParsedManifest } from "./manifest";

/** Les hôtes d'images que le manifeste déclare (`imageHosts`) : en minuscules, sans doublon, 5 au plus. Aucune déclaration : liste vide (seulement les pages du site). */
export function declaredImageHosts(manifest: Pick<ParsedManifest, "imageHosts"> | null | undefined): string[] {
  return [...new Set((manifest?.imageHosts ?? []).map((h) => h.toLowerCase()))].slice(0, 5);
}

/** Les hôtes d'images permis à l'instance `instanceId` (ceux de SON module). Instance inconnue ou erreur : aucun. */
export async function imageHostsOfInstance(instanceId: string | undefined): Promise<string[]> {
  if (!instanceId) return [];
  try {
    const active = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
    return declaredImageHosts(active?.mod.manifest);
  } catch { return []; }
}
