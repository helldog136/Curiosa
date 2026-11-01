import type { Translator } from "@/core/i18n/dictionary";
import { localeName } from "@/core/i18n/locales";
import { fixHref } from "./fix";
import type { Group, Item, Report, Severity } from "./types";

/**
 * CONTRÔLE DU CONTENU — de ce que le contrôle a trouvé à ce qu'on lit : une phrase humaine par remarque, un « pourquoi », et par ligne un détail et le lien « Corriger ».
 * Logique pure : la page d'administration et les outils de l'assistant IA (en anglais) s'en servent tous les deux. Aucune note chiffrée, jamais.
 */
export type ItemView = { k: string; title: string; where: string; detail: string; url: string | null; fix: string | null };
export type GroupView = { id: string; loc: string | null; sev: Severity; count: number; sentence: string; why: string; items: ItemView[]; more: number };

/** Remarques dont la phrase parle d'une langue (« {lang} »). */
const LANGUAGE_GROUPS = new Set(["alt", "title_empty", "title_dup", "summary", "translation_missing", "translation_same", "internal", "upload_missing", "expired_linked"]);

const langOf = (loc: string | null) => (loc ? localeName(loc) : "");

function whereOf(w: string | undefined, t: Translator): string {
  if (!w) return "";
  if (w === "menu" || w === "header" || w === "about") return t(`content.where.${w}`);
  return w;
}

function itemTitle(g: Group, i: Item, t: Translator): string {
  if (i.t) return i.t;
  switch (g.id) {
    case "home": return t("content.name.home");
    case "contact": return t("content.name.contact");
    case "empty": return t("content.name.empty");
    case "menu_empty": return t("content.name.menu");
    default: return t("content.untitled");
  }
}

const linkWhy = (why: unknown, code: unknown, t: Translator): string => {
  const w = String(why ?? "");
  if (["private", "internal", "address", "port", "credentials", "scheme", "invalid"].includes(w) || w.startsWith("redirect_")) return t("content.d.why.refused");
  const known = ["rate", "quota", "circuit", "busy", "perhost", "ignored", "dns", "dnsslow", "insecure", "timeout", "network", "server", "badredirect"];
  return known.includes(w) ? t(`content.d.why.${w}`, { code: String(code ?? "") }) : "";
};

function itemDetail(g: Group, i: Item, t: Translator): string {
  const d = i.d ?? [];
  switch (g.id) {
    case "alt": return t("content.d.imgs", { n: Number(d[1]) || 1 });
    case "internal": case "expired_linked": case "menu_broken": return t("content.d.path", { path: String(d[1] ?? "") });
    case "upload_missing": return t("content.d.file", { file: String(d[1] ?? "") });
    case "title_dup": return t("content.d.dup", { n: Number(d[1]) || 2 });
    case "translation_missing": case "translation_same": {
      const langs = String(d[1] ?? "").split(",").map((x) => localeName(x.trim())).filter(Boolean).join(", ");
      const kind = d[0] === "hidden" ? "hidden" : d[0] === "same" ? "same" : "fallback";
      return `${t(`content.d.tr.${kind}`)} ${t("content.d.tr.available", { langs })}`.trim();
    }
    case "site_http": return t("content.d.siteHttp");
    case "link_gone": case "img_gone": return t("content.d.gone", { code: String(d[1] ?? "") });
    case "link_down": return linkWhy(d[2], d[1], t) || t("content.d.down");
    case "link_loop": return t("content.d.loop");
    case "link_blocked": return t("content.d.blocked", { code: String(d[1] ?? "") });
    case "link_moved": return t("content.d.moved", { to: String(d[3] ?? "") });
    case "link_insecure": return t("content.d.insecure");
    case "link_unverified": return linkWhy(d[2] === "dns" ? "dnsslow" : d[2], d[1], t) || t("content.d.unverified");
    default: return "";
  }
}

export function describeGroup(g: Group, t: Translator, defaultLocale = ""): GroupView {
  const lang = langOf(g.loc);
  const withLang = LANGUAGE_GROUPS.has(g.id) && g.loc && g.loc !== defaultLocale ? ` ${t("content.inLang", { lang })}` : "";
  const vars = { n: g.count, total: g.total ?? g.count, lang };
  return {
    id: g.id, loc: g.loc, sev: g.sev, count: g.count,
    sentence: `${t(`content.g.${g.id}`, vars)}${withLang}`,
    why: t(`content.why.${g.id}`),
    items: g.items.map((i) => ({
      k: i.k, title: itemTitle(g, i, t), where: whereOf(i.w, t), detail: itemDetail(g, i, t), url: i.u ?? null, fix: fixHref(i.f, defaultLocale),
    })),
    more: Math.max(0, g.count - g.items.length),
  };
}

export const describeGroups = (groups: readonly Group[], t: Translator, defaultLocale = ""): GroupView[] => groups.map((g) => describeGroup(g, t, defaultLocale));

/** Le verdict, en un mot : jamais un chiffre. `none` : aucune vérification n'a encore eu lieu. Les remarques « pour info » seules ne changent pas le verdict. */
export type Verdict = "none" | "good" | "look";
export function verdictOf(counts: Record<Severity, number> | null | undefined): Verdict {
  if (!counts) return "none";
  return counts.important + counts.advised === 0 ? "good" : "look";
}

/** Ce qui n'a pas pu être regardé cette fois (honnêteté affichée à l'écran), sous forme de clés de texte `content.nc.<clé>` avec leurs variables. */
export function notCheckedList(report: Report | null, ctx: { linksOn: boolean }): { key: string; vars?: Record<string, number> }[] {
  const out: { key: string; vars?: Record<string, number> }[] = [];
  if (!report) return out;
  if (!ctx.linksOn || report.linksOff) out.push({ key: "linksOff" });
  if (report.notes.capped) out.push({ key: "capped" });
  if (report.notes.unreadable.length) out.push({ key: "unreadable" });
  if (report.notes.modulePages) out.push({ key: "modulePages" });
  if (report.linkTotals.window) out.push({ key: "window", vars: { count: report.linkTotals.count, found: report.linkTotals.found } });
  if (report.notes.skipped.host) out.push({ key: "perhost", vars: { n: report.notes.skipped.host } });
  if (report.notes.skipped.ignored) out.push({ key: "skipHosts", vars: { n: report.notes.skipped.ignored } });
  out.push({ key: "private" }, { key: "behindLogin" });
  return out;
}
