import type { ParsedManifest } from "@/core/modules/manifest";
import type { ModuleDefinition } from "@/core/modules/types";
import * as feeds from "./feeds";
import * as contactForm from "./contact-form";
import * as liveStatus from "./live-status";

export type BuiltinModule = {
  manifest: ParsedManifest;
  definition: ModuleDefinition;
  locales?: Record<string, Record<string, string>>;
};

/**
 * Fonctionnalités "de base" livrées avec le cœur, mais bâties exactement comme
 * un module installé depuis git : même manifeste, même API, même panneau
 * d'admin. Ce sont aussi les meilleurs exemples à copier.
 */
export const BUILTIN_MODULES: BuiltinModule[] = [feeds, contactForm, liveStatus];
