import type { Block } from "./blocks";
import { makeTranslator } from "./i18n/dictionary";
import { sharedNet, type NetHealthItem } from "./services/net";

/**
 * Bloc d'admin « santé » (`{ type: "netHealth" }`) : une phrase simple par service externe qui a un problème, en français ou en anglais, d'après l'état RÉEL de
 * l'hôte dans le client réseau du cœur (`ctx.api.net`). Le libellé vient du module ; le cœur ne connaît aucun fournisseur.
 * R33 (0.36.0) : quand tout répond, il n'y a RIEN à dire (ni phrase « répond normalement », ni hôte « pas encore contacté ») ; seuls les services en difficulté ont une ligne,
 * et les hôtes en difficulté pour la même raison depuis la même heure n'en ont qu'une (« A et B ne répondent pas depuis 10:15 »).
 * Les heures sont écrites à l'heure du serveur (comme le reste de l'admin), avec la date si ce n'est pas aujourd'hui.
 */
export type NetHealthLine = { label: string; host: string; hosts: string[]; state: Exclude<NetHealthItem["state"], "ok">; text: string };
export type NetHealthView = { title: string; lines: NetHealthLine[]; hint: string | null };

type Item = Extract<Block, { type: "netHealth" }>["items"][number];

function when(t: number, locale: string, now: number): string {
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  try { return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }).format(d); } catch { return d.toISOString(); }
}

function joinLabels(labels: string[], locale: string): string {
  try { return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(labels); } catch { return labels.join(", "); }
}

/** Phrases du bloc ; `lookup` : santé d'un hôte (par défaut, le client partagé du processus). Fonction pure pour les tests. */
export function describeNetHealth(items: Item[], locale: string, opts: { now?: number; lookup?: (host: string) => NetHealthItem | null } = {}): NetHealthView {
  const t = makeTranslator(locale);
  const now = opts.now ?? Date.now();
  const lookup = opts.lookup ?? ((host: string) => sharedNet().hostHealth(host));
  type Trouble = { label: string; host: string; h: NetHealthItem; dataFrom: string };
  const groups = new Map<string, Trouble[]>();
  for (const item of (Array.isArray(items) ? items : []).slice(0, 20)) {
    if (!item || typeof item.host !== "string" || typeof item.label !== "string") continue;
    const host = item.host.trim().toLowerCase().slice(0, 200);
    const label = item.label.trim().slice(0, 80) || host;
    const h = host ? lookup(host) : null;
    // Nothing to say about a host that answers, or that was never contacted: the person has nothing to act on.
    if (!h || h.state === "ok") continue;
    const good = item.lastGoodAt ? Date.parse(item.lastGoodAt) : NaN;
    const dataFrom = Number.isFinite(good) ? ` ${t("net.health.dataFrom", { time: when(good, locale, now) })}` : "";
    const key = `${h.state}|${h.since}|${h.retryAt ?? ""}|${dataFrom}`;
    groups.set(key, [...(groups.get(key) ?? []), { label, host, h, dataFrom }]);
  }
  const lines: NetHealthLine[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const labels = [...new Set(list.map((x) => x.label))];
    const many = labels.length > 1;
    const vars = { label: joinLabels(labels, locale), since: when(first.h.since, locale, now), until: first.h.retryAt ? when(first.h.retryAt, locale, now) : "" };
    const state = first.h.state as NetHealthLine["state"];
    const text = t(many && (state === "slow" || state === "down") ? `net.health.${state}.many` : `net.health.${state}`, vars) + first.dataFrom;
    lines.push({ label: vars.label, host: first.host, hosts: list.map((x) => x.host), state, text });
  }
  return { title: t("net.health.title"), lines, hint: lines.length > 0 ? t("net.health.hint") : null };
}
