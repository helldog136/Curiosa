import fs from "node:fs";
import path from "node:path";
import { MODULE_API_VERSION } from "../config";
import { getRecognized, getRecognizedDetailed, type RecognizedResult } from "./recognized";
import { parseManifest, type ParsedManifest } from "./manifest";
import type { LocalizedString } from "./types";

/**
 * MARKETPLACE — la liste des modules que l'on peut installer en confiance, et rien d'autre.
 *
 *   bundled      modules livrés AVEC le framework (dossier `extras/`, instantané du dépôt de modules `curiosa-extras` embarqué à la publication) : installés depuis
 *                les fichiers du serveur, sans réseau ; leur version suit celle du framework.
 *   recognized   dépôts git listés dans l'index public (MODULES_INDEX_URL) : celui qui publie l'index s'en porte garant.
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
  /** Les modules livrés se copient du serveur ; les reconnus se clonent depuis `repo`. */
  source: "bundled" | "recognized";
  repo?: string;
  ref?: string;
  /** Dossier du module dans `repo` quand ce dépôt en regroupe plusieurs (source « recognized »). */
  subdir?: string;
  /** Dossier du module sur le serveur (source « bundled »). */
  dir?: string;
  /** Ce module vise-t-il l'API de modules de CE framework ? Sinon il est listé mais non installable. */
  compatible: boolean;
};

const BUNDLED: { dir: string; kind: "community" | "example" }[] = [
  { dir: "modules", kind: "community" },
  { dir: "examples", kind: "example" },
];

/** Dossier des modules livrés : `extras/` à côté de l'application (instantané de curiosa-extras), ou celui que désigne CURIOSA_EXTRAS_DIR. */
export function appRoot(): string {
  return process.env.CURIOSA_EXTRAS_DIR ?? path.join(process.cwd(), "extras");
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
export function listBundled(root = appRoot()): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
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
export async function getCatalogue(opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<CatalogueEntry[]> {
  const bundled = listBundled(opts.root);
  const remote = (await getRecognized(opts.fetchImpl)).filter((c) => !bundled.some((b) => b.id === c.id));
  return [
    ...bundled,
    ...remote.map((c): CatalogueEntry => ({
      id: c.id, name: c.name, description: c.description, version: c.version, icon: c.icon, author: c.author,
      kind: "recognized", source: "recognized", repo: c.repo, ref: c.ref, subdir: c.subdir, compatible: c.apiVersion === undefined || c.apiVersion === MODULE_API_VERSION,
    })),
  ];
}

export async function findCatalogueEntry(id: string, opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<CatalogueEntry | undefined> {
  return (await getCatalogue(opts)).find((e) => e.id === id);
}

/** D'où vient un module installé ? « catalogue » = livré ou reconnu ; « custom » = dépôt personnel non vérifié. */
export function moduleOrigin(row: { id: string; source: string; repoUrl: string | null; subdir?: string | null }, market: CatalogueEntry[]): "catalogue" | "custom" {
  const entry = market.find((e) => e.id === row.id);
  if (!entry) return "custom";
  if (row.source === "bundled") return entry.source === "bundled" ? "catalogue" : "custom";
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return entry.source === "recognized" && norm(entry.repo) === norm(row.repoUrl) && (entry.subdir ?? null) === (row.subdir ?? null) ? "catalogue" : "custom";
}

/** D'où vient la liste des dépôts reconnus affichée (dépôt à jour, dernière copie reçue, ou copie livrée avec cette version) ? */
export async function getCatalogueSource(opts: { fetchImpl?: typeof fetch } = {}): Promise<Pick<RecognizedResult, "source" | "fetchedAt" | "origin">> {
  const { source, fetchedAt, origin } = await getRecognizedDetailed(opts);
  return { source, fetchedAt, origin };
}
