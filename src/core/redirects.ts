import { prisma } from "./db";
import { RESERVED_PATHS } from "./config";
import { listCollections } from "./collections";
import { isKnownLocale } from "./i18n/locales";
import { isSafeExternalUrl } from "./url";

const PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;

export function normalizeRedirectPath(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

/** Renvoie un message d'erreur (clé i18n) ou null si le chemin est utilisable. */
export async function validateRedirectPath(path: string, ignoreId?: string): Promise<string | null> {
  if (!PATH_RE.test(path)) return "redirects.error.path";
  const first = path.split("/")[0] ?? "";
  if (RESERVED_PATHS.has(first) || isKnownLocale(first)) return "redirects.error.reserved";
  const collections = await listCollections();
  if (collections.some((c) => c.basePath && c.basePath === first)) return "redirects.error.reserved";
  const clash = await prisma.redirect.findUnique({ where: { path } });
  if (clash && clash.id !== ignoreId) return "redirects.error.exists";
  return null;
}

export type ResolvedRedirect = { url: string; permanent: boolean };

/**
 * Cible d'une redirection. Seules les URLs saisies dans l'admin (ou le lien
 * d'une entrée) sont atteignables : il n'existe aucune redirection ouverte.
 */
export async function resolveRedirect(path: string): Promise<ResolvedRedirect | null> {
  const row = await prisma.redirect.findUnique({ where: { path } });
  if (!row || !row.active) return null;
  let url = row.targetUrl;
  if (row.entryId) {
    const entry = await prisma.entry.findUnique({ where: { id: row.entryId }, select: { url: true } });
    if (entry?.url) url = entry.url;
  }
  if (!isSafeExternalUrl(url)) return null;
  // Fire and forget : un compteur manquant ne doit jamais casser une redirection.
  prisma.redirect.update({ where: { id: row.id }, data: { hits: { increment: 1 } } }).catch(() => {});
  return { url, permanent: row.permanent };
}
