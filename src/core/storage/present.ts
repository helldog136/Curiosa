/** STORAGE — the numbers turned into the words and shares the screens show. Pure: tests alone. Never carries a path. */
import type { Translator } from "../i18n/dictionary";
import { formatBytes } from "./format";
import type { StorageInfo } from "./service";
import { USAGE_CATEGORIES, type UsageCategory } from "./usage";
import type { DiskLevel } from "./level";

export type StorageView = {
  level: DiskLevel | "unknown";
  /** "Plenty of room", "Getting low", "Very low": said in words, next to the icon (never colour alone). */
  stateText: string;
  icon: string;
  freeText: string | null;
  totalText: string | null;
  usedText: string | null;
  /** One sentence for the card: "1.2 GB used by your site · 3.2 GB free on the server". */
  sentence: string | null;
  /** Hint beside an upload button: "3.2 GB free of 20 GB". */
  uploadLine: string | null;
  /** What to do, when the space is low (null: nothing to say). */
  warning: string | null;
  /** Share of the disk, in percent: the site, everything else that is used. The rest is free. */
  siteShare: number;
  otherShare: number;
  usedShare: number;
  /** Widths drawn in the bar: the site never shrinks under a visible sliver, the other two give way. Sums to at most 100. */
  barSite: number;
  barOther: number;
  /** The three bar segments, said in words with their exact sizes: site, rest of the server, free. Null when the disk is unknown. */
  legend: { id: "site" | "other" | "free"; label: string; text: string }[] | null;
  pending: boolean;
  partial: boolean;
  categories: { id: UsageCategory; label: string; text: string; bytes: number }[] | null;
};

const ICONS = { ok: "✅", low: "⚠️", critical: "⛔", unknown: "❔" } as const;

export function presentStorage(info: StorageInfo, t: Translator, locale: string): StorageView {
  const disk = info.disk;
  const level = disk ? disk.level : "unknown";
  const site = info.usage?.totalBytes ?? null;
  const usedByAll = disk ? Math.max(0, disk.totalBytes - disk.freeBytes) : 0;
  const pct = (n: number) => (disk && disk.totalBytes ? Math.min(100, Math.max(0, (n / disk.totalBytes) * 100)) : 0);
  const siteShare = site === null ? 0 : Math.min(pct(site), pct(usedByAll));
  const freeText = disk ? formatBytes(disk.freeBytes, locale) : null;
  const totalText = disk ? formatBytes(disk.totalBytes, locale) : null;
  const usedText = site === null ? null : formatBytes(site, locale);
  const usedShare = pct(usedByAll);
  const MIN_SLIVER = 1.5;
  const barSite = site !== null && site > 0 ? Math.min(Math.max(siteShare, MIN_SLIVER), 100) : siteShare;
  const barOther = Math.max(0, Math.min(usedShare - siteShare, 100 - barSite));
  const otherBytes = disk ? Math.max(0, usedByAll - (site ?? 0)) : 0;
  const legend = disk ? [
    ...(site !== null ? [{ id: "site" as const, label: t("storage.legend.site"), text: formatBytes(site, locale) }] : []),
    { id: "other" as const, label: t(site !== null ? "storage.legend.other" : "storage.legend.used"), text: formatBytes(site !== null ? otherBytes : usedByAll, locale) },
    { id: "free" as const, label: t("storage.legend.free"), text: formatBytes(disk.freeBytes, locale) },
  ] : null;
  return {
    level,
    stateText: t(`storage.state.${level}`),
    icon: ICONS[level],
    freeText, totalText, usedText,
    sentence: freeText && usedText ? t("storage.sentence", { used: usedText, free: freeText }) : freeText ? t("storage.sentenceFree", { free: freeText }) : null,
    uploadLine: freeText && totalText ? t("storage.uploadLine", { free: freeText, total: totalText }) : null,
    warning: level === "critical" ? t("storage.warn.critical", { free: freeText ?? "" }) : level === "low" ? t("storage.warn.low", { free: freeText ?? "" }) : null,
    siteShare,
    otherShare: Math.max(0, pct(usedByAll) - siteShare),
    usedShare,
    barSite, barOther, legend,
    pending: info.pending,
    partial: info.usage?.partial ?? false,
    categories: info.usage ? USAGE_CATEGORIES.map((id) => ({ id, label: t(`storage.cat.${id}`), bytes: info.usage!.categories[id], text: formatBytes(info.usage!.categories[id], locale) })) : null,
  };
}
