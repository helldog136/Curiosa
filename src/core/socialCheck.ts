import type { InstanceView } from "@/core/instances";
import { buildContext } from "@/core/modules/context";
import type { LoadedModule } from "@/core/modules/registry";
import { SOCIAL_TOPIC } from "@/core/social";
import { isSafeExternalUrl } from "@/core/url";

/** Le réglage d'un réseau qui porte l'adresse du profil. Tous les modules de réseau l'appellent ainsi. */
export const SOCIAL_PROFILE_KEY = "profile";

/** Ce réglage est-il l'adresse du profil d'un réseau (module de type `social` qui fournit son bouton) ? */
export function isSocialProfileField(mod: Pick<LoadedModule, "manifest" | "def">, key: string): boolean {
  return key === SOCIAL_PROFILE_KEY && mod.manifest.type === "social" && typeof mod.def.exports?.[SOCIAL_TOPIC] === "function";
}

/**
 * Le bouton que ce réseau afficherait pour l'adresse saisie, SANS rien enregistrer : on demande au module son bouton avec la valeur proposée à la place de la valeur
 * enregistrée. `null` : le module ne reconnaît pas l'adresse (il n'aurait rien affiché). Le module a 2 secondes ; une panne vaut « non reconnu ».
 */
export async function previewSocialButton(mod: LoadedModule, instance: InstanceView, value: string, locale: string): Promise<{ label: string; url: string } | null> {
  const exported = mod.def.exports?.[SOCIAL_TOPIC];
  if (typeof exported !== "function") return null;
  try {
    const ctx = await buildContext(mod, instance, locale);
    const probe = { ...ctx, setting: (<T = string>(key: string) => (key === SOCIAL_PROFILE_KEY ? (value as unknown as T) : ctx.setting<T>(key))) as typeof ctx.setting };
    const items = await Promise.race([Promise.resolve(exported(probe, { locale, limit: 1, tags: [] })), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 2000).unref?.())]);
    const first = Array.isArray(items) ? items[0] : null;
    if (!first || typeof first !== "object") return null;
    const { label, url } = first as { label?: unknown; url?: unknown };
    return typeof label === "string" && label.trim() && typeof url === "string" && isSafeExternalUrl(url) ? { label: label.trim().slice(0, 120), url } : null;
  } catch { return null; }
}
