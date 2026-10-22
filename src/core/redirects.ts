import type { Redirect } from "@prisma/client";
import { prisma } from "./db";
import { RESERVED_PATHS, siteUrl } from "./config";
import { listInstances } from "./instances";
import { isKnownLocale } from "./i18n/locales";
import { invalidateRedirectGate } from "./redirectGate";
import { flushRedirectHits, isHumanVisit, recordRedirectHit } from "./redirectStats";
import { slugify } from "./slug";
import { isSafeExternalUrl, normalizeLinkInput } from "./url";

/**
 * REDIRECTIONS (« liens courts ») : `/chemin` envoie vers une adresse que la personne a saisie dans l'administration. Rien d'autre n'est joignable :
 * il n'y a aucune redirection ouverte. Ce fichier est la source unique des règles (écran d'administration ET outils MCP passent par ici).
 *
 * - Le QR code encode l'adresse COMPLÈTE du lien court (voir redirectQr.ts) : le chemin ne change donc jamais une fois créé, seule la destination peut changer.
 * - Date de fin (`expiresAt`) : après elle, le lien répond 410 (page aimable, voir redirectGone.ts) sans jamais révéler sa destination.
 * - Désactivé (`active: false`) ou inexistant : exactement la même réponse (404), rien ne permet de les distinguer.
 */
const PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
export const MAX_PATH = 80;
export const MAX_TARGET = 2000;
export const MAX_END_MESSAGE = 300;
export const PAGE_SIZE = 50;
/** Nombre maximal de redirections (borne d'un site : la liste, l'export et la sauvegarde restent légers). */
export const MAX_REDIRECTS = 2000;

export function normalizeRedirectPath(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

/** Adresse complète du lien court (ce que le QR code encode et ce qu'on copie) : `https://monsite.be/twitch`. */
export function redirectShortUrl(path: string): string {
  return `${siteUrl}/${path}`;
}

/** L'adresse publique du site n'est pas réglée (le QR imprimé mènerait vers l'ordinateur local) : à signaler avant l'impression. */
export function siteUrlLooksLocal(url = siteUrl): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".local") || !h.includes(".");
  } catch { return true; }
}

/** Renvoie un message d'erreur (clé i18n) ou null si le chemin est utilisable. */
export async function validateRedirectPath(path: string, ignoreId?: string): Promise<string | null> {
  if (!PATH_RE.test(path) || path.length > MAX_PATH) return "redirects.error.path";
  const first = path.split("/")[0] ?? "";
  if (RESERVED_PATHS.has(first) || isKnownLocale(first)) return "redirects.error.reserved";
  const instances = await listInstances();
  if (instances.some((c) => c.basePath && c.basePath === first)) return "redirects.error.reserved";
  const clash = await prisma.redirect.findUnique({ where: { path } });
  if (clash && clash.id !== ignoreId) return "redirects.error.exists";
  return null;
}

/**
 * Comprend une adresse COLLÉE (d'un message, d'un navigateur) : guillemets, chevrons, ponctuation de fin collée par une phrase, espaces et retours à la ligne
 * sont retirés, puis `normalizeLinkInput` complète le « https:// » manquant. Ce qui reste incompréhensible est rendu tel quel : la validation le refusera.
 */
export function cleanPastedAddress(raw: string | null | undefined): string {
  let v = String(raw ?? "").trim().split(/\s+/)[0] ?? "";
  v = v.replace(/^[«“"'<(\[]+/, "").replace(/[»”"'>)\],.;:!?]+$/, "");
  return normalizeLinkInput(v);
}

const sameHost = (a: string, b: string) => a.toLowerCase().replace(/^www\./, "") === b.toLowerCase().replace(/^www\./, "");

/**
 * Une destination acceptable : http(s) seulement (`isSafeExternalUrl` écarte déjà `javascript:`, `data:`…, et ici `mailto:`), sans identifiants dans l'adresse,
 * de longueur bornée, et qui ne renvoie pas vers un autre lien court de CE site (boucle). Renvoie l'adresse nettoyée ou une clé d'erreur.
 */
export async function checkRedirectTarget(raw: string): Promise<{ url: string } | { error: string }> {
  const url = cleanPastedAddress(raw);
  if (!url || url.length > MAX_TARGET || !isSafeExternalUrl(url)) return { error: "redirects.error.target" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { error: "redirects.error.target" }; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { error: "redirects.error.target" };
  if (parsed.username || parsed.password) return { error: "redirects.error.credentials" };
  if (sameHost(parsed.hostname, new URL(siteUrl).hostname)) {
    let there = parsed.pathname;
    try { there = decodeURIComponent(there); } catch { /* garde le texte brut */ }
    if (await prisma.redirect.findUnique({ where: { path: normalizeRedirectPath(there) }, select: { id: true } }).catch(() => null)) return { error: "redirects.error.loop" };
  }
  return { url };
}

/* ───────────── Nom court proposé ───────────── */

const GENERIC_SEGMENTS = new Set(["watch", "index", "home", "default", "main", "page", "view", "share", "shorts", "embed", "redirect", "link", "url", "en", "fr", "www", "web", "app", "s", "p", "v", "u"]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

const shorten = (s: string, max = 32): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf("-");
  return (at >= 12 ? cut.slice(0, at) : cut).replace(/-+$/, "");
};
const meaningful = (s: string) => s.length >= 2 && !/^\d+$/.test(s) && !/^[a-f0-9]{16,}$/.test(s) && !GENERIC_SEGMENTS.has(s);

/** La fin de l'adresse, lisible : « /mugs/Mug-Chat.html » → « mug-chat ». Vide si rien d'utilisable (numéro seul, code illisible, mot générique). */
function endOfAddress(parsed: URL): string {
  for (const raw of parsed.pathname.split("/").filter(Boolean).reverse()) {
    let seg = raw;
    try { seg = decodeURIComponent(raw); } catch { /* garde le texte brut */ }
    const s = slugify(seg.replace(/\.(html?|php|aspx?)$/i, "").replace(/^@/, ""));
    if (meaningful(s)) return shorten(s);
  }
  return "";
}

/** Le nom du site visé : « www.twitch.tv » → « twitch ». */
function siteOfAddress(parsed: URL): string {
  const parts = parsed.hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length === 0) return "";
  const idx = parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]!) ? parts.length - 3 : Math.max(0, parts.length - 2);
  return shorten(slugify(parts[parts.length === 1 ? 0 : idx]!));
}

/** Le nom court lisible tiré d'une adresse, sans vérifier s'il est libre : la fin de l'adresse, sinon le nom du site visé (« twitch.tv » → « twitch »). Vide si rien d'utilisable. */
export function nameFromAddress(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return ""; }
  return endOfAddress(parsed) || siteOfAddress(parsed);
}

/**
 * Propose un nom court : le titre de l'entrée liée s'il y en a une, sinon la fin de l'adresse, sinon le nom du site visé, sinon le nom du site de la personne.
 * Minuscules, chiffres et tirets ; jamais un nom réservé (on passe au suivant) ni déjà pris (« -2 », « -3 »…).
 */
export async function proposeRedirectPath(input: { url?: string; entryTitle?: string; siteName?: string }): Promise<string> {
  let parsed: URL | null = null;
  try { parsed = input.url ? new URL(input.url) : null; } catch { /* adresse illisible : on passe aux autres sources */ }
  const sources = [slugify(input.entryTitle ?? ""), parsed ? endOfAddress(parsed) : "", parsed ? siteOfAddress(parsed) : "", slugify(input.siteName ?? "")].map((s) => shorten(s));
  let base = "";
  for (const candidate of sources) {
    if (!meaningful(candidate)) continue;
    const reason = await validateRedirectPath(candidate);
    if (reason === null || reason === "redirects.error.exists") { base = candidate; break; }
  }
  if (!base) base = "lien";
  const taken = new Set((await prisma.redirect.findMany({ where: { path: { startsWith: base } }, select: { path: true }, take: 500 })).map((r) => r.path));
  for (let n = 1; n <= 60; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (taken.has(candidate)) continue;
    if ((await validateRedirectPath(candidate)) === null) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

/* ───────────── Création, modification ───────────── */

export type RedirectInput = {
  path?: string;
  targetUrl?: string;
  entryId?: string | null;
  permanent?: boolean;
  active?: boolean;
  /** Date de fin : `null` retire la date ; `undefined` ne change rien. */
  expiresAt?: Date | null;
  endMessage?: string;
};
export type RedirectFail = { field: "path" | "targetUrl" | "entryId" | "expiresAt" | "endMessage"; key: string };
export type RedirectResult = { ok: true; redirect: Redirect } | { ok: false; fail: RedirectFail };
const fail = (field: RedirectFail["field"], key: string): RedirectResult => ({ ok: false, fail: { field, key } });

async function entryLink(entryId: string): Promise<{ title: string; url: string } | null> {
  const e = await prisma.entry.findUnique({ where: { id: entryId }, select: { url: true, translations: { select: { title: true }, take: 1 } } });
  return e?.url ? { title: e.translations[0]?.title ?? "", url: e.url } : null;
}

async function checkCommon(input: RedirectInput): Promise<{ fail: RedirectResult } | { target?: string; entry?: { title: string; url: string } | null }> {
  let entry: { title: string; url: string } | null | undefined;
  if (input.entryId) {
    entry = await entryLink(input.entryId);
    if (!entry) return { fail: fail("entryId", "redirects.error.entry") };
  }
  let target: string | undefined;
  const wanted = input.targetUrl !== undefined && input.targetUrl.trim() !== "" ? input.targetUrl : entry?.url;
  if (wanted !== undefined) {
    const checked = await checkRedirectTarget(wanted);
    if ("error" in checked) return { fail: fail("targetUrl", checked.error) };
    target = checked.url;
  }
  if (input.endMessage !== undefined && input.endMessage.length > MAX_END_MESSAGE) return { fail: fail("endMessage", "redirects.error.message") };
  if (input.expiresAt instanceof Date && Number.isNaN(input.expiresAt.getTime())) return { fail: fail("expiresAt", "redirects.error.date") };
  return { target, entry };
}

/** Crée une redirection. Le nom court est proposé si `path` est vide (et un nom donné est vérifié : format, réservé, déjà pris). */
export async function createRedirectRecord(input: RedirectInput, opts: { siteName?: string } = {}): Promise<RedirectResult> {
  const checked = await checkCommon(input);
  if ("fail" in checked) return checked.fail;
  if (!checked.target) return fail("targetUrl", "redirects.error.target");
  if ((await prisma.redirect.count()) >= MAX_REDIRECTS) return fail("path", "redirects.error.tooMany");
  const given = normalizeRedirectPath(input.path ?? "");
  const path = given || (await proposeRedirectPath({ url: checked.target, entryTitle: checked.entry?.title, siteName: opts.siteName }));
  const pathError = await validateRedirectPath(path);
  if (pathError) return fail("path", pathError);
  try {
    const redirect = await prisma.redirect.create({ data: {
      path, targetUrl: checked.target, entryId: input.entryId || null, permanent: !!input.permanent, active: input.active !== false,
      expiresAt: input.expiresAt ?? null, endMessage: (input.endMessage ?? "").trim(),
    } });
    invalidateRedirectGate();
    return { ok: true, redirect };
  } catch {
    return fail("path", "redirects.error.exists"); // deux créations en même temps pour le même nom
  }
}

/** Modifie une redirection. Le CHEMIN ne change jamais (il est dans le QR code imprimé) : il n'est pas un champ de cette fonction. */
export async function updateRedirectRecord(id: string, input: Omit<RedirectInput, "path">): Promise<RedirectResult> {
  const current = await prisma.redirect.findUnique({ where: { id } });
  if (!current) return fail("path", "redirects.error.missing");
  const checked = await checkCommon(input);
  if ("fail" in checked) return checked.fail;
  const redirect = await prisma.redirect.update({ where: { id }, data: {
    ...(checked.target !== undefined ? { targetUrl: checked.target } : {}),
    ...(input.entryId !== undefined ? { entryId: input.entryId || null } : {}),
    ...(input.permanent !== undefined ? { permanent: input.permanent } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    ...(input.endMessage !== undefined ? { endMessage: input.endMessage.trim() } : {}),
  } });
  invalidateRedirectGate();
  return { ok: true, redirect };
}

/** Supprime une redirection (ses chiffres par jour partent avec elle). Renvoie le chemin supprimé, ou null si elle n'existait pas. */
export async function deleteRedirectRecord(id: string): Promise<string | null> {
  const row = await prisma.redirect.findUnique({ where: { id }, select: { path: true } });
  if (!row) return null;
  await prisma.redirect.delete({ where: { id } }).catch(() => {});
  invalidateRedirectGate();
  return row.path;
}

/* ───────────── Liste ───────────── */

export type RedirectPage = { items: Redirect[]; total: number; page: number; pages: number };

/** Une page de la liste (50 par page), du plus récent au plus ancien ; `q` cherche dans le nom court et la destination. */
export async function listRedirects(opts: { q?: string; page?: number } = {}): Promise<RedirectPage> {
  await flushRedirectHits(); // les passages en attente sont comptés avant d'afficher les totaux
  const q = (opts.q ?? "").trim().slice(0, 100);
  // Recherche littérale : « % » et « _ » ne sont pas des jokers (un nom peut contenir « _ »).
  let where: { id?: { in: string[] } } = {};
  if (q) {
    const like = (v: string) => `%${v.replace(/[\\%_]/g, "\\$&")}%`;
    const found = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Redirect" WHERE path LIKE ${like(q.toLowerCase().replace(/^\/+/, ""))} ESCAPE '\\' OR "targetUrl" LIKE ${like(q)} ESCAPE '\\' LIMIT 2000`;
    where = { id: { in: found.map((r) => r.id) } };
  }
  const total = await prisma.redirect.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1) || 1), pages);
  const items = await prisma.redirect.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  return { items, total, page, pages };
}

/** État lisible d'une redirection à un instant donné. */
export function redirectState(r: Pick<Redirect, "active" | "expiresAt">, now = Date.now()): "active" | "ended" | "off" {
  if (!r.active) return "off";
  return r.expiresAt && r.expiresAt.getTime() <= now ? "ended" : "active";
}

/* ───────────── Export CSV ───────────── */

/** Une cellule CSV sûre : guillemets doublés, et jamais interprétée comme une formule par un tableur (=, +, -, @ en tête). */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Toutes les redirections en CSV (2 000 au plus) : adresse courte, destination, état, date de fin, passages au total et sur 30 jours. */
export async function redirectsCsv(opts: { header: string[]; stateLabels: Record<"active" | "ended" | "off", string>; tz: string; now?: number }): Promise<string> {
  const { monthlyHits } = await import("./redirectStats");
  const { dayKey, timeKey } = await import("./siteTime");
  const now = opts.now ?? Date.now();
  const rows = await prisma.redirect.findMany({ orderBy: [{ path: "asc" }], take: MAX_REDIRECTS });
  const month = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 100) for (const [k, v] of await monthlyHits(rows.slice(i, i + 100).map((r) => r.id), now)) month.set(k, v);
  const lines = [opts.header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      redirectShortUrl(r.path), r.targetUrl, opts.stateLabels[redirectState(r, now)],
      r.expiresAt ? `${dayKey(r.expiresAt, opts.tz)} ${timeKey(r.expiresAt, opts.tz)}` : "", r.hits, month.get(r.id) ?? 0, r.createdAt.toISOString().slice(0, 10),
    ].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/* ───────────── Résolution publique ───────────── */

export type ResolvedRedirect = { url: string; permanent: boolean };
export type GoneRedirect = { gone: true; message: string };

/**
 * Réponse d'un lien court à un visiteur. Seules les URLs saisies dans l'admin (ou le lien d'une entrée) sont atteignables : il n'existe aucune redirection ouverte.
 * - inexistant, désactivé ou destination refusée → null (même réponse : rien ne distingue ces cas) ;
 * - date de fin passée → `{ gone: true, message }` : la destination n'est PAS lue, donc ne peut pas fuir ;
 * - sinon la destination, et le passage est compté (sauf robots et aperçus de messagerie : voir redirectStats.ts), sans jamais retarder ni casser la redirection.
 */
export async function resolveRedirect(path: string, visit?: { userAgent?: string | null; prefetch?: boolean; team?: boolean }, now = Date.now()): Promise<ResolvedRedirect | GoneRedirect | null> {
  const row = await prisma.redirect.findUnique({ where: { path } });
  if (!row || !row.active) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now) return { gone: true, message: row.endMessage };
  let url = row.targetUrl;
  if (row.entryId) {
    const entry = await prisma.entry.findUnique({ where: { id: row.entryId }, select: { url: true } });
    if (entry?.url) url = entry.url;
  }
  if (!isSafeExternalUrl(url)) return null;
  if (isHumanVisit(visit)) void recordRedirectHit(row.id, now);
  return { url, permanent: row.permanent };
}

export { flushRedirectHits };
