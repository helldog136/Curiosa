import { isDarkBackground, pickLogo } from "@/core/logos";
import { makeTranslator } from "@/core/i18n/dictionary";
import { pickName } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { withLocale } from "@/core/links";
import { instanceHasNews, runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { safeHref } from "@/core/url";
import { LanguageSwitcher } from "./LanguageSwitcher";

export async function Header({ config, locale }: { config: SiteConfig; locale: string }) {
  const t = makeTranslator(locale);
  const dark = isDarkBackground(config.background);
  const wide = pickLogo(config.logos, "wide", dark);
  const icon = pickLogo(config.logos, "icon", dark);
  const mounted = (await getActiveInstances()).filter((a) => a.instance.showInNav && a.instance.basePath);
  const fresh = await Promise.all(mounted.map((a) => instanceHasNews(a, locale)));
  const moduleNav = await runSlot("nav.items", locale);

  const items = [
    ...mounted.map(({ instance: c }, i) => ({
      label: pickName(c, locale, config.defaultLocale),
      href: withLocale(`/${c.basePath}`, locale, config.defaultLocale),
      news: fresh[i] === true,
    })),
    ...config.nav.map((n) => ({
      label: n.label[locale] ?? n.label[config.defaultLocale] ?? Object.values(n.label)[0] ?? n.href,
      href: withLocale(safeHref(n.href), locale, config.defaultLocale),
      news: false,
    })),
    ...moduleNav.flatMap((b) => (b.type === "links" ? b.items.map((i) => ({ label: i.label, href: safeHref(i.href), news: false })) : [])),
  ];

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <a href={withLocale("/", locale, config.defaultLocale)} className="flex items-center gap-3 text-lg font-semibold" aria-label={config.name}>
          {/* Le logo horizontal contient déjà le nom ; sans lui, l'icône (ou rien) et le nom écrit. Sur petit écran : l'icône si on en a une. */}
          {/* eslint-disable @next/next/no-img-element */}
          {wide && <img src={wide} alt={config.name} className={`${icon ? "hidden sm:block" : ""} h-9 w-auto max-w-[14rem] object-contain`} />}
          {icon && <img src={icon} alt="" className={`${wide ? "sm:hidden" : ""} h-9 w-9 object-contain`} />}
          {/* eslint-enable @next/next/no-img-element */}
          {(!wide || icon) && <span className={wide ? "sm:hidden" : ""}>{config.name}</span>}
        </a>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {items.map((item) => (
              <a key={`${item.href}-${item.label}`} href={item.href} className="inline-block py-1.5 text-muted hover:text-fg">
                {item.label}
                {item.news ? <span data-testid="news-dot" role="img" aria-label={t("site.news")} title={t("site.news")} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" /> : null}
              </a>
            ))}
          </nav>
          <LanguageSwitcher locales={config.locales} current={locale} defaultLocale={config.defaultLocale} />
        </div>
      </div>
    </header>
  );
}
