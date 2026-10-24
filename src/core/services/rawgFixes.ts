import { prisma } from "@/core/db";
import { titleKey } from "./rawgMatch";

/**
 * CORRECTIONS DE JAQUETTES et JOURNAL « à vérifier » — le cœur est l'unique propriétaire de la donnée « jaquette d'un jeu ».
 *
 * Stockage choisi : deux RÉGLAGES JSON bornés (pas de nouvelle table). Une correction est une petite ligne (titre, choix, chemin d'image) ; il y en a quelques
 * dizaines en pratique et au plus 1000 ; un réglage est déjà dans la sauvegarde et la restauration, sans migration (une sauvegarde d'avant n'en a simplement pas).
 *   rawg.fixes    { "<titre normalisé>": Fix }   les choix de la propriétaire ; sauvegardé
 *   rawg.toCheck  [ Doubtful, … ]                les 100 derniers titres douteux ; un journal, donc hors sauvegarde (il se remplit tout seul)
 * Une image n'est JAMAIS une adresse libre : seul l'hôte `media.rawg.io` et un chemin `/media/…` valide sont acceptés, et c'est le CHEMIN qui est gardé
 * (l'hôte est écrit par le cœur, jamais lu). Le cœur ne télécharge aucune image : il ne fait que garder cette adresse.
 */
export const FIXES_SETTING = "rawg.fixes";
export const TO_CHECK_SETTING = "rawg.toCheck";
export const MAX_FIXES = 1000;
export const MAX_FIX_TITLE = 120;
export const MAX_TO_CHECK = 100;
/** Un titre douteux que personne n'a regardé depuis ce temps sort de la liste (purge à la lecture, aucun minuteur). */
export const TO_CHECK_DAYS = 60;

const IMAGE_HOST = "media.rawg.io";
const IMAGE_PATH = /^\/media\/[A-Za-z0-9_.\-/]{1,200}\.(?:png|jpe?g|webp)$/;

/** Le chemin (`/media/…`) d'une adresse d'image RAWG, ou null si elle n'est pas permise (https, hôte `media.rawg.io`, sans port, identifiant, paramètre ni détour). */
export function rawgImagePath(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 400 || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (u.href !== input) return null; // forme canonique seulement : aucun %2e%2e, aucun port par défaut, rien que le parseur ait « arrangé »
  if (u.protocol !== "https:" || u.hostname !== IMAGE_HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname.includes("..") || u.pathname.includes("//") || u.pathname.includes("%") || !IMAGE_PATH.test(u.pathname)) return null;
  return u.pathname;
}
export const rawgImageUrl = (path: string): string => `https://${IMAGE_HOST}${path}`;

export type FixKind = "game" | "none" | "image";
/** Le choix de la propriétaire pour un titre. `img` : chemin d'image (absent pour « aucune jaquette »). */
export type Fix = { title: string; kind: FixKind; rawgId?: number; name?: string; img?: string; at: string };
export type Doubtful = { key: string; title: string; name: string; rawgId?: number; img: string; candidates: number; at: string };

const cleanText = (v: unknown, max: number): string => String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
const isDate = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Une correction lue dans la base ou dans une sauvegarde : tout ce qui n'est pas parfaitement valide est écarté (jamais d'exception, jamais d'adresse non permise). */
function sanitizeFix(v: unknown): Fix | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const title = cleanText(r.title, MAX_FIX_TITLE);
  if (!title || (r.kind !== "game" && r.kind !== "none" && r.kind !== "image")) return null;
  const at = isDate(r.at) ? r.at : new Date(0).toISOString();
  if (r.kind === "none") return { title, kind: "none", at };
  if (typeof r.img !== "string" || rawgImagePath(rawgImageUrl(r.img)) !== r.img) return null;
  const rawgId = typeof r.rawgId === "number" && Number.isSafeInteger(r.rawgId) && r.rawgId > 0 ? r.rawgId : undefined;
  if (r.kind === "game" && rawgId === undefined) return null;
  const name = cleanText(r.name, 150);
  return { title, kind: r.kind, ...(rawgId !== undefined ? { rawgId } : {}), ...(name ? { name } : {}), img: r.img, at };
}

type FixMap = Record<string, Fix>;

async function readRaw(key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}
async function writeRaw(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value: json }, update: { value: json } });
}

/** Toutes les corrections valides (au plus 1000). */
export async function readFixes(): Promise<FixMap> {
  const raw = await readRaw(FIXES_SETTING);
  const out: FixMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FIXES) break;
    const fix = sanitizeFix(v);
    if (fix && k === titleKey(fix.title)) out[k] = fix;
  }
  return out;
}

/** La correction de ce titre, ou null. Ne lève jamais. */
export async function fixFor(title: string): Promise<Fix | null> {
  try {
    const k = titleKey(title);
    if (!k) return null;
    const raw = await readRaw(FIXES_SETTING);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return sanitizeFix((raw as Record<string, unknown>)[k]);
  } catch { return null; }
}

// ── Écritures : une seule à la fois dans ce processus (lire-modifier-écrire sans mélange) ─────────────────────────────────
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => { const run = chain.then(job, job); chain = run.catch(() => {}); return run; };
let listener: () => void = () => {};
/** Le service RAWG vide son cache quand une correction change. */
export function onFixesChanged(fn: () => void): void { listener = fn; }

export type SaveResult = { ok: true; fix: Fix } | { ok: false; error: "title" | "full" };
export type FixChoice = { kind: "none" } | { kind: "game"; rawgId: number; name: string; img: string } | { kind: "image"; img: string; name?: string };

/** Enregistre (ou remplace) la correction d'un titre. `img` doit déjà être un chemin permis (voir `rawgImagePath`). Retire le titre de la liste « à vérifier ». */
export function saveFix(rawTitle: string, choice: FixChoice): Promise<SaveResult> {
  return serial(async () => {
    const title = cleanText(rawTitle, MAX_FIX_TITLE + 1);
    const k = titleKey(title);
    if (!title || title.length > MAX_FIX_TITLE || !k) return { ok: false, error: "title" } as const;
    const fixes = await readFixes();
    if (!fixes[k] && Object.keys(fixes).length >= MAX_FIXES) return { ok: false, error: "full" } as const;
    const at = new Date().toISOString();
    const fix = sanitizeFix(choice.kind === "none" ? { title, kind: "none", at } : { title, kind: choice.kind, rawgId: choice.kind === "game" ? choice.rawgId : undefined, name: choice.name, img: choice.img, at });
    if (!fix) return { ok: false, error: "title" } as const;
    fixes[k] = fix;
    await writeRaw(FIXES_SETTING, fixes);
    await dropFromToCheck(k);
    listener();
    return { ok: true, fix } as const;
  });
}

/** Oublie la correction d'un titre (clé normalisée). Vrai si elle existait. */
export function forgetFix(key: string): Promise<boolean> {
  return serial(async () => {
    const fixes = await readFixes();
    if (!fixes[key]) return false;
    delete fixes[key];
    await writeRaw(FIXES_SETTING, fixes);
    listener();
    return true;
  });
}

/** Oublie toutes les corrections. Renvoie combien il y en avait. */
export function forgetAllFixes(): Promise<number> {
  return serial(async () => {
    const n = Object.keys(await readFixes()).length;
    await prisma.setting.deleteMany({ where: { key: FIXES_SETTING } });
    listener();
    return n;
  });
}

/** Une page de corrections, les plus récentes d'abord. */
export async function listFixes(page = 1, size = 25): Promise<{ items: (Fix & { key: string })[]; total: number; pages: number; page: number }> {
  const all = Object.entries(await readFixes()).map(([key, f]) => ({ key, ...f })).sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: all.slice((p - 1) * size, p * size), total: all.length, pages, page: p };
}

// ── Journal « à vérifier » ─────────────────────────────────────────────────────────────────────────────────────────────────

function sanitizeDoubtful(v: unknown): Doubtful | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const title = cleanText(r.title, MAX_FIX_TITLE);
  const key = titleKey(title);
  const name = cleanText(r.name, 150);
  if (!title || !key || !name || typeof r.img !== "string" || rawgImagePath(rawgImageUrl(r.img)) !== r.img || !isDate(r.at)) return null;
  const rawgId = typeof r.rawgId === "number" && Number.isSafeInteger(r.rawgId) && r.rawgId > 0 ? r.rawgId : undefined;
  const candidates = typeof r.candidates === "number" && Number.isInteger(r.candidates) ? Math.min(Math.max(r.candidates, 0), 10) : 0;
  return { key, title, name, ...(rawgId !== undefined ? { rawgId } : {}), img: r.img, candidates, at: r.at };
}

async function readToCheckRaw(): Promise<Doubtful[]> {
  const raw = await readRaw(TO_CHECK_SETTING);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Doubtful[] = [];
  for (const item of raw.slice(0, MAX_TO_CHECK * 2)) {
    const d = sanitizeDoubtful(item);
    if (d && !seen.has(d.key)) { seen.add(d.key); out.push(d); }
  }
  return out;
}

async function dropFromToCheck(key: string): Promise<void> {
  const list = await readToCheckRaw();
  if (list.some((d) => d.key === key)) await writeRaw(TO_CHECK_SETTING, list.filter((d) => d.key !== key));
}

/** Note un titre douteux (le plus récent d'abord ; un titre déjà noté est mis à jour, jamais doublé ; 100 au plus). Ne lève jamais. */
export function noteDoubtful(entry: { title: string; name: string; rawgId?: number; url: string; candidates: number }): Promise<void> {
  return serial(async () => {
    try {
      const img = rawgImagePath(entry.url);
      const d = img ? sanitizeDoubtful({ ...entry, img, at: new Date().toISOString() }) : null;
      if (!d) return;
      if ((await readFixes())[d.key]) return; // déjà corrigé entre-temps
      const list = (await readToCheckRaw()).filter((x) => x.key !== d.key);
      await writeRaw(TO_CHECK_SETTING, [d, ...list].slice(0, MAX_TO_CHECK));
    } catch (error) { console.error("[rawg] journal:", (error as Error)?.name); }
  });
}

/** La liste « à vérifier », la plus récente d'abord. PURGE À LA LECTURE : vieux titres, titres déjà corrigés, excédent au-delà de 100 (sans minuteur de fond). */
export async function readToCheck(now = Date.now()): Promise<Doubtful[]> {
  const raw = await readToCheckRaw();
  const fixes = await readFixes();
  const limit = now - TO_CHECK_DAYS * 86_400_000;
  const kept = raw.filter((d) => !fixes[d.key] && Date.parse(d.at) >= limit).slice(0, MAX_TO_CHECK);
  if (kept.length !== raw.length) {
    await serial(async () => { await writeRaw(TO_CHECK_SETTING, kept); }).catch(() => {});
  }
  return kept;
}

/** Retire un titre de la liste sans rien corriger. */
export function dismissDoubtful(key: string): Promise<void> {
  return serial(() => dropFromToCheck(key));
}
