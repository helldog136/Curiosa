import { siteUrl } from "@/core/config";
import { opStep, opUnit } from "@/core/operations/tracker";
import { sharedContentNet, resolveHost, type PinTable, type Resolver } from "./net";
import { probeLink, type ProbeResult } from "./probe";
import { clip, displayUrl, hostKey, parseSkipHosts } from "./refs";
import { LIMITS, scanContent, type ScanOptions, type ScanResult } from "./scan";
import {
  MAX_IGNORED, clearRun, pushHistory, readIgnored, readReport, readRun, readSettings, readState, writeIgnored, writeReport, writeRun, writeState, writeSummary,
} from "./store";
import { SEVERITY_RANK, type Group, type LinkTask, type Report, type Run, type Severity, type Summary } from "./types";

/**
 * CONTRÔLE DU CONTENU — le déroulement d'une vérification : lire le site, puis visiter les liens externes PAR PAQUETS, à la demande seulement.
 *
 * Garde-fous (tous ici) :
 *  - jamais en arrière-plan : rien ne part sans un clic (ou l'appel explicite d'un assistant autorisé) ; aucune tâche planifiée, aucun minuteur qui survive à l'appel ;
 *  - un seul passage à la fois (verrou du processus ET date de fin gardée dans les données : une vérification abandonnée se libère toute seule) ;
 *  - au plus 200 liens par vérification, 25 par site, répartis pour ne jamais frapper deux fois de suite le même site (si un seul site reste, une seconde sépare deux visites) ;
 *  - un quart de seconde entre deux visites ; un paquet s'arrête à BATCH_MS ou BATCH_MAX liens (la suite se reprend, avec la barre de progression) ;
 *  - un site qui dit « trop de demandes » n'est plus contacté du tout pendant cette vérification (et le client réseau le met en pause pour les suivantes).
 * Le détail des visites (résolution du nom, connexion à l'adresse vérifiée, redirections) est dans probe.ts et net.ts.
 */
export const BATCH_MS = 45_000;
export const BATCH_MAX = 100;
export const GAP_MS = 250;
export const SAME_HOST_MS = 1000;
/** Délai dur d'une visite de lien, quoi qu'il arrive (le lien a déjà son propre budget de 14 s : ceci ne sert que si quelque chose se bloque). */
export const LINK_HARD_MS = 20_000;
/** Une vérification « en cours » depuis plus longtemps que cela est considérée abandonnée (le verrou se libère seul). */
export const BUSY_MS = 120_000;

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const busyBox = () => ((globalThis as unknown as Record<symbol, Set<string>>)[Symbol.for("curiosa.content-check.busy")] ??= new Set<string>());
const iso = (ms: number) => new Date(ms).toISOString();

/** Tout ce que la vérification fait « au dehors », remplaçable dans les tests (aucun vrai réseau, aucune vraie attente). */
export type RunDeps = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  scan?: (options: ScanOptions) => Promise<ScanResult>;
  /** Visite un lien. Par défaut : `probeLink` avec le client réseau dédié (connexions aux seules adresses vérifiées). */
  probe?: (url: string) => Promise<ProbeResult>;
  net?: { client: Parameters<typeof probeLink>[1]["net"]; pins: PinTable };
  resolve?: Resolver;
  batchMs?: number;
  batchMax?: number;
  /** Filet de sécurité : une visite qui n'est pas revenue après ce délai est abandonnée (le délai propre à chaque lien est déjà plus court). */
  linkHardMs?: number;
  gapMs?: number;
  sameHostMs?: number;
  by?: "admin" | "ai";
};

/* ───────────── Du résultat de chaque lien aux remarques ───────────── */

export const LINK_GROUP_IDS = new Set(["link_gone", "img_gone", "link_down", "link_loop", "link_blocked", "link_moved", "link_insecure", "link_unverified"]);

function linkGroup(link: LinkTask): [string, Severity] | null {
  const r = link.r;
  if (!r) return null;
  const image = link.k === "image";
  switch (r.st) {
    case "gone": return [image ? "img_gone" : "link_gone", "important"];
    case "down": return ["link_down", "advised"];
    case "loop": return ["link_loop", "advised"];
    case "blocked": return ["link_blocked", "info"];
    case "moved": return ["link_moved", "info"];
    case "ok": return r.ins ? ["link_insecure", "info"] : null;
    default: return ["link_unverified", "info"]; // paused · refused · unverified · skipped
  }
}

export function linkGroups(run: Pick<Run, "links"> | null): Group[] {
  const map = new Map<string, Group>();
  for (const link of run?.links ?? []) {
    const hit = linkGroup(link);
    if (!hit) continue;
    const [id, sev] = hit;
    let g = map.get(id);
    if (!g) { g = { id, loc: null, sev, count: 0, items: [] }; map.set(id, g); }
    g.count++;
    if (g.items.length >= LIMITS.items) continue;
    const s = link.s[0];
    const r = link.r!;
    g.items.push({
      k: `lk:${displayUrl(link.u)}`.slice(0, 190), t: link.label || hostKey(link.u), u: displayUrl(link.u), w: s?.w ?? "",
      d: [r.st, r.code ?? "", r.why ?? "", r.to ? displayUrl(r.to) : ""], f: s?.f ?? null,
    });
  }
  return [...map.values()];
}

const withoutLinks = (report: Report) => report.groups.filter((g) => !LINK_GROUP_IDS.has(g.id));

/** Ce que cette personne n'a pas masqué, de l'important au pour-info. Le décompte des remarques masquées est retiré. */
export function visibleGroups(report: Pick<Report, "groups"> | null, ignored: ReadonlySet<string> = new Set()): Group[] {
  const out: Group[] = [];
  for (const g of report?.groups ?? []) {
    const hidden = g.items.filter((i) => ignored.has(i.k));
    const items = g.items.filter((i) => !ignored.has(i.k));
    const count = g.count - hidden.length;
    const total = g.total === undefined ? undefined : g.total - hidden.reduce((n, i) => n + (i.d?.[0] === "imgs" ? Number(i.d[1]) || 1 : 1), 0);
    if (count > 0 && (items.length > 0 || hidden.length === 0)) out.push({ ...g, count, items, ...(total === undefined ? {} : { total }) });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev] || a.id.localeCompare(b.id) || String(a.loc).localeCompare(String(b.loc)));
}

export function tally(groups: readonly Group[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { important: 0, advised: 0, info: 0 };
  for (const g of groups) counts[g.sev] += g.count; // des choses à regarder (pages, liens), pas des images
  return counts;
}

export function summaryOf(report: Report, ignored: ReadonlySet<string>): Summary {
  const groups = visibleGroups(report, ignored);
  return {
    at: report.at, finished: report.finished, ...(report.doneAt ? { doneAt: report.doneAt } : {}), counts: tally(groups), progress: report.progress,
    groups: groups.map((g) => ({ id: g.id, loc: g.loc, sev: g.sev, count: g.count })),
  };
}

export const progressOf = (run: Pick<Run, "links">) => ({ done: run.links.filter((l) => l.r).length, total: run.links.length });

/* ───────────── Un paquet de liens ───────────── */

export type BatchOutcome = { done: number; total: number; finished: boolean; visited: number };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("hard-timeout")), ms); });
  p.catch(() => {}); // un échec tardif d'une visite abandonnée ne doit pas faire tomber le processus
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

function defaultProbe(deps: RunDeps): (url: string) => Promise<ProbeResult> {
  const net = deps.net ?? sharedContentNet();
  const resolve = deps.resolve ?? resolveHost;
  const dnsCache = new Map();
  return (url) => probeLink(url, { net: net.client, pins: net.pins, resolve, dnsCache, siteUrl, now: deps.now });
}

async function batch(report: Report, run: Run, deps: RunDeps): Promise<BatchOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepReal;
  const probe = deps.probe ?? defaultProbe(deps);
  const batchMs = deps.batchMs ?? BATCH_MS;
  const batchMax = deps.batchMax ?? BATCH_MAX;
  const gapMs = deps.gapMs ?? GAP_MS;
  const sameHostMs = deps.sameHostMs ?? SAME_HOST_MS;
  const started = now();
  run.busyUntil = started + BUSY_MS;
  run.paused ??= {};
  await writeRun(run);
  const before = run.links.filter((l) => l.r).length;
  opStep("links");
  const lastHit = new Map<string, number>();
  let lastAny = 0;
  let lastHost = "";
  let visited = 0;
  try {
    for (;;) {
      if (visited >= batchMax || now() - started >= batchMs) break;
      // Liens des sites qui ont dit « trop de demandes » : plus de contact, c'est tout.
      for (const l of run.links) if (!l.r && (run.paused[hostKey(l.u)] ?? 0) > now()) l.r = { st: "paused", why: "rate" };
      const todo = run.links.filter((l) => !l.r);
      if (!todo.length) break;
      // Jamais deux visites de suite sur le même site, tant qu'un autre site attend.
      const next = todo.find((l) => hostKey(l.u) !== lastHost) ?? todo[0]!;
      const host = hostKey(next.u);
      const wait = Math.max(lastAny + gapMs - now(), (lastHit.get(host) ?? 0) + sameHostMs - now(), 0);
      if (wait > 0) {
        if (now() + wait - started > batchMs) break;
        await sleep(wait);
      }
      opUnit(before + visited + 1, run.links.length, host);
      opStep("links"); // opUnit repart de la première étape : on la ré-annonce
      let r: ProbeResult;
      try { r = await withTimeout(probe(next.u), deps.linkHardMs ?? LINK_HARD_MS); } catch (error) { r = { st: "down", why: (error as Error)?.message === "hard-timeout" ? "timeout" : "network" }; }
      lastAny = now();
      lastHost = host;
      lastHit.set(host, lastAny);
      visited++;
      if (r.st === "paused") run.paused[host] = Math.min(now() + 3_600_000, Number(r.retryAt) > now() ? Number(r.retryAt) : now() + 60_000);
      next.r = { st: r.st, ...(r.code ? { code: r.code } : {}), ...(r.why ? { why: r.why } : {}), ...(r.to ? { to: clip(r.to, 200) } : {}), ...(r.insecure ? { ins: 1 as const } : {}) };
    }
  } finally {
    run.busyUntil = 0;
  }
  const { done, total } = progressOf(run);
  report.groups = [...withoutLinks(report), ...linkGroups(run)];
  report.progress = done >= total ? null : { done, total };
  await writeRun(run);
  await writeReport(report);
  await writeSummary(summaryOf(report, await readIgnored()));
  if (done >= total) await finalize(report, deps);
  return { done, total, finished: done >= total, visited };
}

/** Fin de vérification : le rapport est complet, la vérification en cours disparaît, l'historique garde les 5 dernières. */
async function finalize(report: Report, deps: RunDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const ignored = await readIgnored();
  const run = await readRun();
  const counts = tally(visibleGroups(report, ignored));
  report.finished = true;
  report.progress = null;
  report.doneAt = iso(now());
  report.counts = counts;
  await writeReport(report);
  await writeSummary(summaryOf(report, ignored));
  await clearRun();
  await pushHistory({
    at: report.at, doneAt: report.doneAt, counts, ok: counts.important + counts.advised === 0, pages: report.stats.pages,
    links: run ? run.links.filter((l) => l.r && l.r.st !== "skipped").length : 0,
  });
  // Prochaine fenêtre de liens : on reprend là où celle-ci s'est arrêtée.
  const t = report.linkTotals;
  await writeState({ cursor: t.window ? (t.from + t.count) % Math.max(1, t.found) : 0 });
}

/* ───────────── Les actions ───────────── */

/** Tests : dépendances posées d'office pour toute vérification (aucun vrai réseau, aucune vraie attente). `null` les retire. */
let testDeps: RunDeps | null = null;
export function setContentCheckDeps(deps: RunDeps | null): void { testDeps = deps; }

export type Locked<T> = { busy: true } | { busy: false; value: T };

async function withLock<T>(fn: (previous: Run | null) => Promise<T>): Promise<Locked<T>> {
  const box = busyBox();
  const key = "content-check";
  if (box.has(key)) return { busy: true };
  const run = await readRun();
  if (run && Number(run.busyUntil) > Date.now()) return { busy: true };
  box.add(key);
  try { return { busy: false, value: await fn(run) }; } finally { box.delete(key); }
}

/** Une vérification est-elle en cours en ce moment (dans ce processus, ou une autre qui s'est annoncée) ? */
export async function checkIsRunning(): Promise<boolean> {
  if (busyBox().has("content-check")) return true;
  const run = await readRun();
  return !!run && Number(run.busyUntil) > Date.now();
}

/** Nouvelle vérification : lit le site, puis visite un premier paquet de liens. */
export function startCheck(given: RunDeps = {}): Promise<Locked<BatchOutcome>> {
  const deps: RunDeps = { ...testDeps, ...given };
  return withLock(async () => {
    const now = deps.now ?? Date.now;
    const settings = await readSettings();
    const state = await readState();
    const scan = await (deps.scan ?? scanContent)({ checkLinks: settings.checkLinks, maxLinks: LIMITS.links, cursor: state.cursor, skipHosts: parseSkipHosts(settings.skipHosts) });
    const report: Report = {
      cid: `c${now().toString(36)}`, at: iso(now()), finished: false, stats: scan.stats, linkTotals: scan.linkTotals, notes: scan.notes, locales: scan.locales,
      linksOff: !settings.checkLinks, groups: scan.groups, progress: scan.links.length ? { done: 0, total: scan.links.length } : null, by: deps.by ?? "admin",
    };
    const run: Run | null = scan.links.length ? { cid: report.cid, at: report.at, links: scan.links, paused: {}, busyUntil: 0 } : null;
    if (!run) await clearRun();
    await writeReport(report);
    await writeSummary(summaryOf(report, await readIgnored()));
    if (!run) {
      await finalize(report, deps);
      return { done: 0, total: 0, finished: true, visited: 0 };
    }
    return batch(report, run, deps);
  });
}

/** Paquet suivant d'une vérification commencée. `none` : il n'y a rien à reprendre. */
export function continueCheck(given: RunDeps = {}): Promise<Locked<BatchOutcome | { none: true }>> {
  const deps: RunDeps = { ...testDeps, ...given };
  return withLock(async (run) => {
    const report = await readReport();
    if (!run || !report || report.finished || run.cid !== report.cid) return { none: true } as const;
    return batch(report, run, deps);
  });
}

/** Masque une remarque (200 au plus). `gone` : elle n'existe plus dans le dernier rapport. */
export async function ignoreItem(k: unknown): Promise<{ ok: true } | { gone: true } | { full: true }> {
  const key = String(k ?? "").slice(0, 190);
  const report = await readReport();
  if (!key || !report?.groups.some((g) => g.items.some((i) => i.k === key))) return { gone: true };
  const ignored = await readIgnored();
  if (ignored.has(key)) return { ok: true };
  if (ignored.size >= MAX_IGNORED) return { full: true };
  ignored.add(key);
  await writeIgnored(ignored);
  await refreshSummary(report, ignored);
  return { ok: true };
}

/** « Tout réafficher ». */
export async function unignoreAll(): Promise<number> {
  const ignored = await readIgnored();
  await writeIgnored([]);
  const report = await readReport();
  if (report) await refreshSummary(report, new Set());
  return ignored.size;
}

async function refreshSummary(report: Report, ignored: ReadonlySet<string>): Promise<void> {
  await writeSummary(summaryOf(report, ignored));
}

