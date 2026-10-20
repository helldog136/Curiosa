import { MODULE_API_VERSION } from "../config";
import { getRecognizedDetailed, readRecognizedCacheOffline, type RecognizedItem, type RecognizedResult } from "./recognized";
import { incompatWithThisCore, type CoreRequirement } from "./compat";
import type { LocalizedString } from "./types";
import { normalizeNeeds, normalizeOffers, type ServiceNeed, type ServiceOffer } from "./serviceVersions";

/**
 * MARKETPLACE — la liste des modules que l'on peut installer en confiance, et rien d'autre.
 *
 *   recognized   dépôts git listés dans l'index du dépôt de modules (par défaut curiosa-extras ; version épinglée par étiquette) : le catalogue, lu sur le réseau,
 *                source de vérité de tout module. Le cœur n'embarque aucun module et ne garde aucune copie de la liste : sans réseau (ni dernière copie reçue), elle est vide.
 *
 * Tout autre dépôt git est un module PERSONNEL, non vérifié : il s'installe depuis l'admin avec un avertissement explicite
 * (voir installer.ts), jamais d'office. Le catalogue sert aussi à restaurer une sauvegarde (backup/restore.ts).
 */
export type CatalogueEntry = {
  id: string;
  name: LocalizedString;
  description: LocalizedString;
  version?: string;
  icon?: string;
  author?: string;
  kind: "recognized";
  /** Module suggéré par le Catalogue (`catalogue/suggested.json` du dépôt du catalogue) : mis en avant, proposé à l'assistant de première installation. */
  suggested?: boolean;
  /** Les modules du catalogue se clonent depuis `repo` (étiquette `ref` épinglée). */
  repo?: string;
  ref?: string;
  /** Dossier du module dans `repo` quand ce dépôt en regroupe plusieurs. */
  subdir?: string;
  /** Sujets que le module fournit (ex. `social.link`) : le cœur s'en sert pour proposer les réseaux sociaux. */
  provides?: string[];
  /** Ce module vise-t-il l'API de modules de CE framework ? Sinon il est listé mais non installable. */
  compatible: boolean;
  /** Cœur minimal demandé (index ou manifeste), absent = aucune exigence. Ne change pas `compatible` (API) : voir `needsNewerCore`. */
  requires?: CoreRequirement;
  /** Version du cœur demandée quand CE cœur est trop ancien (le module est listé, mais ni installable ni mis à jour ici). */
  needsNewerCore?: string;
  /** Services offerts / exigés (index du catalogue) : lus SANS installer, pour dire ce que l'installation apportera. */
  offers?: ServiceOffer[];
  needs?: ServiceNeed[];
  /**
   * D'où vient l'entrée : « official » = dépôt du catalogue (ou sa dernière copie reçue) ; « extra » = index supplémentaire (MODULES_INDEX_URL).
   * Un module « extra » n'est JAMAIS installé d'office (cascade, suggestion) : seulement proposé, avec un avertissement, sur un clic du propriétaire.
   * À ne pas confondre avec `moduleOrigin()` (module installé : catalogue ou dépôt personnel) ni `RecognizedResult.origin` (adresse du dépôt du catalogue).
   */
  origin: "official" | "extra";
};

/** Entrée du catalogue pour un dépôt reconnu. */
function recognizedEntry(c: RecognizedItem, suggested: Set<string>): CatalogueEntry {
  const offers = normalizeOffers(c.offers);
  const needs = normalizeNeeds(c.needs);
  return {
    id: c.id, name: c.name, description: c.description, version: c.version, icon: c.icon, author: c.author, suggested: c.catalogueOrigin !== "extra" && suggested.has(c.id),
    kind: "recognized", provides: c.provides, repo: c.repo, ref: c.ref, subdir: c.subdir, compatible: c.apiVersion === undefined || c.apiVersion === MODULE_API_VERSION,
    requires: c.requires, needsNewerCore: incompatWithThisCore(c.requires)?.needs,
    offers: offers?.length ? offers : undefined, needs: needs?.length ? needs : undefined,
    origin: c.catalogueOrigin === "extra" ? "extra" : "official",
  };
}

/**
 * Tout ce qu'on peut installer en confiance : l'index du catalogue (réseau, version épinglée par étiquette), et rien d'autre. Sans réseau ni dernière copie reçue : liste vide.
 */
export async function getCatalogue(opts: { fetchImpl?: typeof fetch } = {}): Promise<CatalogueEntry[]> {
  const { items, suggested } = await getRecognizedDetailed({ fetchImpl: opts.fetchImpl });
  const ids = new Set(suggested);
  return items.map((c) => recognizedEntry(c, ids));
}

/** Le catalogue tel que la dernière copie reçue le décrit, sans aucun réseau (balayage de conversion au démarrage). Vide sans copie. */
export function getCachedCatalogue(): CatalogueEntry[] {
  return readRecognizedCacheOffline().map((c) => recognizedEntry(c, new Set()));
}

/** Le catalogue est-il injoignable (ni dépôt, ni dernière copie reçue) ? Alors « liste vide » veut dire « réessayez », pas « rien à proposer ». */
export async function catalogueUnreachable(opts: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const r = await getRecognizedDetailed({ fetchImpl: opts.fetchImpl });
  return r.source === "none" && r.items.length === 0;
}

export async function findCatalogueEntry(id: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<CatalogueEntry | undefined> {
  return (await getCatalogue(opts)).find((e) => e.id === id);
}

/** D'où vient un module installé ? « catalogue » = listé par le catalogue ; « custom » = dépôt personnel non vérifié. */
export function moduleOrigin(row: { id: string; source: string; repoUrl: string | null; subdir?: string | null }, market: CatalogueEntry[]): "catalogue" | "custom" {
  const entry = market.find((e) => e.id === row.id);
  if (!entry) return "custom";
  if (row.source === "bundled") return "catalogue";   // compatibilité sites anciens, à retirer en 0.3.0 : ligne `bundled` d'un module que le catalogue liste
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return norm(entry.repo) === norm(row.repoUrl) && (entry.subdir ?? null) === (row.subdir ?? null) ? "catalogue" : "custom";
}

/** D'où vient la liste des dépôts reconnus affichée (dépôt à jour, dernière copie reçue, ou injoignable) ? */
export async function getCatalogueSource(opts: { fetchImpl?: typeof fetch } = {}): Promise<Pick<RecognizedResult, "source" | "fetchedAt" | "origin">> {
  const { source, fetchedAt, origin } = await getRecognizedDetailed(opts);
  return { source, fetchedAt, origin };
}
