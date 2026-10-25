import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { DATA_DIR } from "../config";
import type { ParsedManifest } from "./manifest";

const run = promisify(execFile);

/**
 * CONTRÔLE DE CHARGEMENT. Avant de basculer sur une nouvelle version d'un module (installation, mise à jour, réinstallation, restauration), le cœur vérifie que son code SE CHARGE :
 *   1. dans un processus Node tout neuf (`preflightModule`) : le fichier principal est importé avec TOUS ses imports (voisins compris), sans rien d'en mémoire de l'ancienne version ;
 *      ce processus n'a ni la base ni les secrets du site (environnement vide) et ne vit que le temps du contrôle ;
 *   2. puis dans le processus du site, depuis une copie neuve (voir registry.ts, `verifyModuleLoad`) : c'est ce que le site exécutera réellement.
 * Dans les deux cas : le fichier principal existe et s'importe, il exporte par défaut un objet, et chaque morceau (sections, routes, actions…) a la forme attendue (même règle que
 * l'exigence « def.loads » de la suite de conformité). Un échec défait l'opération : l'ancienne version reste (ou rien n'est installé) et la raison est gardée (blockedUpdate.ts).
 */
export class LoadCheckFailed extends Error {
  readonly reason: string;
  constructor(reason: string) { super(`load check failed: ${reason}`); this.name = "LoadCheckFailed"; this.reason = reason; }
}

export type Shape = string | { [key: string]: Shape };
const FN = (v: unknown) => v === "function";
const isMap = (v: unknown): v is { [key: string]: Shape } => !!v && typeof v === "object";

/** Forme d'une valeur (types seulement, 3 niveaux) : ce que le processus de contrôle renvoie et ce que `shapeProblems` lit. Le même texte, en JavaScript pur, est dans CHILD_SCRIPT. */
export function describeShape(value: unknown, depth = 3): Shape {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") {
    if (depth <= 0) return "object";
    const out: { [key: string]: Shape } = {};
    for (const k of Object.keys(value).slice(0, 200)) out[k] = describeShape((value as Record<string, unknown>)[k], depth - 1);
    return out;
  }
  return value === null ? "null" : typeof value;
}

/** Problèmes de forme de ce qu'un module exporte par défaut (liste vide = rien à signaler). `shape` = `describeShape` de l'export par défaut. */
export function shapeProblems(shape: Shape | undefined): string[] {
  const out: string[] = [];
  if (!isMap(shape)) return ["the main file must export by default an object (export default { … })"];
  for (const group of ["sections", "slots", "routes", "exports", "adminActions", "adminDownloads", "mcp", "tasks", "services", "migrations"]) {
    const g = shape[group];
    if (g === undefined) continue;
    if (!isMap(g)) { out.push(`"${group}" must be an object`); continue; }
    for (const [k, v] of Object.entries(g)) {
      if (group === "tasks") { if (!isMap(v) || !FN(v.run)) out.push(`task "${k}" needs a "run" function`); }
      else if (group === "services") { if (!isMap(v)) out.push(`service "${k}" must be an object of functions`); else for (const [meth, f] of Object.entries(v)) if (!FN(f)) out.push(`method "${meth}" of service "${k}" must be a function`); }
      else if (group === "adminActions" && isMap(v) && FN(v.run)) continue;       // forme { right, run }
      else if (group === "adminDownloads") { if (!isMap(v) || !FN(v.generate) || !FN(v.filename)) out.push(`download "${k}" needs "filename" and "generate" functions`); }
      else if (!FN(v)) out.push(`${group}.${k} must be a function`);
    }
  }
  for (const k of ["page", "overlay", "news", "adminBadge", "adminPanel"]) if (shape[k] !== undefined && !FN(shape[k])) out.push(`"${k}" must be a function`);
  const panels = shape.entryPanels;
  if (panels !== undefined) {
    if (!isMap(panels)) out.push('"entryPanels" must be an object');
    else for (const [k, v] of Object.entries(panels)) if (!isMap(v) || !FN(v.render)) out.push(`editor section "${k}" needs a "render" function`);
  }
  return out;
}

/** Raison courte, sans chemin du serveur ni saut de ligne (elle est écrite au journal, montrée à l'assistant et gardée). */
export function cleanReason(error: unknown, dataDir: string = DATA_DIR): string {
  const text = error instanceof Error ? `${error.name === "Error" ? "" : `${error.name}: `}${error.message}` : String(error);
  return text.split(dataDir).join("<data>").replace(/file:\/\/\S*?<data>/g, "<data>").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Le script exécuté par le processus de contrôle (JavaScript pur : il ne dépend d'aucun fichier du cœur). */
export const CHILD_SCRIPT = `
const describe = (v, d) => {
  if (typeof v === "function") return "function";
  if (Array.isArray(v)) return "array";
  if (v && typeof v === "object") { if (d <= 0) return "object"; const o = {}; for (const k of Object.keys(v).slice(0, 200)) o[k] = describe(v[k], d - 1); return o; }
  return v === null ? "null" : typeof v;
};
let out;
try {
  const m = await import(process.argv[1]);
  out = { ok: true, hasDefault: "default" in m, shape: describe(m.default, 3) };
} catch (e) {
  out = { ok: false, error: (e && e.name && e.name !== "Error" ? e.name + ": " : "") + String((e && e.message) || e).slice(0, 400) };
}
process.stdout.write("\\n@@" + JSON.stringify(out) + "@@\\n", () => process.exit(0));
`;

export type PreflightResult = { ok: true; ran: boolean } | { ok: false; reason: string };
export const PREFLIGHT_TIMEOUT_MS = 15_000;

/**
 * Importe le module du dossier `dir` dans un processus tout neuf et vérifie la forme de son export. Un module sans fichier principal (module à contenu) n'a rien à importer.
 * Si le processus de contrôle ne peut pas être lancé (programme introuvable…), le contrôle est « non fait » (`ran: false`) et NE bloque PAS : le contrôle dans le processus du site reste.
 */
export async function preflightModule(dir: string, manifest: Pick<ParsedManifest, "main">, opts: { timeoutMs?: number; execPath?: string } = {}): Promise<PreflightResult> {
  if (!manifest.main) return { ok: true, ran: false };
  const file = pathToFileURL(path.join(dir, manifest.main)).href;
  try {
    const { stdout } = await run(opts.execPath ?? process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT, "--", file], {
      cwd: os.tmpdir(), env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV }, timeout: opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true,
    });
    return interpret(stdout);
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stdout?: string; stderr?: string };
    if (e.code === "ENOENT" || e.code === "EACCES" || e.code === "EAGAIN" || e.code === "EMFILE") return { ok: true, ran: false };
    if (e.killed || e.signal) return { ok: false, reason: "the module did not finish loading in time (its top-level code never ends)" };
    const verdict = e.stdout ? interpret(e.stdout) : null;
    if (verdict && !verdict.ok) return verdict;
    return { ok: false, reason: cleanReason(e.stderr?.trim().split("\n").filter(Boolean).slice(-1)[0] ?? e.message) };
  }
}

function interpret(stdout: string): PreflightResult {
  const m = /@@(.*)@@/s.exec(stdout);
  if (!m) return { ok: false, reason: "the module's code printed nothing usable while loading" };
  let verdict: { ok: boolean; error?: string; hasDefault?: boolean; shape?: Shape };
  try { verdict = JSON.parse(m[1]!); } catch { return { ok: false, reason: "the load check gave an unreadable answer" }; }
  if (!verdict.ok) return { ok: false, reason: cleanReason(verdict.error ?? "unknown error") };
  if (!verdict.hasDefault) return { ok: false, reason: "the main file has no default export (export default { … })" };
  const problems = shapeProblems(verdict.shape);
  return problems.length ? { ok: false, reason: problems.slice(0, 3).join("; ") } : { ok: true, ran: true };
}
