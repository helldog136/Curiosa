import { prisma } from "@/core/db";
import type { HistoryEntry, Report, Run, Settings, State, Summary } from "./types";

/**
 * CONTRÔLE DU CONTENU — ce qui est gardé entre deux visites de la page, dans la table des réglages du cœur (aucune table de plus, la mise à jour d'un site existant n'a rien à faire) :
 *   maintenance.content.report   le dernier rapport (60 lignes au plus par remarque)
 *   maintenance.content.summary  le petit résumé (compteurs) lu par le tableau de bord et le diagnostic
 *   maintenance.content.run      la vérification en cours (≤ 200 liens), effacée à la fin
 *   maintenance.content.state    où reprendre dans la liste des liens
 *   maintenance.content.history  les 5 dernières vérifications
 *   maintenance.content.ignored  les remarques masquées (200 au plus)
 *   maintenance.content.settings les deux réglages (liens vers d'autres sites ; sites à ne jamais visiter)
 * Rien de tout cela ne contient de donnée de visiteur, de secret ni d'adresse avec paramètres. Lu directement en base (jamais via le cache de requête).
 */
const KEY = {
  report: "maintenance.content.report", summary: "maintenance.content.summary", run: "maintenance.content.run", state: "maintenance.content.state",
  history: "maintenance.content.history", ignored: "maintenance.content.ignored", settings: "maintenance.content.settings",
} as const;

export const KEEP_HISTORY = 5;
export const MAX_IGNORED = 200;

async function read<T>(key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
async function write(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value: json }, update: { value: json } });
}
async function remove(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key, locale: "" } });
}

const object = <T>(v: unknown): T | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null);

export const readReport = async (): Promise<Report | null> => {
  const r = object<Report>(await read(KEY.report));
  return r && Array.isArray(r.groups) && r.stats ? r : null;
};
export const writeReport = (r: Report) => write(KEY.report, r);

export const readSummary = async (): Promise<Summary | null> => {
  const s = object<Summary>(await read(KEY.summary));
  return s && s.counts && Array.isArray(s.groups) ? s : null;
};
export const writeSummary = (s: Summary) => write(KEY.summary, s);

export const readRun = async (): Promise<Run | null> => {
  const r = object<Run>(await read(KEY.run));
  return r && Array.isArray(r.links) ? r : null;
};
export const writeRun = (r: Run) => write(KEY.run, r);
export const clearRun = () => remove(KEY.run);

export const readState = async (): Promise<State> => ({ cursor: Math.max(0, Math.trunc(Number(object<State>(await read(KEY.state))?.cursor)) || 0) });
export const writeState = (s: State) => write(KEY.state, s);

export async function readHistory(): Promise<HistoryEntry[]> {
  const h = await read<unknown>(KEY.history);
  return Array.isArray(h) ? (h.filter((e) => e && typeof e === "object") as HistoryEntry[]).slice(0, KEEP_HISTORY) : [];
}
/** Ajoute une vérification terminée ; seules les 5 dernières restent. */
export async function pushHistory(entry: HistoryEntry): Promise<void> {
  await write(KEY.history, [entry, ...(await readHistory())].slice(0, KEEP_HISTORY));
}

export async function readIgnored(): Promise<Set<string>> {
  const v = await read<unknown>(KEY.ignored);
  return new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, MAX_IGNORED) : []);
}
export const writeIgnored = (keys: Iterable<string>) => write(KEY.ignored, [...keys].slice(0, MAX_IGNORED));

export async function readSettings(): Promise<Settings> {
  const v = object<Partial<Settings>>(await read(KEY.settings));
  return { checkLinks: v?.checkLinks !== false, skipHosts: typeof v?.skipHosts === "string" ? v.skipHosts.slice(0, 10_000) : "" };
}
export const writeSettings = (s: Settings) => write(KEY.settings, { checkLinks: s.checkLinks === true, skipHosts: String(s.skipHosts ?? "").slice(0, 10_000) });
