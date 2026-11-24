import type { Translator } from "@/core/i18n/dictionary";

/** (core 0.47.0) Quick filter of the catalogue by origin: All, Official, Personal. Shown only when a personal catalogue is registered; links, so it works without a script. */
export function OriginFilter({ t, current, href, counts }: { t: Translator; current: "personal" | "official" | null; href: (o: "personal" | "official" | null) => string; counts: { all: number; official: number; personal: number } }) {
  const items = [[null, "catalogue.filter.all", counts.all], ["official", "catalogue.filter.official", counts.official], ["personal", "catalogue.filter.personal", counts.personal]] as const;
  return (
    <div role="group" aria-label={t("catalogue.filter.label")} className="flex flex-wrap gap-2" data-testid="origin-filter">
      {items.map(([o, key, n]) => (
        <a key={String(o)} href={href(o)} aria-current={current === o ? "true" : undefined}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${current === o ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-accent hover:text-accent"}`}>{t(key)}<span className={current === o ? "opacity-80" : "text-muted"}>{n}</span></a>
      ))}
    </div>
  );
}
