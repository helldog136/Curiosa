import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { deleteSetting, getSetting, setSetting } from "@/core/settings";

/**
 * STATISTIQUES DE VISITE ANONYMES.
 *
 * Ce qui est enregistré : des COMPTEURS par jour (visites, pages vues, pages les plus lues, sites d'où l'on vient). Ce qui ne l'est jamais : adresse IP,
 * identifiant de navigateur, cookie, agent utilisateur. Pour ne compter qu'une fois un visiteur par jour, on garde seulement une empreinte
 * `sha256(sel du jour + IP + navigateur)` ; le sel est tiré au hasard chaque jour et le précédent est détruit, les empreintes de la veille sont
 * supprimées : il est impossible de reconnaître quelqu'un d'un jour à l'autre, ni de remonter à lui.
 * Les visiteurs qui envoient « Do Not Track » ou « Global Privacy Control » ne sont pas comptés, ni les robots, ni les personnes connectées à l'admin.
 */
export const MAX_PAGES_PER_DAY = 500;
export const MAX_REFS_PER_DAY = 200;
export const MAX_KEYS_PER_VISITOR = 400;
const BOT_RE = /bot|crawl|spider|slurp|scrap|preview|facebookexternalhit|headless|lighthouse|monitor|uptime|curl|wget|python|go-http|java\/|httpclient|node-fetch|axios|okhttp|libwww/i;
const SKIP_PREFIXES = ["/admin", "/api", "/m/", "/overlays", "/uploads", "/go/", "/_next", "/feed"];

export const STATS_SETTING = "stats.enabled";
/** Les statistiques sont activées par défaut ; le propriétaire peut les couper dans les réglages. */
export async function statsEnabled(): Promise<boolean> {
  return (await getSetting<boolean>(STATS_SETTING)) !== false;
}

/** Chemin à compter : sans paramètres ni ancre, sans « / » final, borné ; null s'il n'est pas dénombrable (admin, API, forme invalide…). */
export function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.split(/[?#]/)[0]!;
  if (p.length === 0 || p.length > 200 || !p.startsWith("/") || p.startsWith("//")) return null;
  if (!/^\/[\w\-./%~]*$/.test(p)) return null;
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  const lower = p.toLowerCase();
  if (SKIP_PREFIXES.some((s) => lower === s.replace(/\/$/, "") || lower.startsWith(s))) return null;
  return p;
}

/** Nom d'hôte de la provenance, sans « www. » ; null si absente, invalide, ou si c'est le site lui-même. */
export function refHost(referrer: unknown, ownHost?: string): string | null {
  if (typeof referrer !== "string" || referrer === "" || referrer.length > 500) return null;
  let host: string;
  try { const u = new URL(referrer); if (!/^https?:$/.test(u.protocol)) return null; host = u.hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  if (!host || host.length > 80 || !/^[a-z0-9.-]+$/.test(host)) return null;
  return ownHost && host === ownHost.toLowerCase().replace(/^www\./, "").split(":")[0] ? null : host;
}

/** Jour (AAAA-MM-JJ) à l'heure du serveur. */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Sel du jour : tiré au hasard, remplacé chaque jour ; la veille est détruite ainsi que les empreintes qu'elle avait servi à faire. */
async function dailySalt(day: string): Promise<string> {
  const current = await getSetting<{ day: string; salt: string }>("stats.salt");
  if (current?.day === day) return current.salt;
  const salt = crypto.randomBytes(24).toString("hex");
  await setSetting("stats.salt", { day, salt });
  await prisma.visitSeen.deleteMany({ where: { day: { not: day } } });
  return salt;
}

export type Hit = { path: unknown; referrer?: unknown; ip: string; userAgent: string; doNotTrack?: boolean; ownHost?: string };

export async function recordVisit(hit: Hit, now = new Date()): Promise<"counted" | "ignored" | "disabled"> {
  if (!(await statsEnabled())) return "disabled";
  if (hit.doNotTrack || !hit.userAgent || BOT_RE.test(hit.userAgent)) return "ignored";
  const path = normalizePath(hit.path);
  if (!path) return "ignored";
  const ref = refHost(hit.referrer, hit.ownHost);
  const day = dayOf(now);
  const hash = crypto.createHash("sha256").update(`${await dailySalt(day)}|${hit.ip}|${hit.userAgent}`).digest("hex").slice(0, 24);
  if ((await prisma.visitSeen.count({ where: { day, hash } })) >= MAX_KEYS_PER_VISITOR) return "ignored";

  const keys: [string, string][] = [["site", ""], ["page", path], ...(ref ? ([["ref", ref]] as [string, string][]) : [])];
  await prisma.$transaction(async (tx) => {
    for (const [kind, key] of keys) {
      const exists = await tx.visitDaily.findUnique({ where: { day_kind_key: { day, kind, key } }, select: { views: true } });
      // Plafonds contre un robot qui inventerait des milliers d'adresses : les totaux du site comptent toujours.
      if (!exists && kind !== "site") {
        const n = await tx.visitDaily.count({ where: { day, kind } });
        if (n >= (kind === "page" ? MAX_PAGES_PER_DAY : MAX_REFS_PER_DAY)) continue;
      }
      const seen = await tx.visitSeen.findUnique({ where: { day_hash_kind_key: { day, hash, kind, key } }, select: { day: true } });
      if (!seen) await tx.visitSeen.create({ data: { day, hash, kind, key } });
      const visitors = seen ? 0 : 1;
      await tx.visitDaily.upsert({
        where: { day_kind_key: { day, kind, key } },
        create: { day, kind, key, views: 1, visitors },
        update: { views: { increment: 1 }, visitors: { increment: visitors } },
      });
    }
  });
  return "counted";
}

export type StatsSummary = {
  days: { day: string; visitors: number; views: number }[];
  totals: { today: { visitors: number; views: number }; last7: { visitors: number; views: number }; last30: { visitors: number; views: number } };
  topPages: { path: string; views: number }[];
  topSources: { host: string; views: number }[];
};

/** Résumé pour le tableau de bord : les `days` derniers jours (jours sans visite compris), pages les plus lues et provenances sur 30 jours. */
export async function statsSummary(opts: { days?: number; now?: Date } = {}): Promise<StatsSummary> {
  const now = opts.now ?? new Date();
  const span = Math.min(90, Math.max(1, opts.days ?? 30));
  const dayList = Array.from({ length: span }, (_, i) => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (span - 1 - i))));
  const rows = await prisma.visitDaily.findMany({ where: { day: { gte: dayList[0]!, lte: dayList[span - 1]! } } });
  const site = new Map(rows.filter((r) => r.kind === "site").map((r) => [r.day, r]));
  const days = dayList.map((day) => ({ day, visitors: site.get(day)?.visitors ?? 0, views: site.get(day)?.views ?? 0 }));
  const sum = (n: number) => days.slice(-n).reduce((a, d) => ({ visitors: a.visitors + d.visitors, views: a.views + d.views }), { visitors: 0, views: 0 });
  const top = (kind: string) => {
    const acc = new Map<string, number>();
    for (const r of rows.filter((x) => x.kind === kind)) acc.set(r.key, (acc.get(r.key) ?? 0) + r.views);
    return [...acc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  };
  return {
    days,
    totals: { today: days[days.length - 1] ? { visitors: days[days.length - 1]!.visitors, views: days[days.length - 1]!.views } : { visitors: 0, views: 0 }, last7: sum(7), last30: sum(30) },
    topPages: top("page").map(([path, views]) => ({ path, views })),
    topSources: top("ref").map(([host, views]) => ({ host, views })),
  };
}

/** Efface tous les compteurs (le propriétaire peut repartir de zéro). */
export async function resetStats(): Promise<void> {
  await prisma.visitDaily.deleteMany({});
  await prisma.visitSeen.deleteMany({});
  await deleteSetting("stats.salt");
}
