import { makeTranslator } from "@/core/i18n/dictionary";
import { getSetting } from "@/core/settings";
import { redactDeep } from "../redact";
import { hostKey } from "./refs";
import { visibleGroups, tally, startCheck, continueCheck, checkIsRunning, type RunDeps } from "./run";
import { readHistory, readIgnored, readReport, readSettings, readSummary } from "./store";
import { describeGroup, notCheckedList, verdictOf, type Verdict } from "./view";
import type { Severity, Summary } from "./types";

/**
 * CONTRÔLE DU CONTENU — ce que le reste du cœur lit : le diagnostic et le journal de la maintenance, le tableau de bord, et les outils de l'assistant IA.
 * Tout est en lecture seule sauf `runContentCheck`, qui est l'action explicite (jamais déclenchée par une lecture).
 */

/** Le petit résumé du dernier contrôle (null : jamais fait). Une seule lecture de quelques centaines d'octets. */
export const contentSummary = (): Promise<Summary | null> => readSummary().catch(() => null);

/** Pour la pastille sobre du tableau de bord : y a-t-il quelque chose de conseillé ou d'important à regarder ? Jamais pour une vérification en cours. */
export async function contentBadge(): Promise<{ look: boolean; at: string } | null> {
  const s = await contentSummary();
  if (!s || !s.finished) return null;
  return s.counts.important + s.counts.advised > 0 ? { look: true, at: s.at } : null;
}

const MAX_GROUPS = 30;
const EXAMPLES = 5;

export type ContentCheckView = {
  checked: boolean;
  verdict: Verdict;
  checkedAt?: string;
  finished?: boolean;
  /** Vérification en cours : liens visités / à visiter. */
  progress?: { done: number; total: number } | null;
  counts?: Record<Severity, number>;
  issues: { id: string; language?: string; importance: Severity; count: number; summary: string; why: string; examples: { title: string; where?: string; detail?: string; site?: string; fix?: string }[]; more: number }[];
  notChecked: string[];
  history: { at: string; important: number; advised: number; info: number }[];
  note: string;
};

/**
 * Le dernier résultat pour l'assistant IA (anglais, borné, sans secret : pour un lien externe on ne donne que le NOM DU SITE, jamais l'adresse complète ni ses paramètres).
 * Ne contacte aucun site et ne modifie rien.
 */
export async function contentCheckView(): Promise<ContentCheckView> {
  const t = makeTranslator("en");
  const [report, ignored, history, settings, defaultLocale] = await Promise.all([readReport(), readIgnored(), readHistory(), readSettings(), getSetting<string>("i18n.default")]);
  const note = "Read-only: this is the last result and no site was contacted. A person fixes things in Admin > Site health; use maintenance_content_check_run (if you were granted it) to check again.";
  if (!report) return { checked: false, verdict: "none", issues: [], notChecked: [], history: [], note: `The content has never been checked. ${note}` };
  const groups = visibleGroups(report, ignored);
  const counts = tally(groups);
  const issues = groups.slice(0, MAX_GROUPS).map((g) => {
    const v = describeGroup(g, t, defaultLocale ?? "");
    return {
      id: g.id, ...(g.loc ? { language: g.loc } : {}), importance: g.sev, count: g.count, summary: v.sentence, why: v.why,
      examples: v.items.slice(0, EXAMPLES).map((i) => ({ title: i.title, ...(i.where ? { where: i.where } : {}), ...(i.detail ? { detail: i.detail } : {}), ...(i.url ? { site: hostKey(i.url) || undefined } : {}), ...(i.fix ? { fix: i.fix } : {}) })),
      more: Math.max(0, g.count - Math.min(EXAMPLES, v.items.length)),
    };
  });
  return redactDeep({
    checked: true,
    verdict: verdictOf(counts),
    checkedAt: report.at,
    finished: report.finished,
    progress: report.progress,
    counts,
    issues,
    notChecked: notCheckedList(report, { linksOn: settings.checkLinks }).map((n) => t(`content.nc.${n.key}`, n.vars)),
    history: history.map((h) => ({ at: h.at, important: h.counts.important, advised: h.counts.advised, info: h.counts.info })),
    note,
  });
}

export type ContentRunResult = {
  ok: boolean;
  busy?: boolean;
  message: string;
  finished?: boolean;
  progress?: { done: number; total: number };
  counts?: Record<Severity, number>;
};

/**
 * Lance (ou reprend, `resume: true`) un contrôle : lit le site puis visite UN paquet de liens (voir run.ts pour les garde-fous). Appelé seulement sur demande explicite.
 * Une vérification qui n'est pas finie se reprend avec `resume: true` ; sans reprise possible, `resume` lance une nouvelle vérification.
 */
export async function runContentCheck(opts: { resume?: boolean; deps?: RunDeps } = {}): Promise<ContentRunResult> {
  const deps: RunDeps = { by: "ai", ...opts.deps };
  let out = opts.resume ? await continueCheck(deps) : await startCheck(deps);
  if (!out.busy && opts.resume && "none" in out.value) out = await startCheck(deps);
  if (out.busy) return { ok: false, busy: true, message: "A content check is already running. Try again in a minute." };
  const value = out.value;
  if ("none" in value) return { ok: false, message: "Nothing to resume." };
  const [report, ignored] = await Promise.all([readReport(), readIgnored()]);
  const counts = report ? tally(visibleGroups(report, ignored)) : undefined;
  const progress = { done: value.done, total: value.total };
  return value.finished
    ? { ok: true, finished: true, progress, ...(counts ? { counts } : {}), message: "The check is finished. Read the result with maintenance_content_check." }
    : { ok: true, finished: false, progress, message: `${value.done} of ${value.total} outside links were visited so far. Call this tool again with continue: true to go on, or read what is known with maintenance_content_check.` };
}

export { checkIsRunning };
