import fs from "node:fs";
import path from "node:path";
import { MODULE_API_VERSION } from "../config";
import { getRecognized, getRecognizedDetailed, type RecognizedItem, type RecognizedResult } from "./recognized";
import { parseManifest, type ParsedManifest } from "./manifest";
import { incompatWithThisCore, requirementOf, type CoreRequirement } from "./compat";
import type { LocalizedString } from "./types";
import { normalizeNeeds, normalizeOffers, type ServiceNeed, type ServiceOffer } from "./serviceVersions";

/**
 * MARKETPLACE — la liste des modules que l'on peut installer en confiance, et rien d'autre.
 *
 *   recognized   dépôts git listés dans l'index du dépôt de modules (version épinglée par étiquette) : le catalogue, source de vérité de tout module installé.
 *   bundled      REPLI HORS LIGNE : instantané du dépôt de modules (`extras/`) embarqué dans l'archive du cœur, utilisé seulement quand le catalogue est
 *                injoignable (première installation sans réseau) ou ne liste pas le module. Jamais une source concurrente du catalogue.
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
  kind: "community" | "example" | "recognized";
  /** Module suggéré par le Catalogue (liste du dépôt de modules, voir suggestedModuleIds) : mis en avant, proposé à l'assistant de première installation. */
  suggested?: boolean;
  /** Les modules de l'instantané hors ligne se copient du serveur ; ceux du catalogue se clonent depuis `repo`. */
  source: "bundled" | "recognized";
  repo?: string;
  ref?: string;
  /** Dossier du module dans `repo` quand ce dépôt en regroupe plusieurs (source « recognized »). */
  subdir?: string;
  /** Dossier du module dans l'instantané hors ligne (source « bundled »). */
  dir?: string;
  /** Sujets que le module fournit (ex. `social.link`) : le cœur s'en sert pour proposer les réseaux sociaux. */
  provides?: string[];
  /** Ce module vise-t-il l'API de modules de CE framework ? Sinon il est listé mais non installable. */
  compatible: boolean;
  /** Cœur minimal demandé (index ou manifeste), absent = aucune exigence. Ne change pas `compatible` (API) : voir `needsNewerCore`. */
  requires?: CoreRequirement;
  /** Version du cœur demandée quand CE cœur est trop ancien (le module est listé, mais ni installable ni mis à jour ici). */
  needsNewerCore?: string;
  /** Services offerts / exigés (manifeste de l'instantané hors ligne, ou index du catalogue) : lus SANS installer, pour dire ce que l'installation apportera. */
  offers?: ServiceOffer[];
  needs?: ServiceNeed[];
};

const BUNDLED: { dir: string; kind: "community" | "example" }[] = [
  { dir: "modules", kind: "community" },
  { dir: "examples", kind: "example" },
];

/** Dossier de l'instantané hors ligne : `extras/` à côté de l'application (instantané de curiosa-extras), ou celui que désigne CURIOSA_EXTRAS_DIR. */
export function appRoot(): string {
  return process.env.CURIOSA_EXTRAS_DIR ?? path.join(process.cwd(), "extras");
}

/**
 * Modules SUGGÉRÉS : une liste tenue par le dépôt de modules (`catalogue/suggested.json`, copiée dans l'instantané), jamais une case que cocherait un module :
 * seul ce que le mainteneur de ce dépôt y inscrit l'est, (jamais un dépôt personnel).
 * Le cœur ne connaît aucun identifiant.
 */
export function suggestedModuleIds(root = appRoot()): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "catalogue", "suggested.json"), "utf8"));
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && /^[a-z][a-z0-9-]{1,39}$/.test(id)) : []);
  } catch { return new Set(); }
}

export function readBundledManifest(dir: string): ParsedManifest | null {
  try {
    const parsed = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")));
    return parsed.ok ? parsed.manifest : null;
  } catch {
    return null;
  }
}

/** Modules de l'instantané hors ligne (manifeste valide uniquement). */
export function listBundled(root = appRoot()): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  const suggested = suggestedModuleIds(root);
  for (const { dir, kind } of BUNDLED) {
    const base = path.join(root, dir);
    let names: string[] = [];
    try { names = fs.readdirSync(base).sort(); } catch { continue; }
    for (const name of names) {
      const full = path.join(base, name);
      if (!fs.statSync(full).isDirectory()) continue;
      const m = readBundledManifest(full);
      if (!m || out.some((e) => e.id === m.id)) continue;
      out.push({ id: m.id, name: m.name, description: m.description ?? "", version: m.version, icon: m.icon, author: m.author, kind, suggested: suggested.has(m.id), source: "bundled", dir: full, provides: (m.provides ?? []).map((p) => p.topic), compatible: true, requires: requirementOf(m), offers: normalizeOffers(m.offers), needs: normalizeNeeds(m.requires) });
    }
  }
  return out;
}

/** Entrée du catalogue pour un dépôt reconnu. Les services annoncés manquent-ils à l'index ? On reprend ceux de l'instantané hors ligne (`snapshot`) pour ne pas perdre la résolution des dépendances. */
function recognizedEntry(c: RecognizedItem, suggested: Set<string>, snapshot?: CatalogueEntry): CatalogueEntry {
  const offers = normalizeOffers(c.offers);
  const needs = normalizeNeeds(c.needs);
  return {
    id: c.id, name: c.name, description: c.description, version: c.version, icon: c.icon, author: c.author, suggested: suggested.has(c.id),
    kind: "recognized", source: "recognized", provides: c.provides ?? snapshot?.provides, repo: c.repo, ref: c.ref, subdir: c.subdir, compatible: c.apiVersion === undefined || c.apiVersion === MODULE_API_VERSION,
    requires: c.requires, needsNewerCore: incompatWithThisCore(c.requires)?.needs,
    offers: offers?.length ? offers : snapshot?.offers, needs: needs?.length ? needs : snapshot?.needs,
  };
}

/**
 * Tout ce qu'on peut installer en confiance. Le catalogue (dépôt de modules, version épinglée par étiquette) est la SEULE source de vérité : une entrée
 * du catalogue n'est jamais masquée. L'instantané embarqué dans l'archive du cœur n'est qu'un REPLI HORS LIGNE : il ne figure ici que pour
 * les modules que le catalogue ne liste pas (exemples, ou catalogue vide).
 */
export async function getCatalogue(opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<CatalogueEntry[]> {
  const snapshot = listBundled(opts.root);
  const recognized = await getRecognized(opts.fetchImpl);
  const suggested = suggestedModuleIds(opts.root);
  return [
    ...recognized.map((c) => recognizedEntry(c, suggested, snapshot.find((b) => b.id === c.id))),
    ...snapshot.filter((b) => !recognized.some((c) => c.id === b.id)),
  ];
}

export async function findCatalogueEntry(id: string, opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<CatalogueEntry | undefined> {
  return (await getCatalogue(opts)).find((e) => e.id === id);
}

/** D'où vient un module installé ? « catalogue » = listé par le catalogue ; « custom » = dépôt personnel non vérifié. */
export function moduleOrigin(row: { id: string; source: string; repoUrl: string | null; subdir?: string | null }, market: CatalogueEntry[]): "catalogue" | "custom" {
  const entry = market.find((e) => e.id === row.id);
  if (!entry) return "custom";
  if (row.source === "bundled") return "catalogue";   // module de base : le catalogue en est la source, qu'il soit déjà converti ou non
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return entry.source === "recognized" && norm(entry.repo) === norm(row.repoUrl) && (entry.subdir ?? null) === (row.subdir ?? null) ? "catalogue" : "custom";
}

/** D'où vient la liste des dépôts reconnus affichée (dépôt à jour, dernière copie reçue, ou copie de repli de cette version) ? */
export async function getCatalogueSource(opts: { fetchImpl?: typeof fetch } = {}): Promise<Pick<RecognizedResult, "source" | "fetchedAt" | "origin">> {
  const { source, fetchedAt, origin } = await getRecognizedDetailed(opts);
  return { source, fetchedAt, origin };
}
