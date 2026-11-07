import { redirect } from "next/navigation";
import { SETTINGS_AI_HREF } from "@/core/adminLinks";

/** Ancienne adresse : « Visibilité dans les IA » est un onglet des réglages du site. Aucun paramètre n'était utilisé. */
export default function AiVisibilityMovedPage() {
  redirect(SETTINGS_AI_HREF);
}
