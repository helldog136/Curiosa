import fs from "node:fs";
import path from "node:path";
import { MODULE_API_VERSION } from "../config";
import { getCatalogue, getCatalogueDetailed, type CatalogueResult } from "./catalogue";
import { parseManifest, type ParsedManifest } from "./manifest";
import type { LocalizedString } from "./types";

/**
 * MARKETPLACE — la liste des modules que l'on peut installer en confiance, et rien d'autre.
 *
 *   bundled      modules livrés AVEC le framework (dossiers `modules-community/` et `modules-examples/`) : installés depuis
 *                les fichiers du serveur, sans réseau ; leur version suit celle du framework.
 *   recognized   dépôts git listés dans l'index public (MODULES_INDEX_URL) : celui qui publie l'index s'en porte garant.
 *
 * Tout autre dépôt git est un module PERSONNEL, non vérifié : il s'installe depuis l'admin avec un avertissement explicite
 * (voir installer.ts), jamais d'office. La marketplace sert aussi à restaurer une sauvegarde (backup/restore.ts).
 */
export type MarketplaceEntry = {
  id: string;
  name: LocalizedString;
  description: LocalizedString;
  version?: string;
  icon?: string;
  author?: string;
  kind: "community" | "example" | "recognized";
  /** Les modules livrés se copient du serveur ; les reconnus se clonent depuis `repo`. */
  source: "bundled" | "recognized";
  repo?: string;
  ref?: string;
  /** Dossier du module sur le serveur (source « bundled »). */
  dir?: string;
  /** Ce module vise-t-il l'API de modules de CE framework ? Sinon il est listé mais non installable. */
  compatible: boolean;
};

const BUNDLED: { dir: string; kind: "community" | "example" }[] = [
  { dir: "modules-community", kind: "community" },
  { dir: "modules-examples", kind: "example" },
];

export function appRoot(): string {
  return process.cwd();
}

export function readBundledManifest(dir: string): ParsedManifest | null {
  try {
    const parsed = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")));
    return parsed.ok ? parsed.manifest : null;
  } catch {
    return null;
  }
}

/** Modules livrés avec le framework (manifeste valide uniquement). */
export function listBundled(root = appRoot()): MarketplaceEntry[] {
  const out: MarketplaceEntry[] = [];
  for (const { dir, kind } of BUNDLED) {
    const base = path.join(root, dir);
    let names: string[] = [];
    try { names = fs.readdirSync(base).sort(); } catch { continue; }
    for (const name of names) {
      const full = path.join(base, name);
      if (!fs.statSync(full).isDirectory()) continue;
      const m = readBundledManifest(full);
      if (!m || out.some((e) => e.id === m.id)) continue;
      out.push({ id: m.id, name: m.name, description: m.description ?? "", version: m.version, icon: m.icon, author: m.author, kind, source: "bundled", dir: full, compatible: true });
    }
  }
  return out;
}

/** Tout ce qu'on peut installer en confiance : modules livrés d'abord, puis dépôts reconnus (un livré l'emporte sur un reconnu de même identifiant). */
export async function getMarketplace(opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<MarketplaceEntry[]> {
  const bundled = listBundled(opts.root);
  const remote = (await getCatalogue(opts.fetchImpl)).filter((c) => !bundled.some((b) => b.id === c.id));
  return [
    ...bundled,
    ...remote.map((c): MarketplaceEntry => ({
      id: c.id, name: c.name, description: c.description, version: c.version, icon: c.icon, author: c.author,
      kind: "recognized", source: "recognized", repo: c.repo, ref: c.ref, compatible: c.apiVersion === undefined || c.apiVersion === MODULE_API_VERSION,
    })),
  ];
}

export async function findMarketplaceEntry(id: string, opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<MarketplaceEntry | undefined> {
  return (await getMarketplace(opts)).find((e) => e.id === id);
}

/** D'où vient un module installé ? « marketplace » = livré ou reconnu ; « custom » = dépôt personnel non vérifié. */
export function moduleOrigin(row: { id: string; source: string; repoUrl: string | null }, market: MarketplaceEntry[]): "builtin" | "marketplace" | "custom" {
  if (row.source === "builtin") return "builtin";
  const entry = market.find((e) => e.id === row.id);
  if (!entry) return "custom";
  if (row.source === "bundled") return entry.source === "bundled" ? "marketplace" : "custom";
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return entry.source === "recognized" && norm(entry.repo) === norm(row.repoUrl) ? "marketplace" : "custom";
}

/** D'où vient la liste des dépôts reconnus affichée (dépôt à jour, dernière copie reçue, ou copie livrée avec cette version) ? */
export async function getMarketplaceSource(opts: { fetchImpl?: typeof fetch } = {}): Promise<Pick<CatalogueResult, "source" | "fetchedAt" | "origin">> {
  const { source, fetchedAt, origin } = await getCatalogueDetailed(opts);
  return { source, fetchedAt, origin };
}
