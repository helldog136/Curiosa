import fs from "node:fs";
import path from "node:path";

/**
 * IMPORTS STATIQUES DE FICHIERS VOISINS. `import { x } from "./source.mjs"` dans un fichier chargé par le serveur : c'est la cause connue de l'incident où une mise à jour
 * à chaud rendait un module « impossible à charger » (Node gardait l'ancienne copie du voisin). Depuis le cœur 0.2.13 le cœur charge chaque version depuis une copie neuve
 * (voir snapshot.ts) : ces modules fonctionnent. Mais sur un cœur plus ancien, ou si le module est essayé hors du cœur, ils restent fragiles : on le SIGNALE (jamais un refus).
 *
 * Détection par lecture du texte (pas d'exécution) : approximative mais prudente. Bornée : 200 fichiers, 512 Ko chacun. Le dossier `scripts/` (scripts du navigateur) et `node_modules` sont ignorés.
 */
export type NeighbourImport = { file: string; specifier: string };

const MAX_FILES = 200;
const MAX_BYTES = 512 * 1024;
const CODE = /\.(mjs|js)$/;
const SKIP = new Set([".git", "node_modules"]);

/** Enlève les commentaires (// et /* *​/) sans toucher à « https://… » dans un texte. */
const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;,{}()[\]=])\/\/[^\n]*/g, "$1");

// Début de ligne, `import`/`export`, éventuellement une liste de noms puis `from`, puis une adresse RELATIVE entre guillemets. `import("./x")` (dynamique) n'est pas concerné.
const STATIC_RELATIVE = /^[ \t]*(?:import|export)\s*(?:[^'"`;()]*?\bfrom\s*)?(["'])(\.{1,2}\/[^"'\n]+)\1/gm;

/** Les imports statiques relatifs que contient ce texte de code. */
export function staticRelativeImports(code: string): string[] {
  return [...stripComments(code).matchAll(STATIC_RELATIVE)].map((m) => m[2]!);
}

function listCode(dir: string, rel = "", out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= MAX_FILES || SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (r !== "scripts") listCode(dir, r, out); }
    else if (CODE.test(entry.name)) out.push(r);
  }
  return out;
}

/** Les fichiers du dossier d'un module qui importent un voisin de façon statique. Ne lève jamais (dossier illisible : liste vide). */
export function staticNeighbourImports(dir: string): NeighbourImport[] {
  const out: NeighbourImport[] = [];
  try {
    for (const file of listCode(dir)) {
      const full = path.join(dir, file);
      if (fs.statSync(full).size > MAX_BYTES) continue;
      for (const specifier of staticRelativeImports(fs.readFileSync(full, "utf8"))) out.push({ file, specifier });
    }
  } catch { /* illisible : rien à signaler */ }
  return out;
}

/** Avertissement prêt à afficher (ou null) : les fichiers concernés, sans doublon. */
export function staticImportsWarning(dir: string): { code: "staticImports"; files: string[] } | null {
  const files = [...new Set(staticNeighbourImports(dir).map((i) => i.file))];
  return files.length ? { code: "staticImports", files: files.slice(0, 20) } : null;
}
