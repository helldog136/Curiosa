import { prisma } from "./db";
import { dayKey, lastDays, siteTimezone } from "./siteTime";

/**
 * STATISTIQUES DES REDIRECTIONS : un nombre par redirection et par jour. Rien d'autre.
 *
 * Ce qui est gardé : `RedirectDay` (redirection, jour dans le fuseau du site, nombre) et le total `Redirect.hits`.
 * Ce qui ne l'est JAMAIS : cookie, adresse IP, navigateur, provenance, empreinte de visiteur. Le texte « agent » du navigateur sert uniquement à
 * écarter les robots et aperçus de messagerie, il n'est ni gardé ni compté.
 *
 * Écritures : coalescées en mémoire (un passage = une addition, pas une écriture), vidées par paquets bornés, JAMAIS dans le chemin de la redirection
 * (le visiteur n'attend pas la base) et sans minuteur de fond : le vidage part au passage suivant quand la dernière écriture date de plus de FLUSH_EVERY_MS,
 * ou à la lecture des chiffres dans l'administration. Si la base est lente ou en panne, les passages en attente sont abandonnés au-delà de MAX_PENDING :
 * le compteur ne ralentit ni ne casse jamais une redirection. Un arrêt du serveur peut perdre les quelques secondes en attente.
 * Détail par jour gardé KEEP_DAYS jours ; au-delà il est replié dans le total (qui compte tout depuis le début) et la ligne disparaît.
 */
export const KEEP_DAYS = 120;
export const FLUSH_EVERY_MS = 5_000;
export const MAX_PENDING = 500;
export const FLUSH_CHUNK = 200;
const PRUNE_EVERY_MS = 6 * 3600_000;

/**
 * Agents connus qui ne sont pas des personnes : robots d'indexation, aperçus de liens des messageries et réseaux, outils de contrôle, scripts, navigateurs sans écran.
 * La liste est volontairement large : mieux vaut ne pas compter un vrai clic que gonfler les chiffres.
 */
const NOT_A_PERSON = new RegExp([
  "bot\\b", "bot/", "bots?[ ;)_-]", "crawl", "spider", "slurp", "scrap", "fetch", "preview", "unfurl", "headless", "lighthouse", "pagespeed", "monitor", "uptime", "pingdom", "check_http", "validator",
  "facebookexternalhit", "facebot", "meta-externalagent", "whatsapp/", "telegrambot", "slackbot", "slack-imgproxy", "discordbot", "skypeuripreview", "linkedinbot", "twitterbot", "pinterest/", "pinterestbot", "tumblr/", "redditbot", "mastodon", "cardyb", "embedly", "quora link", "vkshare", "viber/", "kakaotalk-scrap", "line-poker", "snapchat/", "imessage", "applebot", "yahoo! slurp",
  "googlebot", "google-", "adsbot", "mediapartners", "apis-google", "bingbot", "bingpreview", "duckduck", "yandex", "baidu", "sogou", "exabot", "ia_archiver", "applebot", "petalbot", "semrush", "ahrefs", "mj12", "dotbot",
  "curl/", "wget/", "python", "go-http", "java/", "okhttp", "httpclient", "libwww", "node-fetch", "axios", "undici", "postman", "insomnia", "php/", "ruby", "perl", "scrapy", "http_request",
  "gptbot", "chatgpt", "oai-searchbot", "claude", "anthropic", "perplexity", "bytespider", "ccbot", "amazonbot",
].join("|"), "i");

/** Ce passage est-il celui d'une personne ? Un texte d'agent vide (script) ou d'un robot connu ne l'est pas ; une demande d'avance (préchargement) non plus. */
export function isHumanVisit(visit: { userAgent?: string | null; prefetch?: boolean; team?: boolean } | undefined): boolean {
  if (!visit) return true; // aucun renseignement (appel interne) : compté
  // `team` : la personne est connectée à l'administration (elle teste son lien) ; comme pour les visites du site, l'équipe n'est pas un visiteur.
  if (visit.prefetch || visit.team) return false;
  const ua = (visit.userAgent ?? "").trim();
  if (ua.length < 8 || ua.length > 1000) return false;
  return !NOT_A_PERSON.test(ua);
}

/** Demande d'avance du navigateur (préchargement, aperçu) d'après ses en-têtes : à ne pas compter. */
export function isPrefetchRequest(get: (name: string) => string | null): boolean {
  const flags = [get("purpose"), get("sec-purpose"), get("x-purpose"), get("x-moz"), get("x-mozilla-purpose")].map((v) => (v ?? "").toLowerCase());
  return flags.some((v) => /prefetch|prerender|preview/.test(v));
}

type State = { pending: Map<string, number>; flushing: Promise<void> | null; lastFlush: number; lastPrune: number; tz?: { value: string; at: number } };
const g = globalThis as unknown as { curiosaRedirectStats?: State };
const state = (): State => (g.curiosaRedirectStats ??= { pending: new Map(), flushing: null, lastFlush: 0, lastPrune: 0 });

/** Fuseau du site, relu au plus toutes les 5 minutes (le passage d'un visiteur ne coûte pas une lecture de plus). */
async function cachedTimezone(now: number): Promise<string> {
  const s = state();
  if (s.tz && now - s.tz.at < 300_000) return s.tz.value;
  const value = await siteTimezone();
  s.tz = { value, at: now };
  return value;
}

/**
 * Note un passage. Ne lève jamais, n'attend jamais la base, ne garde que « redirection + jour → nombre ».
 * @param now  instant du passage (pour les tests).
 */
export async function recordRedirectHit(redirectId: string, now = Date.now()): Promise<void> {
  try {
    const s = state();
    const day = dayKey(new Date(now), await cachedTimezone(now));
    const key = `${redirectId}|${day}`;
    if (s.pending.has(key) || s.pending.size < MAX_PENDING) s.pending.set(key, (s.pending.get(key) ?? 0) + 1);
    if (!s.flushing && (now - s.lastFlush >= FLUSH_EVERY_MS || s.pending.size >= FLUSH_CHUNK)) void flushRedirectHits(now);
  } catch { /* un compteur ne gêne jamais une redirection */ }
}

/** Écrit les passages en attente (paquets bornés). Un seul vidage à la fois ; ne lève jamais. Renvoie le nombre de passages écrits. */
export function flushRedirectHits(now = Date.now()): Promise<number> {
  const s = state();
  if (s.flushing) return s.flushing.then(() => 0);
  s.lastFlush = now;
  const taken = [...s.pending.entries()];
  s.pending.clear();
  let written = 0;
  const run = (async () => {
    try {
      for (let i = 0; i < taken.length; i += FLUSH_CHUNK) {
        const chunk = taken.slice(i, i + FLUSH_CHUNK).map(([key, n]) => { const at = key.indexOf("|"); return { id: key.slice(0, at), day: key.slice(at + 1), n }; });
        const ids = [...new Set(chunk.map((c) => c.id))];
        // Une redirection supprimée entre-temps n'a plus de ligne à compléter : on l'écarte avant d'écrire.
        const alive = new Set((await prisma.redirect.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id));
        const rows = chunk.filter((c) => alive.has(c.id));
        if (rows.length === 0) continue;
        const totals = new Map<string, number>();
        for (const r of rows) totals.set(r.id, (totals.get(r.id) ?? 0) + r.n);
        try {
          await prisma.$transaction([
            ...[...totals].map(([id, n]) => prisma.redirect.updateMany({ where: { id }, data: { hits: { increment: n } } })),
            ...rows.map((r) => prisma.redirectDay.upsert({ where: { redirectId_day: { redirectId: r.id, day: r.day } }, create: { redirectId: r.id, day: r.day, hits: r.n }, update: { hits: { increment: r.n } } })),
          ]);
          written += rows.reduce((a, r) => a + r.n, 0);
        } catch {
          // Base occupée : on remet ce paquet en attente s'il y a de la place, sinon on l'abandonne (borné).
          for (const r of rows) { const k = `${r.id}|${r.day}`; if (s.pending.has(k) || s.pending.size < MAX_PENDING) s.pending.set(k, (s.pending.get(k) ?? 0) + r.n); }
        }
      }
      if (now - s.lastPrune >= PRUNE_EVERY_MS) { s.lastPrune = now; await pruneRedirectDays(now); }
    } catch { /* jamais d'erreur « non gérée » */ }
    return written;
  })();
  s.flushing = run.then(() => undefined).finally(() => { s.flushing = null; });
  return run;
}

/** Supprime le détail plus vieux que KEEP_DAYS jours (le total, lui, garde tout). */
export async function pruneRedirectDays(now = Date.now()): Promise<number> {
  const tz = await cachedTimezone(now);
  const oldest = lastDays(dayKey(new Date(now), tz), KEEP_DAYS)[0]!;
  return (await prisma.redirectDay.deleteMany({ where: { day: { lt: oldest } } })).count;
}

export type RedirectStats = {
  today: number; week: number; month: number; total: number;
  /** Les 30 derniers jours, le plus ancien d'abord (un nombre par jour, 0 s'il n'y a rien). */
  series: { day: string; hits: number }[];
};

/** Chiffres d'une redirection : aujourd'hui, 7 jours, 30 jours (jour courant compris), total, et la série des 30 jours. */
export async function redirectStats(id: string, now = Date.now()): Promise<RedirectStats | null> {
  await flushRedirectHits(now);
  const row = await prisma.redirect.findUnique({ where: { id }, select: { hits: true } });
  if (!row) return null;
  const tz = await siteTimezone();
  const days = lastDays(dayKey(new Date(now), tz), 30);
  const found = await prisma.redirectDay.findMany({ where: { redirectId: id, day: { gte: days[0]!, lte: days[29]! } }, select: { day: true, hits: true }, take: 60 });
  const byDay = new Map(found.map((d) => [d.day, d.hits]));
  const series = days.map((day) => ({ day, hits: byDay.get(day) ?? 0 }));
  const sum = (from: number) => series.slice(from).reduce((a, d) => a + d.hits, 0);
  return { today: sum(29), week: sum(23), month: sum(0), total: Math.max(row.hits, sum(0)), series };
}

/** Passages des 30 derniers jours de plusieurs redirections (une page de la liste : 100 au plus), pour la colonne « 30 jours » du tableau. */
export async function monthlyHits(ids: string[], now = Date.now()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const wanted = ids.slice(0, 100);
  if (wanted.length === 0) return out;
  await flushRedirectHits(now);
  const days = lastDays(dayKey(new Date(now), await siteTimezone()), 30);
  const rows = await prisma.redirectDay.groupBy({ by: ["redirectId"], where: { redirectId: { in: wanted }, day: { gte: days[0]!, lte: days[29]! } }, _sum: { hits: true } });
  for (const r of rows) out.set(r.redirectId, r._sum.hits ?? 0);
  return out;
}
