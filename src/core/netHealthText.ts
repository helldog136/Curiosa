import type { Block } from "./blocks";
import { makeTranslator } from "./i18n/dictionary";
import { sharedNet, type NetHealthItem } from "./services/net";

/**
 * Bloc d'admin « santé » (`{ type: "netHealth" }`) : une phrase simple par service externe, en français ou en anglais, d'après l'état RÉEL de
 * l'hôte dans le client réseau du cœur (`ctx.api.net`). Le libellé vient du module ; le cœur ne connaît aucun fournisseur.
 * Les heures sont écrites à l'heure du serveur (comme le reste de l'admin), avec la date si ce n'est pas aujourd'hui.
 */
export type NetHealthLine = { label: string; host: string; state: NetHealthItem["state"] | "unknown"; text: string };
export type NetHealthView = { title: string; lines: NetHealthLine[]; summary: string | null; hint: string | null };

type Item = Extract<Block, { type: "netHealth" }>["items"][number];

function when(t: number, locale: string, now: number): string {
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  try { return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }).format(d); } catch { return d.toISOString(); }
}

/** Phrases du bloc ; `lookup` : santé d'un hôte (par défaut, le client partagé du processus). Fonction pure pour les tests. */
export function describeNetHealth(items: Item[], locale: string, opts: { now?: number; lookup?: (host: string) => NetHealthItem | null } = {}): NetHealthView {
  const t = makeTranslator(locale);
  const now = opts.now ?? Date.now();
  const lookup = opts.lookup ?? ((host: string) => sharedNet().hostHealth(host));
  const lines: NetHealthLine[] = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, 20)) {
    if (!item || typeof item.host !== "string" || typeof item.label !== "string") continue;
    const host = item.host.trim().toLowerCase().slice(0, 200);
    const label = item.label.trim().slice(0, 80) || host;
    const h = host ? lookup(host) : null;
    const good = item.lastGoodAt ? Date.parse(item.lastGoodAt) : NaN;
    const dataFrom = Number.isFinite(good) ? ` ${t("net.health.dataFrom", { time: when(good, locale, now) })}` : "";
    const vars = { label, since: h ? when(h.since, locale, now) : "", until: h?.retryAt ? when(h.retryAt, locale, now) : "" };
    let text: string;
    switch (h?.state) {
      case undefined: text = t("net.health.unknown", vars); break;
      case "ok": text = t("net.health.ok", vars); break;
      case "slow": text = t("net.health.slow", vars) + dataFrom; break;
      case "rate": text = t("net.health.rate", vars) + dataFrom; break;
      case "quota": text = t("net.health.quota", vars) + dataFrom; break;
      case "down": text = t("net.health.down", vars) + dataFrom; break;
    }
    lines.push({ label, host, state: h?.state ?? "unknown", text });
  }
  const troubled = lines.some((l) => l.state === "down" || l.state === "rate" || l.state === "quota");
  return { title: t("net.health.title"), lines, summary: troubled ? t("net.health.summary") : null, hint: troubled ? t("net.health.hint") : null };
}
