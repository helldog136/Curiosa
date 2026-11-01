import { redirect } from "next/navigation";
import { EXTENSIONS_HREF, legacyExtensionsTarget, type RawQuery } from "@/core/modules/extensionsLinks";

/** Pages d'avant la page Extensions (Modules, Catalogue, Intégrations, Overlays) : l'ancienne adresse mène à la nouvelle vue, paramètres conservés. */
export async function redirectLegacy(pathname: string, searchParams: Promise<RawQuery>): Promise<never> {
  redirect(legacyExtensionsTarget(pathname, await searchParams) ?? EXTENSIONS_HREF);
}
