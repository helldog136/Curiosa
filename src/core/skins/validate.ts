/**
 * VALIDATION D'UN DOSSIER DE SKIN (docs/SKINS.md §5, §6, §7 et §13) : manifeste, fichiers, ressources, jetons, feuille de style, lisibilité.
 *
 * C'est LA fonction que partagent l'installation, la mise à jour, l'aperçu avant installation et la commande `skin:check` (scripts/skin-check.mjs) :
 * ce qui passe le contrôle d'un auteur passe l'installation. Elle lit UN dossier local et ne fait rien d'autre : pas de réseau, pas de base de données,
 * pas de Next, pas de minuteur. Elle n'écrit rien et n'exécute rien du skin (une feuille et des jetons sont des données, relues par l'assainisseur).
 *
 * Résultat : `ok` est faux dès qu'un problème de gravité « error » existe (un skin refusé n'est jamais installé). `installFiles` est exactement
 * ce qui sera posé sur le disque (les SVG y sont déjà assainis) ; `fingerprint` en est l'empreinte, relue plus tard pour détecter une altération.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeSvg } from "../svg";
import { FONT_PATH_RE, IMAGE_PATH_RE, SKIN_ID_RE } from "./allowlist";
import { BASIC_ID, FILE_LIMITS, SPDX_ALLOWED } from "./constants";
import { parseSkinManifest, type SkinManifest } from "./manifest";
import { makeIssue, type Params, type SkinIssue } from "./messages";
import { checkReadability, type Mode, type ModulePair, type ReadabilityIssue } from "./readability";
import { sanitizeSkinCss, sanitizeTokenValue } from "./sanitize";
import { coreSatisfies } from "./semver";

export type ValidateOptions = {
  /** Version du cœur qui juge (`minCore`). */
  coreVersion: string;
  /** Nom du dossier du skin : doit être égal à son id. Absent (skin à la racine d'un dépôt) : pas de contrôle. */
  folderName?: string | null;
  /** Id annoncé par le catalogue : le dossier doit servir CE skin. */
  expectId?: string;
  /**
   * Pièces des modules installés (`{ idDuModule: ["piece"] }`), pour la feuille. Fournies = lecture au rendu : une règle qui vise la pièce d'un module absent
   * est retirée de la feuille avec un avertissement (jamais une erreur : le module peut revenir). Absentes = installation : toute pièce bien formée passe.
   */
  moduleParts?: Readonly<Record<string, readonly string[]>>;
  /** Paires de couleurs déclarées par les modules installés (paire 11 de la lisibilité). */
  modulePairs?: readonly ModulePair[];
  /** Ajoute les conseils « confort » (AAA) en avertissements. */
  advice?: boolean;
};

export type FileKind = "manifest" | "tokens" | "stylesheet" | "font" | "image" | "preview" | "license" | "readme";
export type ValidatedFile = { path: string; bytes: number; sha256: string; kind: FileKind };

export type SkinTokens = {
  light: Record<string, string>;
  dark: Record<string, string>;
  common: Record<string, string>;
  modules: Record<string, Record<string, string>>;
};

export type SkinValidation = {
  ok: boolean;
  issues: SkinIssue[];
  manifest?: SkinManifest;
  /** Feuille réécrite (assainie), avec `url(/skins/<id>/<version>/…)`. Vide s'il y a un plafond dépassé ou pas de feuille. */
  css: string;
  /** Jetons réécrits (assainis). */
  tokens?: SkinTokens;
  /** Problèmes de lisibilité, par mode (erreurs et conseils). */
  readability: ReadabilityIssue[];
  files: ValidatedFile[];
  /** Contenu exact à installer (chemin relatif → octets). */
  installFiles: { path: string; content: Buffer }[];
  fingerprint: string;
  totalBytes: number;
};

const ROOT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * Fichiers de NOTES de l'auteur, tolérés à la racine d'un skin (docs/SKINS.md §5.1) : ni lus, ni installés, ni comptés dans l'empreinte, ni refusés.
 * Tout autre fichier hors liste reste refusé (`skin-file-unlisted`).
 */
export const IGNORED_ROOT_FILE_RE = /^(PROGRESS|NOTES|TODO|CHANGELOG|CONTRIBUTING)(\.[a-z]{2})?\.md$/;
const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TOKENS_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/;
const SHEET_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,63}\.css$/;
const PREVIEW_PATH_RE = /^previews\/[a-z0-9][a-z0-9._-]{0,63}\.webp$/;
const LICENSE_FILE_RE = /^LICENSES\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(txt|md)$/;
const README_RE = /^README(\.[a-z]{2})?\.md$/;
const OWN_LICENSE_RE = /^LICENSE(\.md|\.txt)?$/;
const SUBDIRS = ["fonts", "images", "previews", "LICENSES"] as const;
const MAX_TOKENS = 400;

/**
 * Jetons dont la valeur a une NATURE connue : elle est aussi contrôlée comme la propriété CSS correspondante, avec les mêmes minimums que la feuille
 * (taille de texte, interligne…). Un jeton hors de cette liste n'a que le contrôle général de valeur (`sanitizeTokenValue`) ; le vocabulaire complet est
 * celui du lot « jetons » (docs/SKINS.md §4.2).
 */
const TOKEN_PROPERTY: readonly [RegExp, string][] = [
  [/^--sk-text-/, "font-size"], [/^--sk-leading-/, "line-height"], [/^--sk-weight-/, "font-weight"], [/^--sk-tracking-/, "letter-spacing"],
  [/^--sk-radius-/, "border-radius"], [/^--sk-border-width/, "border-width"], [/^--sk-shadow-/, "box-shadow"], [/^--sk-glow$/, "box-shadow"],
  [/^--sk-space$/, "padding"], [/^--sk-(page-width|prose-width)/, "max-width"], [/^--sk-duration$/, "transition-duration"],
];

const kb = (n: number) => Math.ceil(n / 1024);
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

/** Les premiers octets d'un fichier disent s'il est bien de son type (extension et contenu d'accord). */
export function hasSignature(file: string, b: Buffer): boolean {
  if (file.endsWith(".woff2")) return b.length > 8 && b.subarray(0, 4).toString("latin1") === "wOF2";
  if (file.endsWith(".png")) return b.length > 16 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (/\.jpe?g$/.test(file)) return b.length > 10 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (file.endsWith(".webp")) return b.length > 16 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  if (file.endsWith(".avif")) return b.length > 16 && b.subarray(4, 8).toString("latin1") === "ftyp" && /^(avif|avis)$/.test(b.subarray(8, 12).toString("latin1"));
  return false;
}

type Found = { rel: string; abs: string; size: number };

export function validateSkinFolder(dir: string, options: ValidateOptions): SkinValidation {
  try {
    return run(dir, options);
  } catch {
    const issues = [makeIssue("internal-error")];
    return { ok: false, issues, css: "", readability: [], files: [], installFiles: [], fingerprint: "", totalBytes: 0 };
  }
}

function run(dir: string, opts: ValidateOptions): SkinValidation {
  const issues: SkinIssue[] = [];
  const add = (code: string, params: Params = {}) => { issues.push(makeIssue(code, params)); };
  const known: { manifest?: SkinManifest } = {};
  const fail = (): SkinValidation => ({ ok: false, issues: unique(issues), manifest: known.manifest, css: "", readability: [], files: [], installFiles: [], fingerprint: "", totalBytes: 0 });

  // ---- 1. Le dossier : aucun lien symbolique, un seul niveau, des noms simples, des plafonds.
  let manifestPresent = false;
  try { manifestPresent = fs.lstatSync(path.join(dir, "skin.json")).isFile(); } catch { /* absent */ }
  if (!manifestPresent) { add("manifest-missing"); return fail(); }
  const found = scan(dir, add);
  if (!found) return fail();
  const byRel = new Map(found.map((f) => [f.rel, f]));

  // ---- 2. Le manifeste.
  const manifestFile = byRel.get("skin.json");
  if (!manifestFile) { add("manifest-missing"); return fail(); }
  if (manifestFile.size > FILE_LIMITS.manifestBytes) { add("manifest-too-large", { size: kb(manifestFile.size), max: kb(FILE_LIMITS.manifestBytes) }); return fail(); }
  let rawManifest: unknown;
  try { rawManifest = JSON.parse(fs.readFileSync(manifestFile.abs, "utf8").replace(/^﻿/, "")); } catch { add("manifest-unreadable"); return fail(); }
  const parsed = parseSkinManifest(rawManifest);
  if (!parsed.ok) { issues.push(...parsed.issues); return fail(); }
  issues.push(...parsed.warnings);
  const m = parsed.manifest;
  known.manifest = m;

  if (m.id === BASIC_ID || !SKIN_ID_RE.test(m.id)) add("bad-skin-id");
  if (opts.folderName && opts.folderName !== m.id) add("manifest-id-folder", { id: m.id });
  if (opts.expectId && opts.expectId !== m.id) add("manifest-id-expected", { id: m.id });
  if (!SPDX_ALLOWED.includes(m.license)) add("manifest-license-not-allowed", { license: m.license });
  if (!m.minCore) add("manifest-no-mincore");
  else if (!coreSatisfies(m.minCore, opts.coreVersion)) add("manifest-core-newer", { need: m.minCore, have: opts.coreVersion });
  if ((m.previews ?? []).length === 0) add("manifest-no-preview");
  if ((m.previews ?? []).length > FILE_LIMITS.previews) add("previews-too-many", { max: FILE_LIMITS.previews });
  if (hasErrors(issues)) return fail();   // le reste dépend d'un manifeste sain

  // ---- 3. Quels fichiers sont prévus ? Tout le reste est refusé.
  const kinds = new Map<string, FileKind>([["skin.json", "manifest"]]);
  const declare = (rel: string, kind: FileKind, pathRe: RegExp): boolean => {
    if (!pathRe.test(rel)) { add("asset-bad-path", { file: rel }); return false; }
    if (!byRel.has(rel)) { add("asset-missing", { file: rel }); return false; }
    kinds.set(rel, kind);
    return true;
  };
  const tokensRel = m.tokens;
  const hasTokens = declare(tokensRel, "tokens", TOKENS_FILE_RE);
  if (!hasTokens && issues.at(-1)?.code === "asset-missing") { issues.pop(); add("tokens-missing", { file: tokensRel }); }
  let hasSheet = false;
  if (m.stylesheet) {
    hasSheet = declare(m.stylesheet, "stylesheet", SHEET_FILE_RE);
    if (!hasSheet && issues.at(-1)?.code === "asset-missing") { issues.pop(); add("stylesheet-missing", { file: m.stylesheet }); }
  }
  const seenAssets = new Set<string>();
  const assets = [];
  for (const a of m.assets) {
    if (seenAssets.has(a.file)) { add("asset-duplicate", { file: a.file }); continue; }
    seenAssets.add(a.file);
    const re = a.kind === "font" ? FONT_PATH_RE : IMAGE_PATH_RE;
    if (declare(a.file, a.kind, re)) assets.push(a);
  }
  const previews = [];
  for (const p of m.previews ?? []) if (declare(p.file, "preview", PREVIEW_PATH_RE)) previews.push(p);
  for (const f of found) {
    if (kinds.has(f.rel)) continue;
    if (README_RE.test(f.rel) && !f.rel.includes("/")) kinds.set(f.rel, "readme");
    else if (OWN_LICENSE_RE.test(f.rel)) kinds.set(f.rel, "license");
    else if (LICENSE_FILE_RE.test(f.rel)) kinds.set(f.rel, "license");
    else add("skin-file-unlisted", { file: f.rel });
  }

  // ---- 4. Plafonds par famille.
  const fonts = assets.filter((a) => a.kind === "font");
  const images = assets.filter((a) => a.kind === "image");
  if (fonts.length > FILE_LIMITS.fonts) add("fonts-too-many", { max: FILE_LIMITS.fonts });
  if (images.length > FILE_LIMITS.images) add("images-too-many", { max: FILE_LIMITS.images });
  const sizeOf = (rel: string) => byRel.get(rel)?.size ?? 0;
  const fontsTotal = fonts.reduce((n, a) => n + sizeOf(a.file), 0);
  const imagesTotal = images.reduce((n, a) => n + sizeOf(a.file), 0);
  if (fontsTotal > FILE_LIMITS.fontsTotalBytes) add("fonts-total-too-large", { size: kb(fontsTotal), max: kb(FILE_LIMITS.fontsTotalBytes) });
  if (imagesTotal > FILE_LIMITS.imagesTotalBytes) add("images-total-too-large", { size: kb(imagesTotal), max: kb(FILE_LIMITS.imagesTotalBytes) });
  const tooLarge = (rel: string, max: number) => { if (sizeOf(rel) > max) add("file-too-large", { file: rel, size: kb(sizeOf(rel)), max: kb(max) }); };
  for (const a of fonts) tooLarge(a.file, FILE_LIMITS.fontBytes);
  for (const a of images) tooLarge(a.file, a.file.endsWith(".svg") ? FILE_LIMITS.svgBytes : FILE_LIMITS.imageBytes);
  for (const p of previews) tooLarge(p.file, FILE_LIMITS.previewBytes);
  for (const [rel, kind] of kinds) if (kind === "license" || kind === "readme") tooLarge(rel, FILE_LIMITS.textBytes);
  if (hasTokens && sizeOf(tokensRel) > FILE_LIMITS.tokensBytes) add("tokens-too-large", { size: kb(sizeOf(tokensRel)), max: kb(FILE_LIMITS.tokensBytes) });

  // ---- 5. Ressources : licence, signature, SVG assaini.
  const content = new Map<string, Buffer>();
  const read = (rel: string): Buffer => { let b = content.get(rel); if (!b) { b = fs.readFileSync(byRel.get(rel)!.abs); content.set(rel, b); } return b; };
  for (const a of assets) {
    if (!a.license || !a.licenseFile || !a.author || !a.source) { add("asset-license-missing", { file: a.file }); }
    else {
      if (!SPDX_ALLOWED.includes(a.license)) add("asset-license-not-allowed", { file: a.file });
      if (!LICENSE_FILE_RE.test(a.licenseFile) || !byRel.has(a.licenseFile)) add("asset-license-file", { file: a.file });
    }
    if (sizeOf(a.file) > (a.file.endsWith(".svg") ? FILE_LIMITS.svgBytes : a.kind === "font" ? FILE_LIMITS.fontBytes : FILE_LIMITS.imageBytes)) continue;   // déjà signalé : pas la peine de le lire
    const bytes = read(a.file);
    if (a.file.endsWith(".svg")) {
      const clean = sanitizeSvg(bytes.toString("utf8"), undefined, "cover", "center", { maxBytes: FILE_LIMITS.svgBytes, maxElements: 1500 });
      if (!clean.ok) add("asset-svg-refused", { file: a.file });
      else content.set(a.file, Buffer.from(clean.svg, "utf8"));
    } else if (!hasSignature(a.file, bytes)) add("asset-signature", { file: a.file });
  }
  for (const p of previews) if (sizeOf(p.file) <= FILE_LIMITS.previewBytes && !hasSignature(p.file, read(p.file))) add("asset-signature", { file: p.file });

  // ---- 6. Jetons.
  const assetPaths = assets.map((a) => a.file);
  const families = fonts.map((a) => a.family).filter((f): f is string => !!f);
  const assetBase = `/skins/${m.id}/${m.version}/`;
  const sanitizeOpts = { skinId: m.id, assetBase, assets: assetPaths };
  let tokens: SkinTokens | undefined;
  if (hasTokens && sizeOf(tokensRel) <= FILE_LIMITS.tokensBytes) {
    tokens = readTokens(read(tokensRel), m, sanitizeOpts, issues);
  }

  // ---- 7. Feuille de style.
  let css = "";
  if (hasSheet) {   // le plafond de 60 Ko est celui de l'assainisseur (message précis, rien n'est appliqué)
    const sheet = sanitizeSkinCss(read(m.stylesheet!).toString("utf8"), { skinId: m.id, assetBase, assets: assetPaths, fontFamilies: families, moduleParts: opts.moduleParts });
    // Lecture au rendu (`moduleParts` fourni) : la règle qui vise la pièce d'un module absent est retirée par l'assainisseur, le reste du skin s'applique ;
    // ce n'est donc plus une erreur (à l'installation, `moduleParts` est absent et toute pièce bien formée est acceptée).
    issues.push(...sheet.issues.map((i): SkinIssue => (opts.moduleParts && i.code === "unknown-part" ? { ...i, severity: "warning" } : i)));
    css = sheet.css;
    if (sheet.stats.keyframes > 0 && m.supports?.reducedMotion !== true) add("manifest-reduced-motion");
  }

  // ---- 8. Lisibilité, mode par mode.
  const readability: ReadabilityIssue[] = [];
  if (tokens) {
    for (const mode of m.modes as Mode[]) {
      const effective = { ...tokens.common, ...tokens[mode] };
      const found = checkReadability(effective, mode, { skinId: m.id, advice: opts.advice, modulePairs: opts.modulePairs });
      for (const r of found) {
        readability.push(r);
        issues.push({ code: r.code, severity: r.severity === "error" ? "error" : "warning", message: r.message, hint: r.hint });
      }
    }
  }

  // ---- 9. Ce qui sera posé sur le disque, et son empreinte.
  const files: ValidatedFile[] = [];
  const installFiles: { path: string; content: Buffer }[] = [];
  let totalBytes = 0;
  for (const rel of [...kinds.keys()].sort()) {
    const b = read(rel);
    files.push({ path: rel, bytes: b.length, sha256: sha(b), kind: kinds.get(rel)! });
    installFiles.push({ path: rel, content: b });
    totalBytes += b.length;
  }
  const fingerprint = fingerprintOf(files);
  const ok = !hasErrors(issues);
  // Un skin refusé n'a rien à installer.
  return { ok, issues: unique(issues), manifest: m, css, tokens, readability, files, installFiles: ok ? installFiles : [], fingerprint, totalBytes };
}

/** Un même message n'est dit qu'une fois (la même couleur illisible sur deux fonds, par exemple). */
function unique(list: readonly SkinIssue[]): SkinIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => { const k = `${i.code}|${i.message.fr}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export const hasErrors = (issues: readonly SkinIssue[]): boolean => issues.some((i) => i.severity === "error");

/** Empreinte du contenu installé : SHA-256 des couples (chemin, SHA-256 du fichier), triés. */
export function fingerprintOf(files: readonly { path: string; sha256: string }[]): string {
  return sha([...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path}\0${f.sha256}\n`).join(""));
}

/** Parcourt le dossier : refuse liens symboliques, sous-dossiers inconnus ou trop profonds, noms douteux, trop de fichiers ou trop d'octets. null = refus (déjà signalé). */
function scan(dir: string, add: (code: string, params?: Params) => void): Found[] | null {
  const out: Found[] = [];
  let total = 0;
  let bad = false;
  const refuse = (code: string, params: Params) => { add(code, params); bad = true; };
  let st: fs.Stats;
  try { st = fs.lstatSync(dir); } catch { add("manifest-missing"); return null; }
  if (!st.isDirectory()) { add("manifest-missing"); return null; }
  const walk = (abs: string, rel: string, depth: number) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (rel === "" && e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = path.join(abs, e.name);
      if (e.isSymbolicLink()) { refuse("skin-symlink", { file: r }); continue; }
      if (e.isDirectory()) {
        if (depth >= 1) { refuse("skin-too-deep", { file: r }); continue; }
        if (!(SUBDIRS as readonly string[]).includes(e.name)) { refuse("skin-file-unlisted", { file: `${r}/` }); continue; }
        walk(p, r, depth + 1);
        continue;
      }
      if (!e.isFile()) { refuse("skin-file-unlisted", { file: r }); continue; }
      if (depth === 0 && IGNORED_ROOT_FILE_RE.test(e.name)) continue;
      const strict = rel === "fonts" || rel === "images" || rel === "previews";
      if (!(strict ? ASSET_NAME_RE : ROOT_NAME_RE).test(e.name)) { refuse("skin-file-name", { file: r }); continue; }
      const size = fs.lstatSync(p).size;
      out.push({ rel: r, abs: p, size });
      total += size;
      if (out.length > FILE_LIMITS.files) { refuse("skin-too-many-files", { max: FILE_LIMITS.files }); return; }
    }
  };
  walk(dir, "", 0);
  if (!bad && total > FILE_LIMITS.totalBytes) refuse("skin-too-big", { size: kb(total), max: kb(FILE_LIMITS.totalBytes) });
  return bad ? null : out;
}

/** Lit `tokens.json` : forme, noms, valeurs une à une par l'assainisseur (mêmes règles que la feuille), jetons des options. */
function readTokens(bytes: Buffer, m: SkinManifest, so: { skinId: string; assetBase: string; assets: string[] }, issues: SkinIssue[]): SkinTokens | undefined {
  const add = (code: string, params: Params = {}) => { issues.push(makeIssue(code, params)); };
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8").replace(/^﻿/, "")); } catch { add("tokens-unreadable"); return undefined; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { add("tokens-shape", { what: "tokens" }); return undefined; }
  const doc = raw as Record<string, unknown>;
  const out: SkinTokens = { light: {}, dark: {}, common: {}, modules: {} };
  let count = 0;
  const group = (name: string, value: unknown, prefix?: string): Record<string, string> => {
    const target: Record<string, string> = {};
    if (value === undefined) return target;
    if (!value || typeof value !== "object" || Array.isArray(value)) { add("tokens-shape", { what: name }); return target; }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (++count > MAX_TOKENS) { add("tokens-too-many", { max: MAX_TOKENS }); return target; }
      if (!/^--(sk|v)-[a-z0-9][a-z0-9-]{0,60}$/.test(k)) { add("tokens-bad-name", { name: k }); continue; }
      if (prefix && !k.startsWith(prefix)) { add("tokens-module-name", { name: k }); continue; }
      const r = sanitizeTokenValue(k, v, so);
      issues.push(...r.issues);
      if (r.ok && typedCheck(k, r.value, so.skinId, issues)) target[k] = r.value;
    }
    return target;
  };
  out.light = group("light", doc.light);
  out.dark = group("dark", doc.dark);
  out.common = group("common", doc.common);
  for (const mode of ["light", "dark"] as const) if (!m.modes.includes(mode) && Object.keys(out[mode]).length) add("tokens-mode-undeclared", { mode });
  const modules = doc.modules;
  if (modules !== undefined) {
    if (!modules || typeof modules !== "object" || Array.isArray(modules)) add("tokens-shape", { what: "modules" });
    else for (const [id, v] of Object.entries(modules as Record<string, unknown>)) {
      if (!SKIN_ID_RE.test(id)) { add("tokens-module-name", { name: id }); continue; }
      out.modules[id] = group(`modules.${id}`, v, `--sk-m-${id}-`);
    }
  }
  // Les jetons des options sont des valeurs d'apparence comme les autres : mêmes règles.
  for (const o of m.options ?? []) for (const v of o.values) for (const [k, val] of Object.entries(v.tokens)) {
    const r = sanitizeTokenValue(k, val, so);
    issues.push(...r.issues);
    if (r.ok) typedCheck(k, r.value, so.skinId, issues);
  }
  return out;
}

/** Contrôle la valeur d'un jeton de nature connue comme la propriété CSS correspondante (une règle de démonstration passée à l'assainisseur). Vrai si elle passe. */
function typedCheck(name: string, value: string, skinId: string, issues: SkinIssue[]): boolean {
  const prop = TOKEN_PROPERTY.find(([re]) => re.test(name))?.[1];
  if (!prop || /[;{}]/.test(value)) return true;
  const r = sanitizeSkinCss(`[data-skin-region="main"] { ${prop}: ${value}; }`, { skinId });
  if (r.ok) return true;
  for (const i of r.issues) if (i.severity === "error") issues.push({ ...i, line: undefined, column: undefined });
  return false;
}
