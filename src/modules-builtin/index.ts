import type { ParsedManifest } from "@/core/modules/manifest";
import type { ModuleDefinition } from "@/core/modules/types";
import * as contactForm from "./contact-form";
import * as liveStatus from "./live-status";
import * as hero from "./hero";
import * as blocks from "./blocks";
import * as tickerOverlay from "./ticker-overlay";
import * as pressKit from "./press-kit";
import { blog, codes, collection, links, pages } from "./content";

export type BuiltinModule = {
  manifest: ParsedManifest;
  definition: ModuleDefinition;
  locales?: Record<string, Record<string, string>>;
};

/**
 * Tout ce que fait le site de base est un module, bâti exactement comme un module
 * installé depuis git : même manifeste, même API. Aucun n'a d'instance tant qu'on
 * n'en crée pas (assistant de première installation, ou admin → Modules).
 */
export const BUILTIN_MODULES: BuiltinModule[] = [hero, blocks, blog, links, codes, pages, collection, contactForm, liveStatus, tickerOverlay, pressKit];
