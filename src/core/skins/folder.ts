/**
 * Lecture d'un skin INSTALLÉ sur le disque (`DATA_DIR/skins/<id>/<version>/`, docs/SKINS.md §5.6) : manifeste, jetons et feuille. L'installation elle-même
 * (clone, validation complète, mise à jour atomique…) est un autre lot ; ici on ne fait que LIRE ce qui s'y trouve, avec prudence, et assainir la feuille
 * (`sanitizeSkinCss`) : le fichier source n'est jamais servi, seule la sortie assainie est écrite dans la page.
 *
 * Aucun réseau, aucun minuteur. Le cache est invalidé par l'EMPREINTE des trois fichiers (taille + date de modification) : remplacer un fichier suffit.
 */
import fs from "node:fs";
import path from "node:path";
import { isGlowLevel } from "../glow";
import { isHeaderLayout } from "../header";
import { SKINS_DIR } from "./paths";
import { SKIN_ID_RE } from "./allowlist";
import { makeIssue, type SkinIssue } from "./messages";
import { partsSignature } from "./moduleSkin";
import { sanitizeSkinCss } from "./sanitize";
import type { Mode, SkinDefaults, SkinDefinition, SkinOption, SkinTokensFile } from "./types";

/** Version du contrat de skin que ce cœur comprend (docs/SKINS.md §5.2 `skinContract`). */
export const SKIN_CONTRACT = 1;

const MAX_JSON_BYTES = 64 * 1024;
const MAX_CSS_BYTES = 80 * 1024;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,40}$/;

export type LoadedSkin = { skin: SkinDefinition; issues: SkinIssue[] };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const textOf = (v: unknown, fallback: string) => {
  const o = isObject(v) ? v : {};
  const fr = typeof o.fr === "string" && o.fr.trim() ? o.fr.trim().slice(0, 200) : fallback;
  const en = typeof o.en === "string" && o.en.trim() ? o.en.trim().slice(0, 200) : fr;
  return { fr, en };
};

function readLimited(file: string, max: number): string | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function stringMap(v: unknown, max = 400): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string" || n++ >= max) continue;
    out[k] = val;
  }
  return out;
}

function tokensFile(v: unknown): SkinTokensFile {
  const o = isObject(v) ? v : {};
  const modules: Record<string, Record<string, string>> = {};
  if (isObject(o.modules)) for (const [id, t] of Object.entries(o.modules).slice(0, 80)) modules[id] = stringMap(t, 24);
  return { light: stringMap(o.light), dark: stringMap(o.dark), common: stringMap(o.common), modules };
}

function optionsOf(v: unknown): SkinOption[] {
  if (!Array.isArray(v)) return [];
  const out: SkinOption[] = [];
  for (const raw of v.slice(0, 8)) {
    if (!isObject(raw) || typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(raw.id) || !Array.isArray(raw.values)) continue;
    const values = raw.values.slice(0, 8).flatMap((x: unknown) => (isObject(x) && typeof x.id === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(x.id) ? [{ id: x.id, label: textOf(x.label, x.id), tokens: stringMap(x.tokens, 40) }] : []));
    if (values.length === 0) continue;
    const def = typeof raw.default === "string" && values.some((x) => x.id === raw.default) ? raw.default : values[0]!.id;
    out.push({ id: raw.id, label: textOf(raw.label, raw.id), default: def, values });
  }
  return out;
}

function defaultsOf(v: unknown): SkinDefaults {
  const o = isObject(v) ? v : {};
  const out: SkinDefaults = {};
  if (isHeaderLayout(o.headerLayout)) out.headerLayout = o.headerLayout;
  if (o.font === "sans" || o.font === "serif" || o.font === "mono" || o.font === "skin") out.font = o.font;
  if (isGlowLevel(o.glow) && o.glow !== "custom") out.glow = o.glow;
  if (o.background === "none" || o.background === "dusk" || o.background === "grid") out.background = o.background;
  else if (Array.isArray(o.background) && o.background.length <= 6) out.background = o.background;
  return out;
}

/** Lit un dossier de skin. `null` si ce n'est pas un skin utilisable (le cœur applique alors basic). Ne lève jamais. */
export function readSkinFolder(dir: string, expectedId: string, version: string, moduleParts?: Readonly<Record<string, readonly string[]>>): LoadedSkin | null {
  try {
    if (!SKIN_ID_RE.test(expectedId) || expectedId === "basic" || !VERSION_RE.test(version)) return null;
    const manifestText = readLimited(path.join(dir, "skin.json"), MAX_JSON_BYTES);
    if (manifestText === null) return null;
    const manifest: unknown = JSON.parse(manifestText);
    if (!isObject(manifest) || manifest.id !== expectedId) return null;
    const contract = manifest.skinContract;
    if (typeof contract !== "number" || !Number.isInteger(contract) || contract < 1 || contract > SKIN_CONTRACT) return null;
    const modes = (["light", "dark"] as const).filter((m): m is Mode => Array.isArray(manifest.modes) && manifest.modes.includes(m));
    if (modes.length === 0) return null;
    const tokensName = typeof manifest.tokens === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(manifest.tokens) ? manifest.tokens : "tokens.json";
    const tokensText = readLimited(path.join(dir, tokensName), MAX_JSON_BYTES);
    const tokens = tokensFile(tokensText ? JSON.parse(tokensText) : {});
    const cssName = typeof manifest.stylesheet === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(manifest.stylesheet) ? manifest.stylesheet : null;
    const cssText = cssName ? readLimited(path.join(dir, cssName), MAX_CSS_BYTES) : "";
    const assets = Array.isArray(manifest.assets) ? manifest.assets.flatMap((a: unknown) => (isObject(a) && typeof a.file === "string" ? [a] : [])) : [];
    const clean = sanitizeSkinCss(cssText ?? "", {
      skinId: expectedId,
      assetBase: `/skins/${expectedId}/${version}/`,
      assets: assets.map((a) => String(a.file)),
      fontFamilies: assets.flatMap((a) => (typeof a.family === "string" ? [a.family] : [])),
      moduleParts, // les pièces des modules installés : une règle qui vise la pièce d'un module absent est retirée au rendu (sans toucher au skin installé)
    });
    const issues: SkinIssue[] = [...clean.issues];
    if (cssText === null) issues.push(makeIssue("css-not-text", {}));
    return {
      issues,
      skin: {
        id: expectedId,
        version,
        name: textOf(manifest.name, expectedId),
        modes,
        tokens,
        css: clean.css,
        defaults: defaultsOf(manifest.defaults),
        options: optionsOf(manifest.options),
        deriveFromBackground: false,
        colorScheme: true,
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cache : invalidé par l'empreinte des fichiers (aucun minuteur)

type Entry = { stamp: string; loaded: LoadedSkin | null };
const CACHE = new Map<string, Entry>();
const MAX_ENTRIES = 12;

function stampOf(dir: string): string {
  const parts: string[] = [];
  try {
    for (const f of fs.readdirSync(dir).sort().slice(0, 80)) {
      if (!/\.(json|css)$/.test(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      parts.push(`${f}:${st.size}:${Math.round(st.mtimeMs)}`);
    }
  } catch {
    return "absent";
  }
  return parts.join("|") || "empty";
}

/** Le skin installé `<id>` en version `<version>` (null s'il manque ou s'il est inutilisable). Les appels répétés ne relisent rien tant que les fichiers ne changent pas. */
export function loadInstalledSkin(id: string, version: string, root: string = SKINS_DIR, moduleParts?: Readonly<Record<string, readonly string[]>>): LoadedSkin | null {
  if (!SKIN_ID_RE.test(id) || !VERSION_RE.test(version)) return null;
  const dir = path.join(root, id, version);
  const key = dir;
  const stamp = `${stampOf(dir)}#${moduleParts ? partsSignature(moduleParts) || "none" : "any"}`;
  const hit = CACHE.get(key);
  if (hit && hit.stamp === stamp) return hit.loaded;
  const loaded = stamp.startsWith("absent#") ? null : readSkinFolder(dir, id, version, moduleParts);
  CACHE.delete(key);
  CACHE.set(key, { stamp, loaded });
  while (CACHE.size > MAX_ENTRIES) CACHE.delete(CACHE.keys().next().value as string);
  return loaded;
}

/** Vide le cache des skins lus (installation, mise à jour ou retrait d'un skin). */
export function invalidateSkinFiles(): void {
  CACHE.clear();
}
