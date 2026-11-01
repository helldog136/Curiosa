/**
 * LES POLICES ENVOYÉES PAR LA PERSONNE (docs/POLICES.md) : envoi, liste, suppression. Réservé à l'administration humaine (jamais aux assistants IA).
 *
 *  - un fichier `.woff2` à la fois, 150 Ko au plus, 4 fichiers au plus par site (les graisses et styles d'une même famille) ;
 *  - les OCTETS sont vérifiés (`checkWoff2`) avant d'écrire quoi que ce soit : le fichier est refusé s'il n'est pas une vraie police WOFF2 ;
 *  - la personne COCHE « J'ai le droit d'utiliser cette police » : c'est elle qui engage sa licence ; sans la case, rien n'est envoyé ;
 *  - le fichier s'appelle `u-<empreinte>.woff2` et vit sous `DATA_DIR/fonts/` (la sauvegarde l'emporte avec les réglages) ; la liste est dans `theme.fontFiles` ;
 *  - jamais exécuté, jamais servi sous un autre type que `font/woff2` ;
 *  - supprimer la dernière graisse d'une famille choisie remet les titres ou le texte sur « celle du skin ».
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FONTS_DIR } from "../config";
import { prisma } from "../db";
import { audit } from "../permissions";
import { deleteSetting, setSetting } from "../settings";
import { invalidateSkinCache } from "../skins/invalidate";
import { looksLikeSfnt, sfntToWoff2, type SfntCode } from "./sfnt";
import { checkWoff2, cleanFontName, familySlug, type FontCheckCode } from "./woff2";
import { sanitizeUploads, uploadFileName, UPLOAD_NAME_RE } from "./registry";
import { parseChoice, SETTING_BODY, SETTING_FILES, SETTING_HEADING, UPLOAD_LIMITS, type UploadedFont } from "./types";

export { sanitizeUploads, uploadFamilies, uploadFileName, uploadUrl, uploadWeights, UPLOAD_NAME_RE } from "./registry";

export type UploadErrorCode = FontCheckCode | SfntCode | "converted-large" | "license" | "limit" | "duplicate" | "style" | "name" | "write";

/** Lecture directe en base : juste après une écriture, la liste lue doit être la nouvelle (jamais le cache de la requête). */
export async function listUploads(): Promise<UploadedFont[]> {
  const row = await prisma.setting.findFirst({ where: { key: SETTING_FILES, locale: "" } });
  if (!row) return [];
  try { return sanitizeUploads(JSON.parse(row.value)); } catch { return []; }
}

// Un seul envoi ou retrait à la fois (le test « 4 fichiers au plus » et l'écriture de la liste ne doivent pas se croiser).
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const next = chain.then(fn, fn); chain = next.catch(() => {}); return next; };

export type UploadResult = { ok: true; font: UploadedFont; detected: { weight: string; style: string; variable: boolean } } | { ok: false; code: UploadErrorCode; field: "font" | "name" | "license" };

export function addUpload(input: { bytes: Buffer; name?: string; accepted: boolean; actor: string; dir?: string }): Promise<UploadResult> {
  return serial(async () => {
    const fail = (code: UploadErrorCode, field: "font" | "name" | "license" = "font"): UploadResult => ({ ok: false, code, field });
    if (!input.accepted) return fail("license", "license");
    const dir = input.dir ?? FONTS_DIR;
    // .ttf et .otf : convertis en WOFF2 (docs/POLICES.md), puis le résultat est revérifié comme un envoi WOFF2 ; seul le WOFF2 est gardé.
    let bytes = input.bytes;
    if (bytes.length > UPLOAD_LIMITS.maxInputBytes) return fail("too-large");
    if (looksLikeSfnt(bytes) && bytes.readUInt32BE(0) !== 0x774f4646) {
      const c = await sfntToWoff2(bytes);
      if (!c.ok) return fail(c.code);
      if (c.woff2.length > UPLOAD_LIMITS.maxBytes) return fail("converted-large");
      bytes = c.woff2;
    }
    const check = checkWoff2(bytes);
    if (!check.ok) return fail(check.code);
    const typed = cleanFontName(input.name ?? "");
    if ((input.name ?? "").trim() !== "" && typed === "") return fail("name", "name");
    const family = typed || check.family;
    const slug = familySlug(family);
    if (!family || !slug) return fail("name", "name");
    const id = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const list = await listUploads();
    if (list.some((f) => f.id === id)) return fail("duplicate");
    if (list.length >= UPLOAD_LIMITS.maxFiles) return fail("limit");
    if (list.some((f) => f.slug === slug && f.weight === check.weight && f.style === check.style)) return fail("style");
    // La famille garde un seul nom d'affichage : celui de la première graisse envoyée.
    const known = list.find((f) => f.slug === slug);
    const font: UploadedFont = { id, family: known?.family ?? family, slug, weight: check.weight, style: check.style, bytes: bytes.length, addedAt: new Date().toISOString() };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, uploadFileName(id));
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, bytes, { mode: 0o640 });
      fs.renameSync(tmp, target);
    } catch { return fail("write"); }
    await setSetting(SETTING_FILES, [...list, font]);
    invalidateSkinCache();
    await audit(input.actor, "appearance.font.add", `${font.family} ${font.weight} ${font.style}`);
    return { ok: true, font, detected: { weight: check.weight, style: check.style, variable: check.variable } };
  });
}

/** Retire un fichier envoyé. Si plus aucune graisse de sa famille ne reste et que cette famille était choisie, le choix revient à « celle du skin ». */
export function removeUpload(id: string, opts: { actor: string; dir?: string }): Promise<{ ok: true; family: string; reset: ("heading" | "body")[] } | { ok: false }> {
  return serial(async () => {
    const list = await listUploads();
    const gone = list.find((f) => f.id === id);
    if (!gone) return { ok: false as const };
    const rest = list.filter((f) => f.id !== id);
    if (rest.length) await setSetting(SETTING_FILES, rest); else await deleteSetting(SETTING_FILES);
    try { fs.rmSync(path.join(opts.dir ?? FONTS_DIR, uploadFileName(id)), { force: true }); } catch { /* fichier déjà absent */ }
    const reset = rest.some((f) => f.slug === gone.slug) ? [] : await forgetFamily(gone.slug);
    invalidateSkinCache();
    await audit(opts.actor, "appearance.font.remove", `${gone.family} ${gone.weight}`);
    return { ok: true as const, family: gone.family, reset };
  });
}

/** Les choix qui visaient cette famille (disparue) reviennent à « celle du skin ». */
async function forgetFamily(slug: string): Promise<("heading" | "body")[]> {
  const out: ("heading" | "body")[] = [];
  for (const [key, role] of [[SETTING_HEADING, "heading"], [SETTING_BODY, "body"]] as const) {
    const row = await prisma.setting.findFirst({ where: { key, locale: "" } });
    if (!row) continue;
    let v: unknown;
    try { v = JSON.parse(row.value); } catch { continue; }
    const c = parseChoice(v);
    if (c.kind === "up" && c.id === slug) { await deleteSetting(key); out.push(role); }
  }
  return out;
}

/**
 * Après une restauration : la liste de la sauvegarde et les fichiers de la sauvegarde doivent s'accorder. Une entrée sans fichier (ou dont le fichier n'est
 * plus une vraie police) est retirée, un fichier sans entrée est effacé, un choix qui visait une famille disparue revient à « celle du skin ».
 */
export async function reconcileUploads(dir: string = FONTS_DIR): Promise<{ kept: number; dropped: number }> {
  const list = await listUploads();
  const keep: UploadedFont[] = [];
  for (const f of list) {
    try {
      const bytes = fs.readFileSync(path.join(dir, uploadFileName(f.id)));
      const sameHash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16) === f.id;
      if (sameHash && checkWoff2(bytes).ok) keep.push(f);
    } catch { /* absent */ }
  }
  try {
    for (const name of fs.readdirSync(dir)) if (UPLOAD_NAME_RE.test(name) && !keep.some((f) => uploadFileName(f.id) === name)) fs.rmSync(path.join(dir, name), { force: true });
  } catch { /* pas de dossier */ }
  if (keep.length !== list.length) { if (keep.length) await setSetting(SETTING_FILES, keep); else await deleteSetting(SETTING_FILES); }
  for (const slug of new Set(list.map((f) => f.slug))) if (!keep.some((f) => f.slug === slug)) await forgetFamily(slug);
  invalidateSkinCache();
  return { kept: keep.length, dropped: list.length - keep.length };
}
