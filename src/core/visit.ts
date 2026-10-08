import { headers } from "next/headers";
import { prisma } from "@/core/db";

/**
 * DERNIÈRE VISITE. Le navigateur du visiteur garde deux cookies, sans aucune donnée personnelle, juste des dates :
 *  - `curiosa_seen`  (1 an)      : le moment de son dernier passage sur le site ;
 *  - `curiosa_since` (de session) : la « dernière visite » figée pour toute la visite en cours, pour que les pastilles de nouveautés ne
 *    disparaissent pas dès la deuxième page ouverte.
 * Le proxy les tient à jour et transmet la date retenue aux pages (en-tête `x-curiosa-since`). Les modules la reçoivent dans
 * `ctx.visit.lastVisit` : le 1er janvier 1970 pour un visiteur inconnu, sinon la date de sa visite précédente.
 *
 * CONSENTEMENT : cette mémoire n'est pas indispensable au fonctionnement du site ; elle n'existe donc QUE si le visiteur l'a demandée lui-même (bouton « Me prévenir des
 * nouveautés », cookie `curiosa_news`). Sans ce choix : rien n'est déposé, la date est 1970 (aucune pastille), et les cookies d'avant sont effacés.
 */
/** Choix du visiteur (« me prévenir des nouveautés ») : sans lui, aucun des deux cookies ci-dessous n'est déposé, et les anciens sont effacés. */
export const NEWS_COOKIE = "curiosa_news";
export const SEEN_COOKIE = "curiosa_seen";
export const SINCE_COOKIE = "curiosa_since";
export const SINCE_HEADER = "x-curiosa-since";
export const EPOCH = new Date(0);

/** Date lue dans un cookie (millisecondes) ; absente, illisible ou dans le futur → 1er janvier 1970. */
export function parseVisitDate(raw: unknown, now = Date.now()): Date {
  if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw)) return EPOCH;
  const ms = Number(raw);
  return ms > now + 60_000 ? EPOCH : new Date(ms);
}

/** Ce que le proxy doit faire pour une requête : la date retenue pour cette visite, et les cookies à poser. */
export function planVisit(cookies: { seen?: string; since?: string }, now = Date.now()): { since: Date; setSince?: string; setSeen: string } {
  const sessionSince = cookies.since !== undefined ? parseVisitDate(cookies.since, now) : null;
  const since = sessionSince ?? parseVisitDate(cookies.seen, now);
  return { since, setSince: sessionSince ? undefined : String(since.getTime()), setSeen: String(now) };
}

/** La dernière visite du visiteur pour la requête en cours (1970 si inconnu). */
export async function currentVisit(): Promise<{ lastVisit: Date; isFirstVisit: boolean }> {
  const raw = (await headers()).get(SINCE_HEADER);
  const lastVisit = parseVisitDate(raw ?? undefined);
  return { lastVisit, isFirstVisit: lastVisit.getTime() === 0 };
}

/**
 * Règle par défaut du cœur : y a-t-il des entrées publiées depuis `since` dans cette instance ?
 * Un visiteur inconnu n'a rien « manqué » : jamais de pastille à la première visite.
 */
export async function hasNewEntries(instanceId: string, since: Date, now = new Date()): Promise<boolean> {
  if (since.getTime() === 0) return false;
  const n = await prisma.entry.count({
    where: {
      instanceId, status: "published",
      AND: [
        { OR: [{ publishedAt: { gt: since, lte: now } }, { publishedAt: null, createdAt: { gt: since } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
  });
  return n > 0;
}
